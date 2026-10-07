import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WgslReflect } from 'wgsl_reflect';
import { resolveWgsl } from '../../tools/wgsl-resolve.js';
import type { StructLayout } from '../../src/marks/instance';
import {
  MGAL_LAYOUT,
  MJOB_LAYOUT,
  MSEL_LAYOUT,
  MSIM_LAYOUT,
} from '../../src/fallback/kernels/merger';
import { MVIEW_LAYOUT } from '../../src/fallback/kernels/merger-sprites';
import { SSIM_LAYOUT } from '../../src/fallback/kernels/shells';
import { TJOB_LAYOUT } from '../../src/fallback/kernels/tide';

/**
 * The struct layouts of M8's kernels, written in WGSL and in TypeScript (ADR 0002), checked as
 * tests/unit/layout.test.ts checks the others: size, alignment, and each field's name, type,
 * offset and size.
 */
const SHADERS = resolve(import.meta.dirname, '../../src/shaders');

function typeName(t: { name: string; format?: { name: string } | null }): string {
  return t.format ? `${t.name}<${t.format.name}>` : t.name;
}

function check(file: string, ts: StructLayout) {
  const r = new WgslReflect(resolveWgsl(resolve(SHADERS, file), SHADERS).code);
  const s = r.structs.find((x) => x.name === ts.name);
  expect(s, `struct ${ts.name} in ${file}`).toBeDefined();
  if (!s) return;
  expect({ size: s.size, align: s.align }).toEqual({ size: ts.size, align: ts.align });
  expect(
    s.members.map((m) => ({
      name: m.name,
      type: typeName(m.type as { name: string; format?: { name: string } | null }),
      offset: m.offset,
      size: m.size,
    })),
  ).toEqual(ts.fields.map((f) => ({ ...f })));
}

describe('merger struct layouts (WGSL = TS)', () => {
  it('the test stars', () => {
    check('compute/merger.wgsl', MSIM_LAYOUT);
    check('compute/merger.wgsl', MGAL_LAYOUT);
    check('compute/merger.wgsl', MJOB_LAYOUT);
    check('compute/merger.wgsl', MSEL_LAYOUT);
  });
  it('the debris', () => {
    check('compute/merger-sprites.wgsl', MVIEW_LAYOUT);
  });
  it('the tides', () => {
    check('compute/tide-apply.wgsl', TJOB_LAYOUT);
  });
  it('the shells', () => {
    check('compute/shells.wgsl', SSIM_LAYOUT);
  });
});
