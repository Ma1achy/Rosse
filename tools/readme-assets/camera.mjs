// @ts-check
/**
 * A small camera-path module for the README films: keyframes for the engine's own camera (`az`,
 * `incl`, `pa`, `zoom`; the page's orbit semantics, src/ui/orbit.ts) and for the merger's moment
 * (`mTime`) or any other parameter, with easing, and closed paths so a GIF loops without a seam.
 *
 * The engine's camera has no pan: it looks at the galaxy's centre, so a "push in" is the zoom, and
 * a "glide" is a slow turn of `az` and `incl` (the sky turns with them, which is parallax enough).
 *
 * A channel is one of
 *  - a number (held),
 *  - `[[t, v], ...]` keyframes with `t` in [0, 1] (first at 0, last at 1 for an open path),
 *  - a function of t.
 * Between keys the curve is `ease` (stop and go, each key a rest), or `smooth` (the default: a
 * monotone cubic through the keys, no rest at a key, so the motion flows), or `linear`. A path is
 * `closed` when the last key's value repeats the first's and the tangent wraps (`smooth` only):
 * a loop. `spring` adds a damped overshoot to the eased channel (the camera settling).
 *
 * @typedef {number | Array<[number, number]> | ((t: number) => number)} Channel
 * @typedef {{az?: Channel, incl?: Channel, pa?: Channel, zoom?: Channel, mTime?: Channel,
 *   over?: Record<string, Channel>, ease?: 'smooth' | 'ease' | 'linear', closed?: boolean,
 *   spring?: number}} PathSpec
 */

/** Easings on [0, 1]. */
export const EASE = {
  linear: (/** @type {number} */ t) => t,
  inOutSine: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
  outCubic: (t) => 1 - (1 - t) ** 3,
  inCubic: (t) => t * t * t,
};

/**
 * The step response of a damped spring, 0 to 1 (`zeta` below 1 overshoots a little, then settles).
 * @param {number} t in [0, 1] @param {number} zeta damping ratio @param {number} [omega] natural frequency (rad per unit t)
 */
export function spring(t, zeta = 0.62, omega = 14) {
  if (t <= 0) return 0;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return (
    1 -
    Math.exp(-zeta * omega * t) *
      (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t))
  );
}

/** Monotone cubic (Fritsch-Carlson) tangents for keys, wrapping when closed. */
function tangents(/** @type {Array<[number, number]>} */ k, /** @type {boolean} */ closed) {
  const n = k.length;
  const d = [];
  for (let i = 0; i < n - 1; i++) {
    const [t0, v0] = /** @type {[number, number]} */ (k[i]);
    const [t1, v1] = /** @type {[number, number]} */ (k[i + 1]);
    d.push((v1 - v0) / (t1 - t0));
  }
  const m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const a = /** @type {number} */ (d[i - 1]);
    const b = /** @type {number} */ (d[i]);
    m[i] = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  }
  if (closed && n > 2) {
    // periodic: the tangent at the seam is the mean of the two slopes either side of it
    const a = /** @type {number} */ (d[n - 2]);
    const b = /** @type {number} */ (d[0]);
    m[0] = m[n - 1] = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  } else {
    m[0] = 0;
    m[n - 1] = 0;
  }
  return m;
}

/** A channel as a function of t in [0, 1]. */
export function channel(
  /** @type {Channel | undefined} */ c,
  /** @type {'smooth' | 'ease' | 'linear'} */ mode = 'smooth',
  /** @type {boolean} */ closed = false,
) {
  if (c === undefined) return undefined;
  if (typeof c === 'number') return () => c;
  if (typeof c === 'function') return c;
  const k = c;
  const m = mode === 'smooth' ? tangents(k, closed) : [];
  return (/** @type {number} */ t) => {
    const x = Math.min(1, Math.max(0, t));
    let i = 0;
    while (i < k.length - 2 && x > /** @type {[number, number]} */ (k[i + 1])[0]) i++;
    const [t0, v0] = /** @type {[number, number]} */ (k[i]);
    const [t1, v1] = /** @type {[number, number]} */ (k[i + 1]);
    const h = t1 - t0;
    const u = h > 0 ? (x - t0) / h : 1;
    if (mode === 'linear') return v0 + (v1 - v0) * u;
    if (mode === 'ease') return v0 + (v1 - v0) * EASE.inOutCubic(u);
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * v0 +
      (u3 - 2 * u2 + u) * h * /** @type {number} */ (m[i]) +
      (-2 * u3 + 3 * u2) * v1 +
      (u3 - u2) * h * /** @type {number} */ (m[i + 1])
    );
  };
}

/**
 * The view at t of a path: `{az, incl, pa, zoom, mTime, over}` with only the channels the path
 * has. The same t gives the same view, so a film is reproducible.
 */
export function viewAt(/** @type {PathSpec} */ p, /** @type {number} */ t) {
  const mode = p.ease ?? 'smooth';
  const out = /** @type {Record<string, any>} */ ({});
  for (const k of /** @type {const} */ (['az', 'incl', 'pa', 'zoom', 'mTime'])) {
    const f = channel(p[k], mode, p.closed);
    if (f) out[k] = f(p.spring ? Math.min(1, spring(t, p.spring)) : t);
  }
  if (p.over) {
    out.over = {};
    for (const [k, c] of Object.entries(p.over)) {
      const f = channel(c, mode, p.closed);
      if (f) out.over[k] = f(t);
    }
  }
  return out;
}

/** A full turn of azimuth, evenly, ending where it began (a closed path's loop). */
export const turn = (/** @type {number} */ from = 0, /** @type {number} */ deg = 360) =>
  /** @type {Array<[number, number]>} */ ([
    [0, from],
    [1 / 3, from + deg / 3],
    [2 / 3, from + (2 * deg) / 3],
    [1, from + deg],
  ]);

/** A there-and-back: keys at 0 and 1 equal, the peak in the middle. */
export const there = (
  /** @type {number} */ a,
  /** @type {number} */ peak,
  /** @type {number} */ at = 0.5,
) => /** @type {Array<[number, number]>} */ ([
  [0, a],
  [at, peak],
  [1, a],
]);

/** Zoom is a ratio: interpolate it in log space so a push-in feels even. */
export const logZoom = (/** @type {Channel} */ c) => {
  const f = channel(
    Array.isArray(c) ? c.map(([t, v]) => /** @type {[number, number]} */ ([t, Math.log(v)])) : c,
    'smooth',
    true,
  );
  return f ? (/** @type {number} */ t) => Math.exp(f(t)) : undefined;
};
