/**
 * `fromVotes`: the drawing parameters of a real galaxy, from the volunteers' votes (Galaxy Zoo 2),
 * the photo's axis ratio and angle, and a few catalogue measurements. A pure function, v21's
 * (app23.js:L1321–1383) line for line, with v21's own `mulberry32` stream (`seed · 101 + 9`) for
 * the choices the votes do not decide. It does not touch the engine's counter RNG (ADR 0004): the
 * parameters are data, and the engine draws them with its own streams, as for any preset.
 *
 * Also here, as v21 has them: `fromReal` (L1319, a real galaxy of `real-galaxies.json`),
 * `catalogueSeed` (the seed `showCat` takes, L1790), `describe` (L1385) and `shortType` (L1392),
 * the sentences the page writes about a galaxy.
 *
 * One deliberate difference. v21's star-or-artefact branch returns the bare parameters, not
 * `{ p, odd }`, so its callers (`showReal`, `showCat`) read `res.p` as undefined and fail for such a
 * galaxy. None of the 42 real galaxies is one, but the catalogue has many. Here the branch returns
 * `{ p, odd: null }` like every other; `tests/unit/from-votes.test.ts` checks the parameters
 * against v21's bare return.
 *
 * Exactness: every expression keeps v21's operations in v21's order, so the doubles are the same
 * (tests/unit/from-votes.test.ts compares with values captured from v21 itself, by
 * `tools/capture-reference/votes.mjs`, with `toEqual`).
 */
import { DEF, type Params } from '../core/params';

/** The vote fractions of one galaxy: the fields of the catalogue, as fractions (0 to about 1). */
export interface Votes {
  smooth: number;
  feat: number;
  star: number;
  edge: number;
  bar: number;
  spiral: number;
  b0: number;
  b1: number;
  b2: number;
  b3: number;
  odd: number;
  ring: number;
  lens: number;
  disturbed: number;
  irregular: number;
  other: number;
  merger: number;
  dust: number;
  bround: number;
  bboxy: number;
  bnone: number;
  tight: number;
  medium: number;
  loose: number;
  a1: number;
  a2: number;
  a3: number;
  a4: number;
  amore: number;
  acant: number;
}

/** The catalogue measurements `fromVotes` may use. A missing one is left out (not zero). */
export interface Extras {
  conc?: number;
  r90?: number;
  gr?: number;
  z?: number;
  fdev?: number;
}

export type OddFeature = 'ring' | 'lens' | 'disturbed' | 'irregular' | 'other' | 'merger' | 'dust';

export interface FromVotes {
  p: Params;
  /** The strongest odd feature when `odd > 0.5`, else null. */
  odd: OddFeature | null;
}

/** One of the 42 real galaxies (`assets/data/rosse/real-galaxies/real-galaxies.json`). */
export interface RealGalaxy {
  id: string;
  ra: number;
  dec: number;
  q: number;
  pa: number;
  wind: number;
  votes: Votes & { round?: number; between?: number; cigar?: number };
  photo: string;
  n: number;
  from?: string;
  ex?: Extras;
}

/** v21's `MODEL_SIGN` (app23.js:L7): at winding +1 the model's arms measure S-wise. */
export const MODEL_SIGN = 1;

/** v21's `mulberry32` (app23.js:L71). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
const ARTEFACTS = ['trail', 'ghost', 'cosmic'];
const STROKES = ['mixed', 'mixed', 'plain', 'beaded', 'spurred', 'broken'];
const ODDS: OddFeature[] = ['ring', 'lens', 'disturbed', 'irregular', 'other', 'merger', 'dust'];

/**
 * v21's `fromVotes(v, qIn, paIn, windSign, seed, ex)`.
 *
 * @param v the votes
 * @param qIn the axis ratio b/a (clamped to 0.1 to 1)
 * @param paIn the position angle in degrees
 * @param windSign +1 or -1 where a winding sense is known (Galaxy Zoo 1), else 0 (the seed decides)
 * @param seed 1 to 9973, from the object id; it is the drawing's seed and seeds the choices here
 * @param ex the catalogue's measurements, if any
 */
export function fromVotes(
  v: Votes,
  qIn: number,
  paIn: number,
  windSign: number,
  seed: number,
  ex: Extras | null,
): FromVotes {
  const vv = v as unknown as Record<string, number>;
  const q = clamp(qIn, 0.1, 1);
  const p: Params = { ...DEF };
  const rr = mulberry32(seed * 101 + 9);
  p.seed = seed;
  p.pa = Math.round(paIn);
  p.vary = 0.45 + 0.4 * rr();
  p.pen = 2.0 + 0.8 * rr();
  p.winding = windSign ? (windSign === MODEL_SIGN ? 1 : -1) : seed % 2 ? 1 : -1;
  p.stroke = STROKES[Math.floor(rr() * 6)] as string;
  p.armStyle = 'ribbons';
  p.whole = 0;
  const cB = ex?.conc ? clamp((ex.conc - 2.15) / 1.2, 0, 1) : 0.4;
  const red = ex?.gr ? clamp((ex.gr - 0.55) / 0.4, 0, 1) : 0.5;
  const detail = ex?.r90 ? clamp((ex.r90 - 4) / 8, 0.15, 1) : 0.7;
  const fdev = ex && ex.fdev != null ? ex.fdev : 0.4;
  p.field = 0.15 + 0.45 * rr();
  p.bubbles = 0.2 + 0.6 * (1 - red);
  p.rewind = 1;
  p.knots = 0.06 + 0.6 * (1 - red);
  p.sparkle = 0.04 + 0.45 * (1 - red);
  p.stars = Math.round(6000 + 6000 * detail);
  p.lines = detail > 0.35 ? 0.8 : 0;
  p.fgstars = 0.15 + 0.3 * rr();
  const odd: OddFeature | null =
    v.odd > 0.5 ? ODDS.reduce((b, k) => ((vv[k] as number) > (vv[b] || 0) ? k : b), 'ring') : null;
  if (v.star > v.smooth && v.star > v.feat) {
    // volunteers said star or artefact: draw one (v21 returns the bare parameters here, see above)
    Object.assign(p, {
      subject: rr() < 0.7 ? 'star' : 'artefact',
      artefact: ARTEFACTS[Math.floor(rr() * 3)] as string,
      starBright: 0.45 + 0.5 * rr(),
      spikes: 0.4 + 0.6 * rr(),
      starRings: 0.5 * rr(),
      bleed: rr() < 0.5 ? 0.3 + 0.5 * rr() : 0,
    });
    return { p, odd: null };
  }
  if (v.smooth >= v.feat && v.smooth >= v.star) {
    const Cc = ex?.conc ? ex.conc : 2.9;
    const smoothDust = v.odd > 0.5 && v.dust > 0.4 ? 0.8 : 0;
    Object.assign(p, {
      arms: 0,
      bulge: 1,
      bulgeSize: 1.5,
      bulgeFlat: Math.max(q, 0.22),
      incl: 88,
      halo: 0.12,
      knots: 0,
      sparkle: 0,
      lines: 0,
      envelope: 0,
      stars: p.stars + 4000,
      sersicN: clamp(1 + (Cc - 2.1) * 2.6, 1, 4.5),
      re: clamp(2.3 / Cc, 0.55, 1.2),
      dust: smoothDust,
    });
    p.stars = Math.round(p.stars * (0.45 + 0.55 * clamp(q, 0.2, 1)));
    p.stars = Math.round(p.stars * (0.5 + 0.5 * Math.max(q, 0.22)));
  } else if (v.edge > 0.5) {
    const bs = v.bround + v.bboxy + v.bnone || 1;
    const qe = Math.sqrt(Math.max(0, (q * q - 0.12 * 0.12) / (1 - 0.12 * 0.12)));
    const ie = Math.round((Math.acos(clamp(qe, 0, 1)) * 180) / Math.PI);
    Object.assign(p, {
      incl: Math.max(84, ie),
      thick: clamp(0.17 * q, 0.028, 0.09),
      bulge: (0.6 * (0.35 * v.bround + 0.28 * v.bboxy + 0.04 * v.bnone)) / bs + 0.25 * cB,
      bulgeSize: 0.6 + 0.8 * cB,
      dust: v.dust > 0.3 ? 0.8 : 0.25 + 0.4 * (1 - red),
      arms: 2,
      lines: detail > 0.35 ? 0.5 : 0,
      stroke: 'plain',
    });
  } else {
    const q0 = 0.15;
    const c = Math.sqrt(Math.max(0, (q * q - q0 * q0) / (1 - q0 * q0)));
    p.incl = Math.round((Math.acos(clamp(c, 0, 1)) * 180) / Math.PI);
    const bsum = v.b0 + v.b1 + v.b2 + v.b3 || 1;
    const vb = (0.03 * v.b0 + 0.12 * v.b1 + 0.28 * v.b2 + 0.5 * v.b3) / bsum;
    p.bulge = clamp(0.55 * vb + 0.3 * cB * 0.55 + 0.15 * fdev * 0.5, 0.02, 0.75);
    p.bulgeSize = 0.45 + 0.9 * cB;
    p.armStrength = 0.55 + 0.35 * v.spiral;
    p.bar = v.bar > 0.5 ? 0.5 + 0.5 * v.bar : 0;
    p.barLen = 0.45;
    if (v.spiral > 0.5) {
      const counts: [number | 'cant', number][] = [
        [1, v.a1],
        [2, v.a2],
        [3, v.a3],
        [4, v.a4],
        [6, v.amore],
        ['cant', v.acant],
      ];
      const ac = counts.sort((a, b) => b[1] - a[1])[0]?.[0];
      if (ac === 'cant') {
        p.arms = 3;
        p.flocc = 0.75;
        p.stroke = 'broken';
      } else p.arms = ac as number;
      const ws = v.tight + v.medium + v.loose || 1;
      p.pitch = Math.round((12 * v.tight + 22 * v.medium + 36 * v.loose) / ws);
    } else {
      p.arms = 0;
      p.outline = 1;
      p.envelope = 0;
      p.knots *= 0.3;
    }
  }
  if (odd === 'ring') {
    p.ringOnlyLines = 1;
    p.ring = 0.85;
    p.ringR = 1.5;
    p.ringStyle = 'ribbon';
    p.stroke = 'faint';
    p.armStrength = Math.min(p.armStrength, 0.45);
    p.outline = 0;
    if (p.bar > 0) p.bar = Math.max(p.bar, 0.8);
  }
  if (odd === 'merger' && v.merger > 0.5) {
    p.merger = 1;
    p.incl = Math.round(rr() * 70);
    p.mSpin1 = rr() * 70;
    p.mSpin2 = rr() * 180;
    if (red > 0.6) {
      // a dry merger: two red, bulge-heavy galaxies close together
      p.mRatio = 0.6 + 0.4 * rr();
      p.mPeri = 0.6 + 0.6 * rr();
      p.mStage = 0.1 + 0.8 * rr();
      p.mBulge = 0.8;
      p.mFriction = 0.5;
      p.mType1 = rr() < 0.6 ? 'elliptical' : 'lenticular';
      p.mType2 = rr() < 0.5 ? 'elliptical' : 'lenticular';
    } else {
      p.mRatio = 0.35 + 0.65 * rr();
      p.mPeri = 0.8 + 1.2 * rr();
      p.mStage = 0.35 + 1.9 * rr();
      p.mBulge = 0.15 + 0.3 * cB;
      p.mFriction = rr() < 0.25 ? 0.6 : 0;
      p.mType1 = rr() < 0.8 ? 'spiral' : 'lenticular';
      p.mType2 = rr() < 0.7 ? 'spiral' : rr() < 0.5 ? 'lenticular' : 'elliptical';
    }
    p.mArms1 = 1 + Math.floor(rr() * 4);
    p.mArms2 = 1 + Math.floor(rr() * 4);
    p.mSize1 = 0.8 + 0.5 * rr();
    p.mSize2 = 0.7 + 0.6 * rr();
    p.mTilt = rr() < 0.5 ? rr() * 25 : rr() * 90;
    p.mEcc = 0.85 + 0.3 * rr();
    p.mBar1 = rr() < 0.25 ? 1 : 0;
  }
  if (odd === 'disturbed') p.tail = 0.6;
  if (
    (odd === 'irregular' && v.irregular > 0.5) ||
    (ex &&
      ex.gr != null &&
      ex.gr < 0.6 &&
      cB < 0.25 &&
      v.spiral < 0.55 &&
      v.edge < 0.4 &&
      v.smooth < v.feat)
  ) {
    p.irr = 1;
    p.arms = 0;
    p.lines = 0;
    p.bulge = Math.min(p.bulge, 0.05);
    p.knots = 0.8;
    p.outline = 0;
    p.vary = 1;
  }
  if (odd === 'lens' && v.lens > 0.5)
    Object.assign(p, {
      lensOn: 1,
      lensR: 1.1 + 0.6 * rr(),
      lensSrc: rr() < 0.25 ? 0.02 * rr() : 0.08 + 0.35 * rr(),
      lensSrcA: rr() * 360,
      lensShear: 0.02 + 0.14 * rr(),
      lensShearA: rr() * 180,
      lensSize: 0.08 + 0.3 * rr(),
    });
  if ((odd === 'disturbed' || odd === 'other') && v.smooth >= v.feat && red > 0.5 && rr() < 0.6)
    Object.assign(p, {
      shellsOn: 1,
      shellTime: 45 + 60 * rr(),
      shellAxis: rr() * 180,
      stars: Math.round(p.stars * 0.6),
    });
  if (odd === 'dust' && v.dust > 0.5) p.dust = Math.max(p.dust, 0.7);
  if (p.arms >= 1 && !p.irr) {
    p.dustLines = v.dust > 0.3 || rr() < 0.35 ? 0.4 + 0.5 * rr() : 0;
    if (rr() < 0.18) p.whole = 1;
  }
  if (p.incl > 80 && p.bulge < 0.95) p.dustLines = 0.3 + 0.6 * (1 - red) * rr();
  if (p.bulge >= 0.95) {
    if (rr() < 0.1 || ((odd === 'disturbed' || odd === 'other') && red > 0.5))
      p.streams = 0.6 + 0.4 * rr();
    if (red > 0.7 && rr() < 0.04) p.jet = 1;
  }
  // layers: every odd feature with a real share switches on its own layer; a real star-or-artefact
  // share adds an overlay (the star-or-artefact subject has returned above, so this is a galaxy)
  const oddOn =
    v.odd > 0.3
      ? (['ring', 'lens', 'disturbed', 'irregular', 'dust'] as const).filter(
          (k) => k !== odd && (vv[k] as number) >= 0.3,
        )
      : [];
  for (const k of oddOn) {
    if (k === 'ring') {
      p.ring = Math.max(p.ring || 0, 0.55);
      if (!p.ringR) p.ringR = 1.6;
    } else if (k === 'lens' && !p.lensOn)
      Object.assign(p, {
        lensOn: 1,
        lensR: 1.2 + 0.5 * rr(),
        lensSrc: 0.1 + 0.3 * rr(),
        lensSrcA: rr() * 360,
        lensSize: 0.12 + 0.06 * rr(),
        lensQ: 0.7 + 0.25 * rr(),
      });
    else if (k === 'disturbed') p.tail = Math.max(p.tail || 0, 0.45);
    else if (k === 'irregular') p.flocc = Math.max(p.flocc || 0, 0.45);
    else if (k === 'dust') {
      p.dust = Math.max(p.dust || 0, 0.6);
      p.dustLines = Math.max(p.dustLines || 0, 0.5);
    }
  }
  if (v.star >= 0.12) {
    p.ovStar = clamp(0.3 + 0.9 * v.star, 0.3, 0.95);
    p.ovStarD = 1.3 + 1.1 * rr();
    p.ovStarA = rr() * 360;
    if (v.star >= 0.25 && rr() < 0.3) p.ovArtefact = ARTEFACTS[Math.floor(rr() * 3)] as string;
  }
  return { p, odd };
}

/** v21's `fromReal(g)` (app23.js:L1319): one of the 42 real galaxies. */
export function fromReal(g: RealGalaxy): FromVotes {
  return fromVotes(
    g.votes,
    g.q,
    g.pa,
    Math.abs(g.wind) > 0.06 ? Math.sign(g.wind) : 0,
    (parseInt(g.id.slice(-6), 10) % 9973) + 1,
    g.ex ?? null,
  );
}

/** The seed of a catalogue galaxy, from its DR7 object id (v21's `showCat`, L1790). */
export function catalogueSeed(objid: bigint): number {
  return Number(objid % 9973n) + 1;
}

/** What `describe` reads of a galaxy (v21's `g` in `showReal` and `showCat`). */
export interface DescribeInput {
  votes: Votes;
  n: number;
  q: number;
  pa: number;
  wind: number;
}

/** v21's `describe(g, res)` (L1385): the sentence under the plate. */
export function describe(g: DescribeInput, res: FromVotes): string {
  const v = g.votes;
  const bits: string[] = [];
  if (v.smooth >= v.feat) bits.push(String(Math.round(v.smooth * 100)) + '% smooth');
  else {
    bits.push(String(Math.round(v.feat * 100)) + '% features or disc');
    if (v.edge > 0.5) bits.push('edge-on');
    else {
      if (v.bar > 0.5) bits.push(String(Math.round(v.bar * 100)) + '% barred');
      if (v.spiral > 0.5)
        bits.push(
          res.p.arms === 3 && res.p.flocc > 0.5
            ? 'arms uncountable'
            : String(res.p.arms) + (res.p.arms === 1 ? ' arm' : ' arms'),
        );
    }
  }
  if (res.odd) bits.push('odd: ' + res.odd);
  return (
    (g.n >= 255 ? '255+' : String(g.n)) +
    ' volunteers: ' +
    bits.join(', ') +
    '. Axis ratio ' +
    g.q.toFixed(2) +
    ', angle ' +
    String(Math.round(g.pa)) +
    '° measured from the photo' +
    (Math.abs(g.wind) > 0.06 ? '; winds ' + (g.wind > 0 ? 'S' : 'Z') + '-wise' : '') +
    '.'
  );
}

/** v21's `shortType(p, odd)` (L1392): a few words for what Rosse drew. */
export function shortType(p: Params, odd: OddFeature | null): string {
  const n = Math.round(p.arms || 0);
  const num = ['', 'one', 'two', 'three', 'four', 'five', 'six'][n] || String(n);
  let t: string;
  if (p.subject === 'star') t = 'a star';
  else if (p.subject === 'artefact') t = 'an artefact';
  else if (p.merger) t = 'two galaxies merging';
  else if (n < 1 && (p.bulge || 0) >= 0.9)
    t = (p.bulgeFlat || 1) < 0.55 ? 'a cigar-shaped elliptical' : 'a round elliptical';
  else if ((p.incl || 0) > 80) t = 'an edge-on disc';
  else if (n < 1) t = 'a disc, no arms';
  else
    t =
      ((p.bar || 0) > 0.35 ? 'a barred spiral' : 'a spiral') +
      ', ' +
      num +
      ' arm' +
      (n > 1 ? 's' : '');
  const extra =
    odd === 'ring' || (p.ring || 0) > 0.3
      ? 'with a ring'
      : odd === 'lens' || p.lensOn
        ? 'lensed'
        : odd === 'dust' || (p.dustLines || 0) > 0.45
          ? 'with a dust lane'
          : odd === 'disturbed'
            ? 'disturbed'
            : odd === 'irregular'
              ? 'irregular'
              : '';
  return extra ? t + ', ' + extra : t;
}
