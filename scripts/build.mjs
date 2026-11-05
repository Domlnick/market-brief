#!/usr/bin/env node
// 정적 사이트 생성기 (의존성: marked)
// content/posts/*.md + data/snapshots/*.json -> dist/
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'site.config.json'), 'utf8'));
const BASE = (process.env.BASE_PATH ?? cfg.base).replace(/\/$/, '');
const SITE = cfg.siteUrl.replace(/\/$/, '');
const DIST = path.join(ROOT, 'dist');
const u = (p = '/') => `${BASE}${p}`;
const abs = (p) => `${SITE}${u(p)}`;

// ---------- utils ----------
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 2) => (n == null || Number.isNaN(n) ? '-' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d }));
const pct = (n) => (n == null ? '-' : `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}%`);
const dir = (n) => (n == null || n === 0 ? 'flat' : n > 0 ? 'up' : 'down');
const arrow = (n) => (n == null || n === 0 ? '' : n > 0 ? '▲' : '▼');
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const krDate = (d) => { const [y, m, dd] = d.split('-').map(Number); const w = new Date(Date.UTC(y, m - 1, dd)).getUTCDay(); return `${y}년 ${m}월 ${dd}일 (${WD[w]})`; };

function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: src };
  const data = {}; let key = null;
  const val = (v) => {
    v = v.trim();
    if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map((x) => val(x)).filter((x) => x !== '');
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) return v.slice(1, -1).replace(/\\"/g, '"');
    if (v === 'true' || v === 'false') return v === 'true';
    return v;
  };
  for (const line of m[1].split(/\r?\n/)) {
    const li = line.match(/^\s+-\s+(.*)$/);
    if (li && key) { (data[key] ||= []).push(val(li[1])); continue; }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) { key = kv[1]; data[key] = kv[2].trim() === '' ? [] : val(kv[2]); }
  }
  return { data, body: m[2] };
}

function sparkline(hist, w = 120, h = 34) {
  const pts = (hist || []).map((x) => x.c).filter((x) => typeof x === 'number');
  if (pts.length < 2) return '';
  const min = Math.min(...pts), max = Math.max(...pts), r = max - min || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, h - 3 - ((v - min) / r) * (h - 6)]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const cls = dir(pts.at(-1) - pts[0]);
  return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="${d}L${w},${h}L0,${h}Z"/><path class="line" d="${d}"/></svg>`;
}

// ---------- components ----------
const card = (i, unit = '') => `
  <div class="card ${dir(i.changePct)}">
    <div class="card-name">${esc(i.name)}</div>
    <div class="card-val">${fmt(i.close)}${unit === '%' ? '<small>%</small>' : ''}</div>
    <div class="card-chg">${arrow(i.changePct)} ${i.change != null ? fmt(Math.abs(i.change), unit === '%' ? 3 : 2) : ''} <b>${pct(i.changePct)}</b></div>
    ${sparkline(i.history)}
  </div>`;

const chips = (arr, key = 'symbol') => `<div class="chips">${arr.map((s) => `
  <div class="chip ${dir(s.changePct)}" style="--i:${Math.min(Math.abs(s.changePct || 0) / 6, 1).toFixed(2)}">
    <span class="chip-name">${esc(s.name)}${s[key] && key === 'symbol' ? ` <em>${esc(s[key])}</em>` : ''}</span>
    <span class="chip-pct">${pct(s.changePct)}</span>
  </div>`).join('')}</div>`;

function flowBars(flows) {
  const rows = Object.entries(flows || {}).filter(([, v]) => v);
  if (!rows.length) return '';
  const max = Math.max(...rows.flatMap(([, v]) => [v.personal, v.foreign, v.institutional].map((x) => Math.abs(x || 0))), 1);
  const bar = (label, v) => `<div class="fb-row"><span class="fb-label">${label}</span><div class="fb-track"><div class="fb-bar ${dir(v)}" style="width:${(Math.abs(v || 0) / max) * 50}%;${v >= 0 ? 'left:50%' : `right:50%`}"></div></div><span class="fb-val ${dir(v)}">${v > 0 ? '+' : ''}${fmt(v, 0)}</span></div>`;
  return rows.map(([mkt, v]) => `<div class="flow"><div class="flow-title">${mkt === 'KOSPI' ? '코스피' : '코스닥'} 투자자별 순매수 <small>${v.bizdate?.replace(/(\d{4})(\d{2})(\d{2})/, '$2/$3')} · 억원</small></div>${bar('개인', v.personal)}${bar('외국인', v.foreign)}${bar('기관', v.institutional)}</div>`).join('');
}

const moverList = (title, arr) => !arr?.length ? '' : `<div class="movers"><div class="movers-title">${title}</div><ol>${arr.map((s, k) => `<li><span>${k + 1}. ${esc(s.name)}</span><b class="${dir(s.changePct)}">${pct(s.changePct)}</b></li>`).join('')}</ol></div>`;

function dashboard(snap) {
  if (!snap) return '';
  const krLive = snap.kr.indices.some((i) => i.marketStatus === 'OPEN');
  return `
<section class="dash" aria-label="시장 데이터">
  <h2 class="dash-h">미국 증시 <small>현지 ${esc((snap.us.indices[0]?.asOf || '').slice(0, 10))} 마감</small></h2>
  <div class="cards">${snap.us.indices.map((i) => card(i)).join('')}</div>
  <h2 class="dash-h">국내 증시 <small>${krLive ? '장중 (발행 시점 기준)' : `${esc((snap.kr.indices[0]?.asOf || '').slice(0, 10))} 마감`}</small></h2>
  <div class="cards">${snap.kr.indices.map((i) => card(i)).join('')}</div>
  <div class="flows">${flowBars(snap.kr.flows)}</div>
  <h2 class="dash-h">환율 · 금리 · 원자재</h2>
  <div class="cards">${snap.macro.map((m) => card(m, m.unit)).join('')}</div>
  <details class="more" open>
    <summary>종목 히트맵</summary>
    <h3>미국 시가총액 상위</h3>${chips(snap.us.megacaps)}
    <h3>코스피 시가총액 상위</h3>${chips(snap.kr.topCaps, 'code')}
    <div class="mover-grid">
      ${moverList('코스피 상승', snap.kr.movers.kospiUp)}${moverList('코스피 하락', snap.kr.movers.kospiDown)}
      ${moverList('코스닥 상승', snap.kr.movers.kosdaqUp)}${moverList('코스닥 하락', snap.kr.movers.kosdaqDown)}
    </div>
    <p class="note">등락 상위는 보통주 중 시가총액 3,000억원 이상만 표시. 데이터: 네이버 증권, 업비트.</p>
  </details>
</section>`;
}

// ---------- layout ----------
const layout = ({ title, desc = cfg.description, path: p = '/', body, ogType = 'website' }) => `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${abs(p)}">
<meta property="og:type" content="${ogType}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${abs(p)}"><meta property="og:site_name" content="${esc(cfg.title)}"><meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary">
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.title)}" href="${u('/rss.xml')}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📈</text></svg>">
<link rel="stylesheet" href="${u('/assets/style.css')}">
<script>try{const t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
</head><body>
<header class="top"><div class="wrap">
  <a class="brand" href="${u('/')}"><span class="logo">📈</span>${esc(cfg.title)}</a>
  <nav><a href="${u('/archive/')}">아카이브</a><a href="${u('/about/')}">소개</a><a href="${u('/rss.xml')}">RSS</a>
  <button class="theme" aria-label="테마 전환" onclick="const r=document.documentElement;const n=(r.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'))==='dark'?'light':'dark';r.dataset.theme=n;localStorage.setItem('theme',n)">◐</button></nav>
</div></header>
<main class="wrap">${body}</main>
<footer class="foot"><div class="wrap">
  <p>${esc(cfg.disclaimer)}</p>
  <p>© ${new Date().getFullYear()} ${esc(cfg.title)} · 매일 아침 ${esc(cfg.publishTime)} 발행</p>
</div></footer>
</body></html>`;

// ---------- load ----------
const postsDir = path.join(ROOT, 'content', 'posts');
const snapDir = path.join(ROOT, 'data', 'snapshots');
const files = (await fs.readdir(postsDir).catch(() => [])).filter((f) => f.endsWith('.md'));
const posts = [];
for (const f of files) {
  const { data, body } = parseFrontmatter(await fs.readFile(path.join(postsDir, f), 'utf8'));
  if (data.draft) continue;
  const slug = f.replace(/\.md$/, '');
  const snapFile = path.join(snapDir, `${data.snapshot || data.date}.json`);
  const snap = await fs.readFile(snapFile, 'utf8').then(JSON.parse).catch(() => null);
  const html = marked.parse(body);
  const chars = body.replace(/\s/g, '').length;
  posts.push({ ...data, slug, html, snap, tags: data.tags || [], highlights: data.highlights || [], readMin: Math.max(1, Math.round(chars / 600)) });
}
posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug < b.slug ? 1 : -1));

// ---------- render ----------
await fs.rm(DIST, { recursive: true, force: true });
const write = async (p, s) => { const f = path.join(DIST, p); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, s); };
const postUrl = (p) => `/posts/${p.slug}/`;
const tagUrl = (t) => `/tags/${encodeURIComponent(t)}/`;
const tagLinks = (tags) => tags.map((t) => `<a class="tag" href="${u(tagUrl(t))}">#${esc(t)}</a>`).join('');
const typeLabel = (p) => (p.type === 'weekly' ? '주간 프리뷰' : '모닝 브리프');

const listItem = (p) => `
<li class="item"><a href="${u(postUrl(p))}">
  <div class="item-meta"><span class="badge ${p.type || 'daily'}">${typeLabel(p)}</span><time>${krDate(p.date)}</time></div>
  <div class="item-title">${esc(p.title)}</div>
  <div class="item-sum">${esc(p.summary || '')}</div>
  ${p.snap ? `<div class="item-tickers">${[...p.snap.us.indices.slice(0, 2), ...p.snap.kr.indices.slice(0, 1)].map((i) => `<span class="${dir(i.changePct)}">${esc(i.name)} ${pct(i.changePct)}</span>`).join('')}</div>` : ''}
</a></li>`;

// posts
for (const [idx, p] of posts.entries()) {
  const newer = posts[idx - 1], older = posts[idx + 1];
  const body = `
<article class="post">
  <div class="post-head">
    <div class="item-meta"><span class="badge ${p.type || 'daily'}">${typeLabel(p)}</span><time datetime="${p.date}">${krDate(p.date)}</time><span>· ${p.readMin}분</span></div>
    <h1>${esc(p.title)}</h1>
    ${p.summary ? `<p class="lede">${esc(p.summary)}</p>` : ''}
    <div class="tags">${tagLinks(p.tags)}</div>
  </div>
  ${p.highlights.length ? `<aside class="tldr"><div class="tldr-h">오늘의 핵심</div><ul>${p.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></aside>` : ''}
  ${dashboard(p.snap)}
  <div class="prose">${p.html}</div>
  <p class="disclaimer">${esc(cfg.disclaimer)}</p>
  <nav class="pn">${older ? `<a href="${u(postUrl(older))}">← ${esc(older.title)}</a>` : '<span></span>'}${newer ? `<a href="${u(postUrl(newer))}">${esc(newer.title)} →</a>` : ''}</nav>
</article>`;
  await write(`posts/${p.slug}/index.html`, layout({ title: `${p.title} | ${cfg.title}`, desc: p.summary, path: postUrl(p), body, ogType: 'article' }));
}

// home
const latest = posts[0];
await write('index.html', layout({ title: cfg.title, path: '/', body: `
<section class="hero">
  <p class="eyebrow">${esc(cfg.tagline)}</p>
  ${latest ? `<a class="hero-card" href="${u(postUrl(latest))}">
    <div class="item-meta"><span class="badge ${latest.type || 'daily'}">오늘의 ${typeLabel(latest)}</span><time>${krDate(latest.date)}</time></div>
    <h1>${esc(latest.title)}</h1><p>${esc(latest.summary || '')}</p>
    ${latest.highlights.length ? `<ul>${latest.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
    <span class="cta">전체 브리프 읽기 →</span></a>
  ${latest.snap ? `<div class="cards mini">${[...latest.snap.us.indices.slice(0, 3), ...latest.snap.kr.indices, latest.snap.macro[0]].filter(Boolean).map((i) => card(i)).join('')}</div>` : ''}` : '<p>첫 브리프를 준비 중이에요.</p>'}
</section>
<section><h2 class="sec-h">최근 브리프</h2><ul class="list">${posts.slice(1, 15).map(listItem).join('') || '<li class="empty">아직 지난 글이 없어요.</li>'}</ul>
${posts.length > 15 ? `<p><a href="${u('/archive/')}">전체 아카이브 →</a></p>` : ''}</section>` }));

// archive
const byMonth = {};
for (const p of posts) (byMonth[p.date.slice(0, 7)] ||= []).push(p);
const allTags = [...new Set(posts.flatMap((p) => p.tags))].sort();
await write('archive/index.html', layout({ title: `아카이브 | ${cfg.title}`, path: '/archive/', body: `
<h1 class="page-h">아카이브</h1>
<input class="filter" type="search" placeholder="제목·요약 검색" oninput="const q=this.value.toLowerCase();document.querySelectorAll('.list .item').forEach(li=>li.hidden=!li.textContent.toLowerCase().includes(q))">
<div class="tags">${allTags.map((t) => `<a class="tag" href="${u(tagUrl(t))}">#${esc(t)}</a>`).join('')}</div>
${Object.entries(byMonth).map(([m, ps]) => `<h2 class="sec-h">${m.replace('-', '년 ')}월 <small>${ps.length}편</small></h2><ul class="list">${ps.map(listItem).join('')}</ul>`).join('')}` }));

// tags
for (const t of allTags) {
  const ps = posts.filter((p) => p.tags.includes(t));
  await write(`tags/${t}/index.html`, layout({ title: `#${t} | ${cfg.title}`, path: tagUrl(t), body: `<h1 class="page-h">#${esc(t)} <small>${ps.length}편</small></h1><ul class="list">${ps.map(listItem).join('')}</ul>` }));
}

// about
await write('about/index.html', layout({ title: `소개 | ${cfg.title}`, path: '/about/', body: `<article class="post"><h1 class="page-h">소개</h1><div class="prose">${marked.parse(cfg.about)}</div></article>` }));

// 404
await write('404.html', layout({ title: `페이지를 찾을 수 없어요 | ${cfg.title}`, path: '/404.html', body: `<h1 class="page-h">404</h1><p>페이지를 찾을 수 없어요. <a href="${u('/')}">홈으로</a></p>` }));

// rss
const rfc = (d) => new Date(`${d}T07:30:00+09:00`).toUTCString();
await write('rss.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${esc(cfg.title)}</title><link>${abs('/')}</link><description>${esc(cfg.description)}</description><language>ko</language>
<atom:link href="${abs('/rss.xml')}" rel="self" type="application/rss+xml"/>
${posts.slice(0, 30).map((p) => `<item><title>${esc(p.title)}</title><link>${abs(postUrl(p))}</link><guid>${abs(postUrl(p))}</guid><pubDate>${rfc(p.date)}</pubDate><description><![CDATA[${p.summary || ''}${p.highlights.length ? `<ul>${p.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}${p.html}]]></description></item>`).join('\n')}
</channel></rss>`);

// sitemap + robots
const urls = ['/', '/archive/', '/about/', ...posts.map(postUrl), ...allTags.map(tagUrl)];
await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((x) => `<url><loc>${abs(x)}</loc></url>`).join('')}</urlset>`);
await write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${abs('/sitemap.xml')}\n`);
await write('.nojekyll', '');

// assets
await fs.cp(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), { recursive: true });
console.log(`built ${posts.length} posts, ${allTags.length} tags -> dist/ (base "${BASE}")`);
