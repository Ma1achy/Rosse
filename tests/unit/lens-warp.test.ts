/**
 * A deep-field drawing through the lens bends (`WarpKind.lens`, ADR 0101): every vertex is put at
 * its own primary image, where the single matrix of ADR 0097 only stretched the drawing straight.
 */
import { describe, expect, it } from 'vitest';
import { packNoise } from '../../src/core/noise';
import { presetParams } from '../../src/core/presets';
import { expandCap, vectorInputs } from '../../src/fallback/kernels/vector';
import { lensImage } from '../../src/fallback/kernels/lens-sky';
import { writeRow } from '../../src/model/dynvec';
import { skyLens } from '../../src/sim/lens';
import { DRAWING_WORDS } from '../../src/marks/vector';
import { VINST_WORDS, WarpKind, packedLibrary } from '../../src/model/vectors';
import { cameraOf, PLATE } from '../../src/view/camera';
import { META } from './support/vectors';

const lib = packedLibrary(META.vectors);
/** the drawing with the most strokes of the library: a long one bends the most */
const BIG = (() => {
  let best = 0;
  for (let d = 0; d < lib.nDrawings; d++)
    if ((lib.table[d * DRAWING_WORDS + 7] ?? 0) > (lib.table[best * DRAWING_WORDS + 7] ?? 0))
      best = d;
  return best;
})();

/**
 * A drawing of `size` px at (x, y): every kept stroke end through the lens vertex by vertex, and
 * where ADR 0097's single matrix (the Jacobian at the centre) would have put the same end.
 */
function place(x: number, y: number, size: number) {
  const P = presetParams('Lens: Einstein ring', 7, { lensField: 1 });
  const L = skyLens(P, cameraOf(P));
  if (!L) throw new Error('no lens');
  const n = lib.table[BIG * DRAWING_WORDS + 7] ?? 0;
  const spec = { rows: 1, strideCaps: n, strideDots: 0, strideBlobs: 0 };
  const run = (warp: number) => {
    const fl = new Float32Array(VINST_WORDS);
    const u = new Uint32Array(fl.buffer);
    writeRow(fl, u, 0, spec, { m: [size, 0, 0, size], x, y, ps: 0.42, drawing: BIG, warp });
    // the post hook as the identity: the drawing as placed, before any lens
    fl.set([0, 0, 0, 0], 8);
    fl.set([1, 0, 0, 1], 12);
    const X = vectorInputs(
      lib,
      {
        inst: fl.buffer,
        streamSegs: new ArrayBuffer(32),
        uniform: { n_inst: 1, n_cap_slots: n, wobble: 0, pen_line: 2.4 },
      } as never,
      new Uint32Array(24),
      new Float32Array(24),
      packNoise(),
      undefined,
      L,
    );
    const out = new Float32Array(n * 8);
    const keep: number[] = [];
    for (let i = 0; i < n; i++) keep.push(expandCap(X, i, out));
    return { out, keep };
  };
  const lensed = run(WarpKind.lens);
  const plain = run(WarpKind.post);
  const li = lensImage(L, x, y);
  const ends: number[][] = [];
  let worst = 0;
  for (let i = 0; i < n; i++) {
    if (lensed.keep[i] !== 0 || plain.keep[i] !== 0) continue;
    const ax = lensed.out[i * 8] ?? 0;
    const ay = lensed.out[i * 8 + 1] ?? 0;
    const dx = (plain.out[i * 8] ?? 0) - x;
    const dy = (plain.out[i * 8 + 1] ?? 0) - y;
    const lx = li.x + li.m[0] * dx + li.m[2] * dy;
    const ly = li.y + li.m[1] * dx + li.m[3] * dy;
    worst = Math.max(worst, Math.hypot(ax - lx, ay - ly));
    ends.push([ax, ay]);
  }
  return { ends, worst };
}

describe('WarpKind.lens', () => {
  it('draws the strokes of a lensed drawing', () => {
    const r = place(PLATE / 2 + 120, PLATE / 2, 60);
    expect(r.ends.length).toBeGreaterThan(50);
    expect(r.ends.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });

  it('bends a drawing at the ring, which a single matrix only stretched, and leaves a far one alone', () => {
    const near = place(PLATE / 2 + 120, PLATE / 2, 90);
    const far = place(PLATE / 2 + 380, PLATE / 2, 90);
    // the vertices leave the straight-stretched drawing by many pixels at the ring ...
    expect(near.worst).toBeGreaterThan(8);
    // ... and by far fewer where the lens is weak
    expect(far.worst).toBeLessThan(near.worst / 3);
  });
});
