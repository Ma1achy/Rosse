import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWgsl } from '../../tools/wgsl-resolve.js';

/** The `// #import` resolver shared by the Vite plugin and the CI validator. */
describe('resolveWgsl', () => {
  const root = mkdtempSync(join(tmpdir(), 'wgsl-'));
  mkdirSync(join(root, 'common'));
  writeFileSync(join(root, 'common/a.wgsl'), 'const A: f32 = 1.0;');
  writeFileSync(join(root, 'common/b.wgsl'), '// #import "common/a.wgsl"\nconst B: f32 = A;');
  writeFileSync(
    join(root, 'main.wgsl'),
    '// #import "common/a.wgsl"\n// #import "common/b.wgsl"\nconst C: f32 = B;',
  );
  writeFileSync(join(root, 'loop.wgsl'), '// #import "loop.wgsl"');

  it('inlines each file once, dependencies first', () => {
    const { code, deps } = resolveWgsl(join(root, 'main.wgsl'), root);
    expect(code.match(/const A/g)).toHaveLength(1);
    expect(code.indexOf('const A')).toBeLessThan(code.indexOf('const B'));
    expect(deps).toHaveLength(3);
  });

  it('rejects cycles', () => {
    expect(() => resolveWgsl(join(root, 'loop.wgsl'), root)).toThrow(/cycle/);
  });
});
