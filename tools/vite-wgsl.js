// @ts-check
/**
 * Vite plugin: `import source from './x.wgsl'` gives the shader source as a string, with its
 * `// #import` lines resolved (see tools/wgsl-resolve.js). Imported files are watched in dev.
 */
import { resolve } from 'node:path';
import { resolveWgsl } from './wgsl-resolve.js';

const ROOT = resolve(import.meta.dirname, '../src/shaders');

/** @returns {import('vite').Plugin} */
export function wgslImports() {
  return {
    name: 'rosse-wgsl',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith('.wgsl')) return null;
      const { code, deps } = resolveWgsl(id, ROOT);
      deps.forEach((d) => {
        this.addWatchFile(d);
      });
      return `export default ${JSON.stringify(code)};`;
    },
  };
}
