/**
 * Jets and stellar streams in 3D (ADR 0085): with `lineWorld` the jet runs along the galaxy's
 * own axis and the streams lie on orbits tilted out of its plane, both projected by the camera.
 */
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { describeParts, streamTilt, vectorRows } from '../../src/model/parts';
import { streamSegments } from '../../src/model/vectors';
import { cameraOf } from '../../src/view/camera';
import { v21Variation } from '../golden/compare/v21';
import { META } from './support/vectors';

const jetRows = (over: object, incl: number) => {
  const P = presetParams('Radio jet', 7, { ...over, incl });
  const V = v21Variation(P, META);
  const parts = describeParts(P, V, META, 0);
  return vectorRows(P, V, META, parts, cameraOf(P)).filter(
    (r) => r.atlas === 'misc' && r.tile === 0,
  );
};
const len = (r: { m: number[] }) => Math.hypot(r.m[0] ?? 0, r.m[1] ?? 0);

describe('the jet', () => {
  it("is v21's screen-plane sprite pair without lineWorld, whatever the tilt", () => {
    const a = jetRows({ lineWorld: 0 }, 20);
    const b = jetRows({ lineWorld: 0 }, 80);
    expect(a).toHaveLength(2);
    expect(a.map((r) => len(r))).toEqual(b.map((r) => len(r)));
  });

  it('with lineWorld points along the galaxy axis: long edge-on, a short blob face-on', () => {
    const face = jetRows({ lineWorld: 1 }, 0);
    const edge = jetRows({ lineWorld: 1 }, 88);
    expect(edge).toHaveLength(2);
    expect(len(edge[0] as { m: number[] })).toBeGreaterThan(2 * len(face[0] as { m: number[] }));
  });
});

describe('the stellar streams', () => {
  const parts = {
    streams: [
      [
        [1.5, 0],
        [1.4, 0.6],
        [1.1, 1.1],
      ],
    ],
  } as unknown as Parameters<typeof streamSegments>[0];
  const P = presetParams('Stellar streams', 7);
  const segs = (world: boolean) =>
    new Float32Array(
      streamSegments(parts, 1, world ? { cam: cameraOf(P, 1), seed: 7 } : undefined).buf,
    );
  const at = (incl: number) =>
    new Float32Array(streamSegments(parts, 1, { cam: { ...cameraOf(P), incl }, seed: 7 }).buf);

  it('keeps tilt in [0.35, 1.3] on its own counter', () => {
    for (let q = 0; q < 3; q++) {
      expect(streamTilt(7, q)).toBeGreaterThanOrEqual(0.35);
      expect(streamTilt(7, q)).toBeLessThanOrEqual(1.3);
    }
    expect(streamTilt(7, 0)).toBe(streamTilt(7, 0));
  });

  it('read no camera without lineWorld, and move with the camera with it', () => {
    expect(segs(false)).toEqual(segs(false));
    expect(Array.from(at(20))).not.toEqual(Array.from(at(80)));
  });
});
