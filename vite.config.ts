import { defineConfig } from 'vitest/config';
import { wgslImports } from './tools/vite-wgsl.js';

/**
 * Vite configuration.
 *
 * WGSL files are imported as strings (`import src from './x.wgsl'`), after the
 * `// #import "path.wgsl"` lines in them are resolved by the same resolver the CI
 * validator uses (see tools/wgsl-resolve.js and docs/adr/0002-stack-and-build.md).
 *
 * `assets-built/` (written by `npm run prepare-assets`) is the public directory: the page fetches
 * the packed atlases from it, and the build copies it into dist/.
 */
export default defineConfig({
  plugins: [wgslImports()],
  build: { target: 'es2022' },
  // the CPU engine's worker (src/fallback/worker.ts) is an ES module
  worker: { format: 'es' },
  publicDir: 'assets-built',
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // the merger and shell tests run v21's own simulators beside the engine's: seconds each, more under load
    testTimeout: 120_000,
    // wgsl_reflect's "main" is a CommonJS build inside a "type": "module" package; use its ES build.
    alias: { wgsl_reflect: 'wgsl_reflect/wgsl_reflect.module.js' },
  },
});
