// @ts-check
/**
 * Resolves `// #import "relative/path.wgsl"` lines in WGSL sources.
 *
 * WGSL has no module system, so shared code (the RNG, camera maths, instance layout) lives in
 * src/shaders/common/ and is pasted in at build time. Paths are relative to src/shaders/. Each file
 * is included at most once per resolved shader; cycles are an error. The Vite plugin
 * (tools/vite-wgsl.js) and the CI validator (tools/validate-wgsl.mjs) share this function, so what
 * CI validates is exactly what the browser compiles.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const IMPORT = /^\s*\/\/\s*#import\s+"([^"]+)"\s*$/;

/**
 * @param {string} file absolute path of the WGSL file
 * @param {string} root absolute path of src/shaders
 * @returns {{ code: string, deps: string[] }}
 */
export function resolveWgsl(file, root) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const stack = [];
  /** @param {string} path */
  const visit = (path) => {
    if (stack.includes(path))
      throw new Error(`WGSL import cycle: ${[...stack, path].join(' -> ')}`);
    if (seen.has(path)) return '';
    seen.add(path);
    stack.push(path);
    const out = readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => {
        const m = IMPORT.exec(line);
        return m && m[1] ? visit(resolve(root, m[1])) : line;
      })
      .join('\n');
    stack.pop();
    return out;
  };
  const code = visit(resolve(file));
  return { code, deps: [...seen] };
}
