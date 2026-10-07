/**
 * Named random streams (ADR 0004): the `stream` word of the RNG key, one per stage that draws
 * random numbers. They replace the reference's ad hoc seed formulae (`P.seed * 9973 + 1` and
 * others). Values are fixed forever once a stage uses them, because changing one changes every
 * drawing made with it. New stages take the next free value; never reuse a retired one.
 */
export const Stream = {
  /** Reserved for tests and the shared vectors. */
  test: 0,
  /** Per-galaxy variation and the choice of hand (makeVariation). */
  variation: 1,
  /** Stipple sampling: bulge, halo, disc, bar and ring candidates. */
  stipple: 2,
  /** View-dependent culls: per-sample numbers stored at sampling time (dust lanes, breathing room). */
  stippleCull: 3,
  /** Knots along arms. */
  knots: 4,
  /** Clumps and spurs. */
  clumps: 5,
  /** Curves, ribbons and pieces. */
  curves: 6,
  /** Part placement: envelopes, whole drawings, bars, rings, cores. */
  parts: 7,
  /** The sky: deep field, foreground stars, companions. */
  sky: 8,
  /** Stars and artefacts: glare, spikes, trails, ghosts, cosmic rays. */
  stars: 9,
  /** Merger initial conditions (test stars). */
  mergerInit: 10,
  /**
   * The merger's debris: each test star's mark (a dot, a knot, a sparkle or a drawn star) and the
   * thinning of the debris (M8, mergerSprites, app23.js:L518–528, L1236–1238).
   */
  mergerSprites: 41,
  /** Lens sources and members. */
  lens: 11,
  /** Shells. */
  shells: 12,
  /** Dust lanes and their hatching. */
  dust: 13,
  /** Value-noise lattice (flocculence, patchiness). */
  noise: 14,
  /** Star-forming knots strung along a ring (generate, app23.js:L282–288). */
  ringKnots: 15,
  /**
   * Marks the parts place: the stellar streams' dots and knots (parts, app23.js:L1076–1080),
   * keyed by the placement key, so a re-key re-draws them as it re-draws the stipple.
   */
  partMarks: 16,
  /** The deep field's dots: one index per galaxy and dot (src/fallback/kernels/sky.ts). */
  skyDots: 17,
} as const;

export type StreamName = keyof typeof Stream;
