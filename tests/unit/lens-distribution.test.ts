/**
 * Our lens picks (src/sim/lens.ts `ownLensPicks` and the cluster's halos, on the counter RNG of
 * ADR 0004) against v21's (`lensModel` and `lensSprites10` replayed on v21's own streams,
 * tests/golden/compare/v21-lens.ts), over 2,000 seeds: the same distributions, pick by pick. The
 * golden runs draw the lens with v21's replayed picks (ADR 0051), so this test is what keeps the
 * engine's own picks honest.
 *
 * Categorical picks (arms, how many sources and members, which drawing) by a two-sample χ² test at
 * the 0.1% level; continuous ones (angles, distances, sizes, bulges, member strengths) by their
 * means and standard deviations within 4 standard errors (./support/vectors.ts).
 */
import { describe, it } from 'vitest';
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { ownLensPicks, type LensPicks } from '../../src/sim/lens';
import { v21LensPlan } from '../golden/compare/v21-lens';
import { FULL_META, ROOT } from './support/meta';
import { sameCounts, sameMoments } from './support/vectors';

const N = 2000;
const WHOLE = FULL_META.vectors?.whole?.type ?? [];

function sample(P: (seed: number) => Params) {
  const ours: LensPicks[] = [];
  const v21: LensPicks[] = [];
  for (let s = 1; s <= N; s++) {
    const p = P(s);
    ours.push(ownLensPicks(p, FULL_META));
    v21.push(v21LensPlan(p, ROOT, WHOLE).picks);
  }
  return { ours, v21 };
}

type Sides = ReturnType<typeof sample>;
const both = (S: Sides, f: (p: LensPicks) => number[]) =>
  [S.ours.flatMap(f), S.v21.flatMap(f)] as const;
const per = (
  p: LensPicks,
  f: (s: NonNullable<LensPicks['sources']>[number]) => number | undefined,
) =>
  (p.sources ?? []).flatMap((s) => {
    const v = f(s);
    return v === undefined ? [] : [v];
  });

describe("the lens's picks: the same distributions as v21's, over 2,000 seeds", () => {
  it('one source galaxy (Lens: Einstein ring)', { timeout: 120_000 }, () => {
    const S = sample((s) => presetParams('Lens: Einstein ring', s));
    sameCounts('arms', ...both(S, (p) => per(p, (x) => x.opts?.arms)));
    sameMoments('incl', ...both(S, (p) => per(p, (x) => x.opts?.incl)));
    sameMoments('pa', ...both(S, (p) => per(p, (x) => x.opts?.pa)));
  });

  it('the cluster (Lens: galaxy cluster)', { timeout: 300_000 }, () => {
    const S = sample((s) => presetParams('Lens: galaxy cluster', s));
    sameCounts('sources', ...both(S, (p) => [p.sources?.length ?? 0]));
    sameCounts('members', ...both(S, (p) => [p.halos?.length ?? 0]));
    sameCounts('arms', ...both(S, (p) => per(p, (x) => x.opts?.arms)));
    sameCounts('flocculent', ...both(S, (p) => per(p, (x) => ((x.opts?.flocc ?? 0) > 0 ? 1 : 0))));
    sameMoments('bulge', ...both(S, (p) => per(p, (x) => x.opts?.bulge)));
    sameMoments('incl', ...both(S, (p) => per(p, (x) => x.opts?.incl)));
    sameMoments('pa', ...both(S, (p) => per(p, (x) => x.opts?.pa)));
    sameMoments('angle', ...both(S, (p) => per(p, (x) => x.a)));
    sameMoments('distance', ...both(S, (p) => per(p, (x) => x.d)));
    sameMoments('size', ...both(S, (p) => per(p, (x) => x.sz)));
    sameMoments('member x', ...both(S, (p) => (p.halos ?? []).map((h) => h.x)));
    sameMoments('member y', ...both(S, (p) => (p.halos ?? []).map((h) => h.y)));
    sameMoments('member b', ...both(S, (p) => (p.halos ?? []).map((h) => h.b)));
    sameMoments('member q', ...both(S, (p) => (p.halos ?? []).map((h) => h.q)));
    sameMoments('member angle', ...both(S, (p) => (p.halos ?? []).map((h) => h.ang)));
    sameCounts('member drawings', ...both(S, (p) => p.members ?? []));
  });

  it('the sketch (A sketch, lensed)', { timeout: 120_000 }, () => {
    const S = sample((s) => presetParams('A sketch, lensed', s));
    sameCounts('drawing', ...both(S, (p) => (p.drawing === undefined ? [] : [p.drawing])));
  });
});
