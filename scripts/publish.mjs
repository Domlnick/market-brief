#!/usr/bin/env node
// git 없이 GitHub Git Data API로 커밋/푸시
// 사용: node scripts/publish.mjs "커밋 메시지"   (변경된 소스 파일만 자동 감지해서 1개 커밋)
//       node scripts/publish.mjs --dry            (변경 파일 목록만 출력)
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'site.config.json'), 'utf8'));
const [OWNER, REPO] = cfg.repo.split('/');
const BRANCH = cfg.branch || 'main';
const dry = process.argv.includes('--dry');
const message = process.argv.slice(2).find((a) => !a.startsWith('--')) || `update ${new Date().toISOString()}`;
const IGNORE = new Set(['node_modules', 'dist', '.secrets', '.DS_Store', '.git']);

const token = process.env.GITHUB_TOKEN || (await fs.readFile(path.join(ROOT, '.secrets', 'github_token'), 'utf8').catch(() => '')).trim();
if (!token) { console.error('토큰 없음: .secrets/github_token'); process.exit(1); }

async function gh(method, p, body) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${p}`, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

async function walk(dir, out = []) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (IGNORE.has(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) await walk(f, out); else out.push(f);
  }
  return out;
}
const gitSha = (buf) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');

const ref = await gh('GET', `/git/ref/heads/${BRANCH}`);
const headSha = ref.object.sha;
const headCommit = await gh('GET', `/git/commits/${headSha}`);
const remoteTree = await gh('GET', `/git/trees/${headCommit.tree.sha}?recursive=1`);
const remote = new Map(remoteTree.tree.filter((x) => x.type === 'blob').map((x) => [x.path, x.sha]));

const changed = [];
for (const f of await walk(ROOT)) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  const buf = await fs.readFile(f);
  if (remote.get(rel) !== gitSha(buf)) changed.push({ rel, buf });
}
if (!changed.length) { console.log('변경 없음'); process.exit(0); }
console.log(`변경 ${changed.length}개:\n${changed.map((c) => ` - ${c.rel}`).join('\n')}`);
if (dry) process.exit(0);

const items = [];
for (const c of changed) {
  const blob = await gh('POST', '/git/blobs', { content: c.buf.toString('base64'), encoding: 'base64' });
  items.push({ path: c.rel, mode: c.rel.startsWith('scripts/') ? '100755' : '100644', type: 'blob', sha: blob.sha });
}
const tree = await gh('POST', '/git/trees', { base_tree: headCommit.tree.sha, tree: items });
const commit = await gh('POST', '/git/commits', { message, tree: tree.sha, parents: [headSha], author: { name: 'Morning Market Brief Bot', email: 'bot@users.noreply.github.com', date: new Date().toISOString() } });
await gh('PATCH', `/git/refs/heads/${BRANCH}`, { sha: commit.sha });
console.log(`커밋 완료: ${commit.sha.slice(0, 7)} "${message}"\nhttps://github.com/${OWNER}/${REPO}/commit/${commit.sha}`);
