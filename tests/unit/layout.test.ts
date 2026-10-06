import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WgslReflect } from 'wgsl_reflect';
import { resolveWgsl } from '../../tools/wgsl-resolve.js';
import { INSTANCE_LAYOUT, packInstances, type StructLayout } from '../../src/marks/instance';
import { packStruct } from '../../src/gpu/buffers';
import { SPRITE_UNIFORMS_LAYOUT } from '../../src/render/sprites';
import { COMPOSITE_UNIFORMS_LAYOUT } from '../../src/render/composite';
import { GALAXY_LAYOUT, GROUP_LAYOUT } from '../../src/model/galaxy';
import { CULLS_LAYOUT } from '../../src/fallback/kernels/project';
import {
  CAPSULE_LAYOUT,
  CURVE_LAYOUT,
  CURVE_STATE_LAYOUT,
  HATCH_LAYOUT,
  RIBBON_SEG_LAYOUT,
  RIB_LAYOUT,
} from '../../src/model/ribbons';
import { RIBBON_DRAW_LAYOUT } from '../../src/render/ribbon-pass';
import { VIEW_LAYOUT } from '../../src/view/camera';
import { SAMPLE_LAYOUT } from '../../src/fallback/kernels/stipple';

/**
 * Struct layouts are written twice, in WGSL and in TypeScript (ADR 0002). These tests parse the
 * WGSL declarations with wgsl_reflect and check every TS layout against them: size, alignment,
 * and each field's name, type, offset and size.
 */
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

describe('struct layouts (WGSL = TS)', () => {
  it('Instance', () => {
    checkLayout('common/instance.wgsl', INSTANCE_LAYOUT);
  });

  it('the sprite shader sees the same Instance', () => {
    checkLayout('render/sprite.wgsl', INSTANCE_LAYOUT);
  });

  it('Sprite uniforms', () => {
    checkLayout('render/sprite.wgsl', SPRITE_UNIFORMS_LAYOUT);
  });

  it('Composite uniforms', () => {
    checkLayout('render/composite.wgsl', COMPOSITE_UNIFORMS_LAYOUT);
  });

  it('Galaxy (the stipple model description)', () => {
    checkLayout('compute/stipple.wgsl', GALAXY_LAYOUT);
  });

  it('Sample (the model tier output), in the writer and the reader', () => {
    checkLayout('compute/stipple.wgsl', SAMPLE_LAYOUT);
    checkLayout('compute/project.wgsl', SAMPLE_LAYOUT);
  });

  it('View (the camera of the view tier)', () => {
    checkLayout('compute/project.wgsl', VIEW_LAYOUT);
  });

  it('the stipple passes write the Instance the sprite shader reads', () => {
    checkLayout('compute/project.wgsl', INSTANCE_LAYOUT);
    checkLayout('compute/scan.wgsl', INSTANCE_LAYOUT);
  });

  it('M4: ring knots and clumps, dust culls', () => {
    checkLayout('compute/stipple.wgsl', GROUP_LAYOUT);
    checkLayout('compute/project.wgsl', CULLS_LAYOUT);
  });

  it('M4: the line-work kernels and render pipelines', () => {
    for (const l of [
      RIB_LAYOUT,
      CURVE_LAYOUT,
      CURVE_STATE_LAYOUT,
      HATCH_LAYOUT,
      RIBBON_SEG_LAYOUT,
      CAPSULE_LAYOUT,
      INSTANCE_LAYOUT,
    ])
      checkLayout('compute/ribbons.wgsl', l);
    checkLayout('render/ribbon.wgsl', RIBBON_SEG_LAYOUT);
    checkLayout('render/ribbon.wgsl', CAPSULE_LAYOUT);
    checkLayout('render/ribbon.wgsl', RIBBON_DRAW_LAYOUT);
  });

  it('packs uniform structs by layout', () => {
    const b = packStruct(SPRITE_UNIFORMS_LAYOUT, {
      ink: [1, 1, 1, 1],
      target_size: [800, 800],
      edge: [0.12, 0.55],
      px_per_unit: 1,
      gain: 1,
      cell: 32,
      max_lod: 5,
      layer_base: 256,
      layer_count: 256,
    });
    expect(new Float32Array(b)[10]).toBe(32);
    expect(new Uint32Array(b)[12]).toBe(256);
    expect(() => packStruct(SPRITE_UNIFORMS_LAYOUT, {})).toThrow(/missing/);
  });

  it('packs instances at the declared offsets', () => {
    const buf = packInstances([
      { x: 1, y: 2, layer: 3, alpha: 0.5, m: [4, 5, 6, 7] },
      { x: 8, y: 9, layer: 10, alpha: 1, m: [11, 12, 13, 14] },
    ]);
    expect(buf.byteLength).toBe(2 * INSTANCE_LAYOUT.size);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    expect([f[0], f[1], u[2], f[3], f[4], f[7]]).toEqual([1, 2, 3, 0.5, 4, 7]);
    expect([f[8], u[10], f[15]]).toEqual([8, 10, 14]);
  });
});
