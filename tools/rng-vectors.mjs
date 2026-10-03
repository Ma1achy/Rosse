// @ts-check
/**
 * `npm run vectors`: regenerates tests/vectors/rng.json from src/core/rng.ts, by running the RNG
 * unit test with ROSSE_WRITE_VECTORS=1 (cross-platform: no shell variable syntax). Only do this on
 * purpose: the vectors pin the RNG's output for every implementation.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const vitest = resolve(
  createRequire(import.meta.url).resolve('vitest/package.json'),
  '../vitest.mjs',
);
const r = spawnSync(process.execPath, [vitest, 'run', 'tests/unit/rng.test.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ROSSE_WRITE_VECTORS: '1' },
});
process.exit(r.status ?? 1);
