// @ts-check
/**
 * Validates every WGSL file under src/shaders (and tests/gpu) with naga (https://github.com/gfx-rs/wgpu/tree/trunk/naga),
 * after resolving its `// #import` lines exactly as the build does.
 *
 * Needs the `naga` binary (`cargo install naga-cli`). CI installs and caches it. Files in
 * src/shaders/common/ are validated on their own too: they must be valid WGSL modules by
 * themselves (declarations only, no entry points required).
 *
 * Usage: node tools/validate-wgsl.mjs [--naga path/to/naga]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { resolveWgsl } from './wgsl-resolve.js';

const root = resolve(import.meta.dirname, '../src/shaders');
const nagaArg = process.argv.indexOf('--naga');
const naga = nagaArg > 0 ? process.argv[nagaArg + 1] : (process.env.NAGA ?? 'naga');

/** @param {string} dir @returns {string[]} */
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.wgsl') ? [join(dir, e.name)] : [],
  );

const tmp = mkdtempSync(join(tmpdir(), 'rosse-wgsl-'));
let failed = 0;
// shaders, and the test shaders of tests/gpu/ (which import from src/shaders/common/ too)
const tests = resolve(import.meta.dirname, '../tests/gpu');
const files = [...walk(root).sort(), ...walk(tests).sort()];
for (const file of files) {
  const name = relative(resolve(root, '../..'), file);
  const out = join(tmp, name.replaceAll('/', '__'));
  try {
    writeFileSync(out, resolveWgsl(file, root).code);
    execFileSync(naga, [out], { stdio: 'pipe' });
    console.log(`ok    ${name}`);
  } catch (e) {
    failed++;
    const err = /** @type {{ stderr?: Buffer, message: string }} */ (e);
    console.error(`FAIL  ${name}\n${err.stderr?.toString() ?? err.message}`);
  }
}
console.log(`${files.length - failed}/${files.length} WGSL files valid`);
process.exit(failed ? 1 : 0);
