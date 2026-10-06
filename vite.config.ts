import { defineConfig } from 'vitest/config';
import { wgslImports } from './tools/vite-wgsl.js';

/**
 * Vite configuration.
 *
 * WGSL files are imported as strings (`import src from './x.wgsl'`), after the
 * `// #import "path.wgsl"` lines in them are resolved by the same resolver the CI
 * validator uses (see tools/wgsl-resolve.js and docs/adr/0002-stack-and-build.md).
 */
export default defineConfig({
  plugins: [wgslImports()],
  build: { target: 'es2022' },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
