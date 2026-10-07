/**
 * "Surprise me": a galaxy at random, as v21's button builds it (`$('surprise').onclick`,
 * app23.js:L1743–1760): a random preset, with the seed, tilt, roll, winding, pitch, strokes, whole
 * drawings, plates, pen and the rest drawn afresh, and sometimes a merger, a bright star or an
 * artefact laid on top. The random source is a parameter, so the choice is testable; the draws are
 * taken in v21's order, so the same random numbers give v21's galaxy where the page draws what v21
 * does. Parts the engine does not draw yet (FEATURES) are never added, and every number is
 * clamped by the schema.
 */
import { DEF, type Params } from '../core/params';
import { PRESETS } from '../core/presets';
import { sanitise } from '../core/schema';
import { FEATURES, type FeatureName } from './layout';

const round2 = (v: number) => Math.round(v * 100) / 100;

/** `names`: the presets to pick from (those the page can draw). */
export function surprise(
  r: () => number,
  names: readonly string[],
  features: Record<FeatureName, boolean> = FEATURES,
): { P: Params; preset: string } {
  const preset = names[Math.floor(r() * names.length)] ?? 'Grand design';
  const base: Partial<Params> = PRESETS[preset] ?? {};
  const P = {
    ...DEF,
    ...base,
    seed: 1 + Math.floor(r() * 9999),
    incl: base.incl ?? Math.round(r() * 85),
    pa: Math.round(r() * 180),
    winding: r() < 0.5 ? -1 : 1,
    pitch: base.pitch || Math.round(8 + r() * 30),
    lines: round2(0.3 + r() * 0.7),
    armStyle: r() < 0.3 ? 'drawn' : 'ribbons',
    whole: r() < 0.35 ? Math.round(r() * 60) / 100 : base.whole || 0,
    fgstars: round2(r() * 0.6),
    companions: base.companions || (r() < 0.2 ? 0.6 : 0),
    plates: base.plates || (r() < 0.2 ? (r() < 0.5 ? 'slip' : 'colour') : 'ink'),
    vary: round2(0.3 + 0.7 * r()),
    pen: Math.round((1.6 + 1.8 * r()) * 10) / 10,
  } as Params;
  // v21 sets `lines`, `whole` and `envelope` twice: the later draw wins
  P.lines = r() < 0.8 ? 0.8 : 0;
  P.whole = r() < 0.15 ? 1 : 0;
  P.envelope = r() < 0.15 ? 1 : 0;
  P.arms = base.arms ?? Math.floor(r() * 5);
  P.bar = base.bar ?? (r() < 0.3 ? 0.5 + 0.5 * r() : 0);
  P.ring = base.ring ?? (r() < 0.12 ? 0.8 : 0);
  P.bulge = base.bulge ?? Math.round(r() * r() * 60) / 100;
  P.flocc = base.flocc ?? (r() < 0.25 ? 0.4 + 0.5 * r() : 0);
  if (!features.merger) P.merger = 0;
  else if (!P.merger && r() < 0.22)
    Object.assign(P, {
      merger: 1,
      mRatio: 0.15 + 0.85 * r(),
      mPeri: 0.8 + 1.6 * r(),
      mStage: 0.3 + 3.5 * r(),
      mSpin1: Math.round(r() * 90),
      mSpin2: Math.round(r() * 180),
      mFriction: r() < 0.3 ? 0.7 : 0,
    });
  if (P.merger) {
    // every merger its own pair of galaxies
    const typ = () => {
      const u = r();
      return u < 0.6 ? 'spiral' : u < 0.8 ? 'lenticular' : 'elliptical';
    };
    Object.assign(P, {
      mType1: base.mType1 || typ(),
      mType2: base.mType2 || typ(),
      mArms1: base.mArms1 || 1 + Math.floor(r() * 4),
      mArms2: base.mArms2 || 1 + Math.floor(r() * 4),
      mSize1: round2(0.75 + 0.6 * r()),
      mSize2: round2(0.7 + 0.7 * r()),
      mBar1: r() < 0.25 ? 1 : 0,
      mBar2: r() < 0.2 ? 1 : 0,
      mTilt: base.mTilt ?? Math.round(r() < 0.5 ? r() * 25 : r() * 90),
      mEcc: base.mEcc || round2(0.85 + 0.3 * r()),
    });
  }
  const kinds = ['mixed', 'plain', 'beaded', 'spurred', 'broken', 'dotted'];
  P.stroke = kinds[Math.floor(r() * kinds.length)] ?? 'mixed';
  if (features.stars) {
    if (r() < 0.14) {
      P.ovStar = 0.4 + 0.5 * r();
      P.ovStarD = 1.2 + 1.4 * r();
      P.ovStarA = r() * 360;
    } else P.ovStar = 0;
    const arte = ['trail', 'ghost', 'cosmic'] as const;
    P.ovArtefact = r() < 0.08 ? (arte[Math.floor(r() * 3)] ?? 'none') : 'none';
    if (!base.subject && r() < 0.06)
      Object.assign(P, {
        merger: 0,
        subject: r() < 0.65 ? 'star' : 'artefact',
        artefact: arte[Math.floor(r() * 3)],
        starBright: 0.4 + 0.55 * r(),
        spikes: 0.3 + 0.7 * r(),
        starRings: r() * 0.7,
        bleed: r() < 0.5 ? 0.3 + 0.5 * r() : 0,
      });
  }
  return { P: sanitise(P), preset };
}
