/**
 * Our part picks (src/model/parts.ts `ownPartPicks`, on the counter RNG of ADR 0004, every part on
 * its own index) against v21's (`parts()` replayed on v21's own stream,
 * tests/golden/compare/v21-parts.ts), over 2,000 seeds: the same distributions, pick by pick. The
 * golden runs place the parts with v21's replayed picks (ADR 0021), so this test is what keeps the
 * engine's own picks honest. Each side draws with its own variation (whose distributions
 * tests/unit/variation-distribution.test.ts checks), as each engine would.
 *
 * Categorical picks (which drawing, how many trails or bubbles) by a two-sample χ² test at the
 * 0.1% level; continuous ones (spins, sizes, places, the streams' radii and spans) by their means
 * and standard deviations within 4 standard errors (./support/vectors.ts).
 */
import { describe, it } from 'vitest';
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { ownPartPicks, type PartPicks } from '../../src/model/parts';
import { makeVariation } from '../../src/model/variation';
import { v21Variation } from '../golden/compare/v21';
import { v21PartPicks } from '../golden/compare/v21-parts';
import { META, sameCounts, sameMoments } from './support/vectors';

const N = 2000;

const ALL = {
  envelope: 1,
  ring: 0.5,
  whole: 1,
  nuclear: 1,
  lens: 0.7,
  shells: 0.5,
  tail: 0.5,
  trails: 0.8,
  field: 0.6,
  arrow: 1,
  bubbles: 1,
  jet: 1,
  streams: 1,
};

function sample(P: (seed: number) => Params) {
  const ours: PartPicks[] = [];
  const v21: PartPicks[] = [];
  for (let s = 1; s <= N; s++) {
    const p = P(s);
    ours.push(ownPartPicks(p, makeVariation(p, META), META, p.incl));
    v21.push(v21PartPicks(p, v21Variation(p, META), META));
  }
  return { ours, v21 };
}

type Sides = ReturnType<typeof sample>;
const both = (S: Sides, f: (p: PartPicks) => number[]) =>
  [S.ours.flatMap(f), S.v21.flatMap(f)] as const;
const one = (x: number | null | undefined) => (x === null || x === undefined ? [] : [x]);

describe("the parts' picks: the same distributions as v21's, over 2,000 seeds", () => {
  it('every part on (Grand design)', { timeout: 120_000 }, () => {
    const S = sample((s) => presetParams('Grand design', s, ALL));
    sameCounts('env tile', ...both(S, (p) => one(p.env?.tile)));
    sameMoments('env spin', ...both(S, (p) => one(p.env?.spin)));
    sameCounts('whole tile', ...both(S, (p) => one(p.whole?.tile)));
    sameMoments('whole spin', ...both(S, (p) => one(p.whole?.spin)));
    sameCounts('ring tile', ...both(S, (p) => one(p.ring?.tile)));
    sameMoments('ring spin', ...both(S, (p) => one(p.ring?.spin)));
    sameCounts('nuclear tile', ...both(S, (p) => one(p.nuclear)));
    sameCounts('arc tiles', ...both(S, (p) => p.arcs.map((a) => a.tile)));
    sameMoments('arc sizes', ...both(S, (p) => p.arcs.map((a) => a.u)));
    sameMoments('arc spins', ...both(S, (p) => p.arcs.map((a) => a.spin)));
    sameCounts('shells tile', ...both(S, (p) => one(p.shells?.tile)));
    sameMoments('shells spin', ...both(S, (p) => one(p.shells?.spin)));
    sameCounts('tail tile', ...both(S, (p) => one(p.tail?.tile)));
    sameMoments('tail angle', ...both(S, (p) => one(p.tail?.ang)));
    sameCounts('trails', ...both(S, (p) => [p.trails.length]));
    sameCounts('trail tiles', ...both(S, (p) => p.trails.map((t) => t.tile)));
    sameMoments('trail x', ...both(S, (p) => p.trails.map((t) => t.x)));
    sameMoments('trail y', ...both(S, (p) => p.trails.map((t) => t.y)));
    sameMoments('trail size', ...both(S, (p) => p.trails.map((t) => t.size)));
    sameMoments('trail turn', ...both(S, (p) => p.trails.map((t) => t.rot)));
    sameCounts('arrow drawn', ...both(S, (p) => [p.arrow ? 1 : 0]));
    sameMoments('arrow x', ...both(S, (p) => one(p.arrow?.x)));
    sameMoments('arrow size', ...both(S, (p) => one(p.arrow?.size)));
    sameCounts('bubbles', ...both(S, (p) => [p.bubbles.length]));
    sameCounts('bubble tiles', ...both(S, (p) => p.bubbles.map((b) => b.tile)));
    sameMoments('bubble clumps', ...both(S, (p) => p.bubbles.map((b) => b.clump)));
    sameMoments('bubble spins', ...both(S, (p) => p.bubbles.map((b) => b.spin)));
    sameMoments('jet angle', ...both(S, (p) => one(p.jet?.ang)));
    sameMoments('jet length', ...both(S, (p) => one(p.jet?.u)));
    sameCounts('streams', ...both(S, (p) => [p.streams.length]));
    sameCounts('stream tiles', ...both(S, (p) => p.streams.map((s) => s.tile)));
    sameMoments('stream R0', ...both(S, (p) => p.streams.map((s) => s.R0)));
    sameMoments('stream span', ...both(S, (p) => p.streams.map((s) => s.span)));
    sameMoments('stream a0', ...both(S, (p) => p.streams.map((s) => s.a0)));
  });

  it('drawn arms, an envelope by type, a drawn bar (Hand-drawn arms, Barred spiral)', () => {
    const A = sample((s) => presetParams('Hand-drawn arms', s, { envelope: 1 }));
    sameCounts('arm tiles', ...both(A, (p) => p.arms));
    sameCounts(
      'arms like the first',
      ...both(A, (p) => p.arms.map((a) => (a === p.arms[0] ? 1 : 0))),
    );
    sameCounts('env tile (halo or disc)', ...both(A, (p) => one(p.env?.tile)));
    const B = sample((s) => presetParams('Barred spiral', s, { whole: 1 }));
    sameCounts('bar tile', ...both(B, (p) => one(p.bar)));
    sameCounts('whole tile (barred)', ...both(B, (p) => one(p.whole?.tile)));
    sameCounts('ring tile', ...both(B, (p) => one(p.ring?.tile)));
    const T = sample((s) => presetParams('Tightly wound', s, { armStyle: 'drawn' }));
    sameCounts('tight arm tiles', ...both(T, (p) => p.arms));
  });
});
