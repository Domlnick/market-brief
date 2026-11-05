// 로컬 미리보기: BASE_PATH='' node scripts/build.mjs && node scripts/serve.mjs
import http from 'node:http'; import fs from 'node:fs/promises'; import path from 'node:path';
const DIST = path.resolve('dist'); const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.xml': 'application/xml', '.txt': 'text/plain' };
http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  try { const b = await fs.readFile(path.join(DIST, p)); res.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(await fs.readFile(path.join(DIST, '404.html')).catch(() => '404')); }
}).listen(process.env.PORT || 4321, () => console.log('http://localhost:' + (process.env.PORT || 4321)));
