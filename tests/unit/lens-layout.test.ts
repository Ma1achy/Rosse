import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WgslReflect } from 'wgsl_reflect';
import { resolveWgsl } from '../../tools/wgsl-resolve.js';
import type { StructLayout } from '../../src/marks/instance';
import { CURVE_LAYOUT } from '../../src/model/ribbons';
import { VINST_LAYOUT } from '../../src/model/vectors';
import {
  IMG_LAYOUT,
  LCURVE_LAYOUT,
  LENS_VIEW_CBASE,
  LENS_VIEW_CCAP,
  LENS_VIEW_WORDS,
  LMARKS_JOB_LAYOUT,
  LMARK_LAYOUT,
  LSRC_LAYOUT,
  SOLVER_LAYOUT,
} from '../../src/sim/lens-layouts';

/** The lens passes' structs, written in WGSL and in TypeScript, agree (ADR 0002). */
const SHADERS = resolve(import.meta.dirname, '../../src/shaders');

function reflect(file: string) {
  return new WgslReflect(resolveWgsl(resolve(SHADERS, file), SHADERS).code);
}

function typeName(t: { name: string; format?: { name: string } | null }): string {
  return t.format ? `${t.name}<${t.format.name}>` : t.name;
}

function checkLayout(file: string, ts: StructLayout) {
  const s = reflect(file).structs.find((x) => x.name === ts.name);
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

describe('the lens structs (WGSL = TS)', () => {
  it('Solver, in all three passes', () => {
    for (const f of ['compute/lens-grid.wgsl', 'compute/lens-bin.wgsl', 'compute/lens-query.wgsl'])
      checkLayout(f, SOLVER_LAYOUT);
    expect(SOLVER_LAYOUT.size).toBe(80);
  });

  it('LMark, Src, Img, CurveIn, Curve, VInst in lens-query', () => {
    const f = 'compute/lens-query.wgsl';
    checkLayout(f, LMARK_LAYOUT);
    checkLayout(f, LSRC_LAYOUT);
    checkLayout(f, IMG_LAYOUT);
    checkLayout(f, LCURVE_LAYOUT);
    checkLayout(f, CURVE_LAYOUT);
    checkLayout(f, VINST_LAYOUT);
  });

  it('LMark and the marks job in lens-marks', () => {
    checkLayout('compute/lens-marks.wgsl', LMARK_LAYOUT);
    checkLayout('compute/lens-marks.wgsl', LMARKS_JOB_LAYOUT);
  });

  it('LensView: 36 words, the class tables at 80 and 112 bytes', () => {
    const s = reflect('compute/lens-query.wgsl').structs.find((x) => x.name === 'LensView');
    expect(s?.size).toBe(LENS_VIEW_WORDS * 4);
    const at = (n: string) => s?.members.find((m) => m.name === n)?.offset;
    expect(at('cbase')).toBe(LENS_VIEW_CBASE * 4);
    expect(at('ccap')).toBe(LENS_VIEW_CCAP * 4);
    const names = [
      'seed',
      'n_marks',
      'n_slots',
      'n_qslots',
      'n_src',
      'blocks',
      'n_curves',
      'n_vec',
      'u',
      'ca',
      'sa',
      'pen_dot',
      'wobble',
      'spike',
      'now',
      'quasar_mark',
      'n_dot_pool',
      'n_star_pool',
      'max_pts',
      'max_branches',
    ];
    names.forEach((n, i) => {
      expect(at(n), n).toBe(i * 4);
    });
  });
});
