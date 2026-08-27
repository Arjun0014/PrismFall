// Tiny static server for local play / browser tests.
//   node tools/serve.mjs [dir] [port]
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(ROOT, process.argv[2] || 'dist');
const port = +(process.argv[3] || 8013);
const TYPES = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.zip': 'application/zip' };

createServer((req, res) => {
  let f = join(dir, decodeURIComponent(req.url.split('?')[0]));
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(f));
}).listen(port, () => console.log('serving ' + dir + ' on http://localhost:' + port));
