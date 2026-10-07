// @ts-check
/**
 * `npm run readme:check`: fails if a README image link points at a file that is missing, if a
 * picture is over its size budget (plan.mjs BUDGET: a GIF 3 MB, a still 1.2 MB, docs/img as a whole
 * 50 MB), or if a picture under docs/img is not used by the README. Needs nothing but Node.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { BUDGET } from './plan.mjs';

const ROOT = join(import.meta.dirname, '../..');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const problems = /** @type {string[]} */ ([]);

// every src="...", srcset="..." and ![alt](...) that is a local file
const links = new Set(
  [
    ...[...readme.matchAll(/\b(?:src|srcset)="([^"]+)"/g)].map((m) => m[1]),
    ...[...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]),
  ].filter((l) => l && !/^(https?:|data:|#)/.test(l)),
);
for (const l of links) {
  const f = join(ROOT, /** @type {string} */ (l).split('?')[0] ?? '');
  if (!existsSync(f)) problems.push(`missing: ${l}`);
}

/** every file under docs/img */
function walk(/** @type {string} */ d) {
  /** @type {string[]} */
  const out = [];
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
let total = 0;
const used = new Set([...links].map((l) => join(ROOT, /** @type {string} */ (l))));
for (const f of walk(join(ROOT, 'docs/img'))) {
  const size = statSync(f).size;
  const ext = extname(f);
  const name = relative(ROOT, f);
  total += size;
  if (ext === '.gif' && size > BUDGET.gifMB * 1024 * 1024)
    problems.push(
      `${name}: ${(size / 1048576).toFixed(2)} MB is over the GIF budget (${String(BUDGET.gifMB)} MB)`,
    );
  if ((ext === '.jpg' || ext === '.png') && size > BUDGET.stillMB * 1024 * 1024)
    problems.push(
      `${name}: ${(size / 1048576).toFixed(2)} MB is over the still budget (${String(BUDGET.stillMB)} MB)`,
    );
  if (['.gif', '.jpg', '.png'].includes(ext) && !used.has(f) && !name.includes('cutouts'))
    problems.push(`${name}: not used by the README`);
}
if (total > BUDGET.totalMB * 1024 * 1024)
  problems.push(
    `docs/img is ${(total / 1048576).toFixed(1)} MB, over ${String(BUDGET.totalMB)} MB`,
  );

console.log(`${String(links.size)} image links, docs/img ${(total / 1048576).toFixed(1)} MB`);
if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log('ok');
