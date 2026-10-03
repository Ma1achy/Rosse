// THROWAWAY: serves the repo root, runs the spike in headless Chromium (SwiftShader WebGPU), saves screenshots + results.json.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(require.resolve('playwright', { paths: ['/opt/node22/lib/node_modules'] })); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.md': 'text/markdown' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  let f = p; try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch { res.writeHead(404).end(); return; }
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }).end(d); });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await playwright.chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${port}/spikes/vector-lines/`);
await page.waitForFunction(() => window.__SPIKE_DONE === true, null, { timeout: 15 * 60 * 1000, polling: 1000 });
const err = await page.evaluate(() => window.__SPIKE_ERROR || null);
const shots = path.join(here, 'screenshots'); fs.mkdirSync(shots, { recursive: true });
const comps = await page.evaluate(() => [...document.querySelectorAll('canvas.comp')].map(c => [c.id, c.toDataURL('image/png')]));
for (const [id, url] of comps) { fs.writeFileSync(path.join(shots, id + '.png'), Buffer.from(url.split(',')[1], 'base64')); console.log('wrote', id + '.png'); }
await page.screenshot({ path: path.join(shots, 'full-page.png'), fullPage: true });
const results = await page.evaluate(() => window.__SPIKE_RESULTS);
results.error = err;
results.runner = { date: new Date().toISOString(), chromium: browser.version(), args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'] };
fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify(results, null, 2));
await browser.close(); server.close();
if (err) { console.error('SPIKE ERROR', err); process.exit(1); }
console.log('ok');
