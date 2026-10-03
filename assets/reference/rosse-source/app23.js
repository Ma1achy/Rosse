(function () {
'use strict';
var AT = window.__ATLASES, REAL = window.__REAL, TOTAL_DRAWINGS = 469;
var THEME = 'light';
try { var th0 = localStorage.getItem('foundry-theme'); if (th0 === 'dark' || th0 === 'light') THEME = th0; } catch (e) {}
var INK = [0.114, 0.106, 0.098], DISC_INK = [0.25, 0.23, 0.2];
var MODEL_SIGN = 1;           // at winding +1 the model's arms measure S-wise (same measure as the drawings and photos)
var $ = function (id) { return document.getElementById(id); };

/* ---------- parameters ---------- */
var DEF = { seed: 7, stars: 9500, bulge: 0.2, bulgeSize: 0.5, bulgeFlat: 0.8, thick: 0.08,
  arms: 2, pitch: 18, armStrength: 0.8, armWidth: 0.35, flocc: 0.0,
  bar: 0.0, barLen: 0.45, ring: 0.0, ringR: 1.6, halo: 0.15, dust: 0.0, knots: 0.35, sparkle: 0.35,
  incl: 30, pa: 20, winding: 1, lines: 0.7, stroke: 'mixed', stipple: 1.0, outline: 0.0,
  armStyle: 'ribbons', barStyle: 'drawn', ringStyle: 'drawn', whole: 0, envelope: 0, nuclear: 0,
  companions: 0, lens: 0, shells: 0, tail: 0, fgstars: 0.3, trails: 0, arrow: 0, plates: 'ink', kind: 'auto',
  pen: 2.4, vary: 0.6, merger: 0, mRatio: 0.6, mPeri: 1.4, mStage: 1.2, mSpin1: 25, mSpin2: 40, mFriction: 0, mStars: 11000, mBulge: 0.2, mType1: 'spiral', mType2: 'spiral', mArms1: 2, mArms2: 2, mSize1: 1, mSize2: 1, mBar1: 0, mBar2: 0, mTilt: 0, mEcc: 1, mHorizon: 2, subject: 'galaxy', artefact: 'trail', starBright: 0.7, spikes: 0.7, starRings: 0.4, bleed: 0.3, ovStar: 0, ovStarD: 1.9, ovStarA: 40, ovArtefact: 'none', mTime: 1, az: 0, starMix: 0.6, dustScribble: 0.5, field: 0.3, dustLines: 0, bubbles: 0.4, streams: 0, distort: 0, rewind: 1, unwrap: 0, lensSource: 'galaxy', jet: 0, mWarp: 1, sersicN: 0, re: 0.9, patchy: 0, ringOnlyLines: 0, irr: 0,
  lensOn: 0, lensR: 1.3, lensSrc: 0.12, lensSrcA: 30, lensShear: 0.06, lensShearA: 20, lensSize: 0.28, lensStars: 6000, lensQ: 0.8, lensAngle: 0, lensCore: 0.05, lensCluster: 0, lensDouble: 0,
  shellsOn: 0, shellTime: 70, shellAxis: 30, shellStars: 6000 };
var PRESETS = {
  'Grand design': {},
  'Barred spiral': { bar: 0.85, barLen: 0.5, arms: 2, pitch: 16, ring: 0.25, ringR: 1.35, bulge: 0.18 },
  'Flocculent': { arms: 5, pitch: 26, armStrength: 0.6, armWidth: 0.55, flocc: 0.8, bulge: 0.08, knots: 0.5, stroke: 'broken' },
  'Hand-drawn arms': { armStyle: 'drawn', arms: 3, pitch: 14, lines: 0.9, knots: 0.3 },
  'Tightly wound': { arms: 3, pitch: 9, armWidth: 0.28, bulge: 0.3, stroke: 'plain' },
  'Loose, open arms': { arms: 2, pitch: 38, armWidth: 0.3, bulge: 0.06, knots: 0.55, stroke: 'beaded' },
  'Ringed': { arms: 0, ring: 0.9, ringR: 1.5, bar: 0.6, barLen: 0.55, bulge: 0.3, outline: 0.3 },
  'Disc, no arms': { arms: 0, bulge: 0.4, outline: 0.8, knots: 0.05, sparkle: 0.02, incl: 45, envelope: 0.7 },
  'Smooth, round': { arms: 0, bulge: 1, bulgeSize: 0.9, bulgeFlat: 0.95, halo: 0.25, knots: 0, sparkle: 0, lines: 0, incl: 10, envelope: 0.5 },
  'Cigar-shaped': { arms: 0, bulge: 1, bulgeSize: 0.9, bulgeFlat: 0.35, halo: 0.1, knots: 0, sparkle: 0, lines: 0, incl: 88 },
  'Edge-on with dust': { incl: 88, dust: 0.85, thick: 0.05, bulge: 0.3, arms: 2, lines: 0.5, stroke: 'plain' },
  'Merger: the Mice': { merger: 1, mRatio: 0.9, mPeri: 1.1, mStage: 0.9, mSpin1: 15, mSpin2: 30, incl: 35, pa: 120 },
  'Merger: long tails': { merger: 1, mRatio: 1, mPeri: 1.6, mStage: 2.6, mSpin1: 10, mSpin2: 160, incl: 55, pa: 40 },
  'Merger: minor, a stream': { merger: 1, mRatio: 0.15, mPeri: 1.2, mStage: 2.2, mSpin1: 30, mSpin2: 60, incl: 25, pa: 10 },
  'Merger: spiral meets elliptical': { merger: 1, mRatio: 0.7, mPeri: 1.0, mStage: 1.6, mSpin1: 20, mSpin2: 40, mType1: 'spiral', mArms1: 2, mType2: 'elliptical', mTilt: 20 },
  'Merger: dry (two ellipticals)': { merger: 1, mRatio: 0.8, mPeri: 0.9, mStage: 2.4, mType1: 'elliptical', mType2: 'elliptical', mFriction: 0.4, mTilt: 35 },
  'Merger: polar collision': { merger: 1, mRatio: 0.5, mPeri: 1.2, mStage: 1.4, mSpin1: 10, mSpin2: 85, mArms1: 3, mTilt: 80, mEcc: 1.1 },
  'Merger: three-armed pair': { merger: 1, mRatio: 0.9, mPeri: 1.3, mStage: 1.1, mSpin1: 25, mSpin2: 50, mArms1: 3, mArms2: 3, mBar1: 1 },
  'Layered: spiral beside a bright star': { arms: 2, pitch: 16, armStrength: 0.8, bar: 0, incl: 35, ovStar: 0.85, ovStarD: 1.7, ovStarA: 35, spikes: 0.8, starRings: 0.4, bleed: 0.5 },
  'Layered: barred spiral, satellite trail': { arms: 2, pitch: 20, bar: 0.8, barLen: 0.55, incl: 30, ovArtefact: 'trail' },
  'Layered: edge-on, star on top': { arms: 2, bulge: 0.25, incl: 86, dust: 0.7, ovStar: 0.7, ovStarD: 0.35, ovStarA: 120, spikes: 0.7 },
  'Layered: lensed merger': { merger: 1, mType1: 'spiral', mType2: 'elliptical', mStage: 1.5, lensOn: 1, lensR: 1.2, lensSrc: 0.05, lensSize: 0.14, lensQ: 0.8 },
  'Layered: ringed galaxy, ghost reflection': { arms: 2, ring: 0.7, ringR: 1.6, incl: 25, ovArtefact: 'ghost', spikes: 0.7 },
  'Star: bright, with spikes': { subject: 'star', starBright: 0.92, spikes: 0.9, starRings: 0.55, bleed: 0.65, field: 0.5, fgstars: 0.3 },
  'Star: faint': { subject: 'star', starBright: 0.35, spikes: 0.3, starRings: 0.1, bleed: 0, field: 0.6, fgstars: 0.35 },
  'Artefact: satellite trail': { subject: 'artefact', artefact: 'trail', starBright: 0.5, spikes: 0.5, field: 0.55 },
  'Artefact: ghost reflection': { subject: 'artefact', artefact: 'ghost', spikes: 0.7, starRings: 0.4, bleed: 0.4, field: 0.45 },
  'Artefact: cosmic rays': { subject: 'artefact', artefact: 'cosmic', field: 0.5 },
  'Merger: coalescing': { merger: 1, mRatio: 0.8, mPeri: 0.9, mStage: 4.5, mSpin1: 20, mSpin2: 120, mFriction: 0.8, incl: 40, pa: 70 },
  'Lens: Einstein ring': { arms: 0, bulge: 1, bulgeFlat: 0.85, incl: 88, sersicN: 4, re: 0.7, lines: 0, knots: 0, sparkle: 0, lensOn: 1, lensSrc: 0.0, lensShear: 0.02, lensR: 1.7, lensQ: 0.85, lensCore: 0.04, lensSize: 0.14, lensStars: 6000 },
  'Lens: Einstein cross (quasar)': { arms: 0, bulge: 1, bulgeFlat: 0.7, incl: 88, sersicN: 4, re: 0.6, lines: 0, knots: 0, sparkle: 0, lensOn: 1, lensSource: 'quasar', lensSrc: 0.05, lensSrcA: 40, lensShear: 0.03, lensR: 1.6, lensQ: 0.7, lensCore: 0.03, lensSize: 0.09},
  'Lens: galaxy cluster': { arms: 0, bulge: 1, bulgeFlat: 0.7, incl: 88, sersicN: 5, re: 0.95, lines: 0, knots: 0, sparkle: 0, lensOn: 1, lensCluster: 1, lensR: 1.15, lensShear: 0.02, lensStars: 10000, field: 0.85 },
  'Lens: double Einstein ring': { arms: 0, bulge: 1, bulgeFlat: 0.9, incl: 88, sersicN: 4, re: 0.65, lines: 0, knots: 0, sparkle: 0, lensOn: 1, lensDouble: 1, lensSrc: 0.01, lensQ: 0.9, lensR: 1.45, lensSize: 0.11, lensShear: 0.01, lensStars: 7000 },
  'Lens: giant arc': { arms: 0, bulge: 1, bulgeFlat: 0.75, incl: 88, sersicN: 4, re: 0.7, lines: 0, knots: 0, sparkle: 0, lensOn: 1, lensSrc: 0.2, lensSrcA: 60, lensShear: 0.05, lensR: 1.8, lensSize: 0.15},
  'Lens: a quad': { arms: 0, bulge: 1, bulgeFlat: 0.7, incl: 88, sersicN: 4, re: 0.6, lines: 0, knots: 0, sparkle: 0, lensOn: 1, lensSrc: 0.05, lensSrcA: 35, lensShear: 0.05, lensShearA: 10, lensR: 1.6, lensSize: 0.07, lensStars: 7000, lensQ: 0.65, lensCore: 0.02 },
  'Deep field': { field: 1, arms: 0, bulge: 1, bulgeFlat: 0.8, incl: 88, sersicN: 4, re: 0.7, lines: 0, knots: 0, sparkle: 0, fgstars: 0.4 },
 
  'A sketch, lensed': { arms: 0, bulge: 1, bulgeFlat: 0.8, incl: 88, sersicN: 4, re: 0.6, lines: 0, knots: 0, sparkle: 0, lensOn: 1, lensSource: 'drawing', lensSrc: 0.3, lensSrcA: 50, lensShear: 0.05, lensR: 1.45, lensSize: 0.4, lensStars: 4200, field: 0.5 },
  'Sketches, torn apart': { merger: 1, mWarp: 1, mRatio: 0.9, mPeri: 1.1, mStage: 1.3, mSpin1: 15, mSpin2: 30, incl: 30, pa: 100 },
  'Radio jet': { arms: 0, bulge: 1, bulgeFlat: 0.9, incl: 88, sersicN: 4, re: 0.7, lines: 0, knots: 0, sparkle: 0, jet: 1, field: 0.4 },
  'Stellar streams': { arms: 0, bulge: 1, bulgeFlat: 0.85, incl: 88, sersicN: 3.5, re: 0.6, stars: 7000, lines: 0, knots: 0, sparkle: 0, streams: 1, field: 0.3 },
  'Dusty spiral': { arms: 2, pitch: 20, dustLines: 1, bubbles: 0.8, knots: 0.6, incl: 35 },
  'Hand wobble': { arms: 3, pitch: 22, distort: 0.8, bubbles: 0.6 },
  'Shell galaxy': { arms: 0, bulge: 1, bulgeFlat: 0.85, incl: 88, sersicN: 3.5, re: 0.6, stars: 9000, lines: 0, knots: 0, sparkle: 0, shellsOn: 1, shellTime: 70, shellAxis: 25 },
  'Plates slipped': { plates: 'slip', arms: 2, pitch: 20 },
  'Stellar populations': { plates: 'colour', arms: 2, pitch: 22, knots: 0.6, sparkle: 0.7, bulge: 0.25 }
};
var P = Object.assign({}, DEF), REALSEL = null;

/* ---------- random ---------- */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function hash2(x, y) { var h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, y) { var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  var a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function gammaS(k, r) {              // Marsaglia and Tsang
  if (k < 1) return gammaS(k + 1, r) * Math.pow(r(), 1 / k);
  var d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { var x = gauss(r), v = Math.pow(1 + c * x, 3); if (v <= 0) continue; var u = r(); if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v; }
}
function dotSprite(t, k) {             // the dot fills sqrt(area)/40 of its tile; aim the dot itself at a readable diameter
  var ds = Math.max(4, AT.dots.size[t]), want = clamp(1.9 + 0.045 * ds, 1.9, 3.4) * PEN.dot * (k || 1);
  return want * 40 / ds;
}
function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

/* ---------- 2x2 matrices (column-major, as GLSL mat2) ---------- */
function Rm(t) { var c = Math.cos(t), s = Math.sin(t); return [c, s, -s, c]; }
function Sm(x, y) { return [x, 0, 0, y]; }
function mul(A, B) { return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3]]; }
function chain() { var M = [1, 0, 0, 1]; for (var i = 0; i < arguments.length; i++) M = mul(M, arguments[i]); return M; }

/* ---------- per-galaxy variation (seeded, scaled by P.vary) ---------- */
var VAR = null;
function makeVariation() {
  var r = mulberry32(P.seed * 7919 + 13), v = P.vary, arms = [];
  for (var k = 0; k < Math.max(1, P.arms); k++) arms.push({ pitch: 1 + 0.28 * v * gauss(r), amp: 1 - 0.55 * v * r(), phase: 0.35 * v * gauss(r), rmax: 2.1 + 0.6 * r(), wig: 0.3 * v * r(), wf: 1.5 + 3 * r(), wp: r() * 6.28 });
  var spurs = [], ns = Math.round(v * (2 + r() * 4) * Math.min(1, P.arms));
  for (var i = 0; i < ns; i++) spurs.push({ k: Math.floor(r() * Math.max(1, P.arms)), R0: 0.8 + 1.6 * r(), len: 0.5 + 0.9 * r(), pk: 1.7 + 0.8 * r() });
  var clumps = [], nc = Math.round(v * (4 + r() * 10) * (1 + 2 * P.patchy));
  for (var j = 0; j < nc; j++) clumps.push({ R: 0.7 + 2.2 * r(), t: r(), s: 0.05 + 0.08 * r(), n: 20 + Math.floor(60 * r()) });
  var dust = [], nd = Math.round(v * r() * 5);
  for (var d = 0; d < nd; d++) dust.push({ R: 0.8 + 2 * r(), th: r() * 6.28, s: 0.18 + 0.3 * r() });
  // a pen for this galaxy: dots from a few of your drawings only, so each galaxy has one hand
  // only pens whose dots are big enough to read: median dot size per source drawing
  var bySrc = {}; AT.dots.src.forEach(function (sx, i) { (bySrc[sx] = bySrc[sx] || []).push(AT.dots.size[i]); });
  var srcs = Object.keys(bySrc).filter(function (sx) { var a = bySrc[sx].slice().sort(function (p, q) { return p - q; }); return a[Math.floor(a.length / 2)] >= 7 && a.length >= 8; });
  if (!srcs.length) srcs = Object.keys(bySrc);
  var pickN = 1 + Math.floor(r() * 3), chosen = new Set();
  for (var c = 0; c < pickN; c++) chosen.add(srcs[Math.floor(r() * srcs.length)]);
  var dotPool = []; AT.dots.src.forEach(function (sx, i) { if (chosen.has(sx) || v < 0.15) dotPool.push(i); });
  if (dotPool.length < 12) dotPool = AT.dots.src.map(function (_, i) { return i; });
  var kpool = []; AT.knots.src.forEach(function (sx, i) { kpool.push(i); }); var kn = []; for (var q = 0; q < 24; q++) kn.push(kpool[Math.floor(r() * kpool.length)]);
  var spike = (r() - 0.5) * 0.5;
  return { spike: spike, arms: arms, spurs: spurs, clumps: clumps, dust: dust, lop: v * (0.22 + 0.7 * P.patchy) * (0.5 + 0.5 * r()), lopA: r() * 6.28, warp: v * 0.35 * r(), warpA: r() * 6.28, dotPool: dotPool, knotPool: kn,
           strokeSeed: Math.floor(r() * 1e6) };
}

/* ---------- the model ---------- */
var H = 1.0, RMAX = 4.2;
var VIEW = { W: 800, cx: 400, cy: 400, scale: 84 };
function ci() { return Math.cos(P.incl * Math.PI / 180); }
function paR() { return P.pa * Math.PI / 180; }
function azR() { return (P.az || 0) * Math.PI / 180; }
function discM() { return chain(Rm(paR()), Sm(1, ci()), Rm(azR()), Sm(P.winding, 1)); }        // mirror, orbit round the axis, tilt, turn       // galaxy plane -> screen (unit scale)
function armPhase(R, k) { var r0 = P.bar > 0.05 ? Math.max(0.2, P.barLen) : 0.25, a = VAR && k != null ? VAR.arms[k % VAR.arms.length] : null;
  var pitch = P.pitch * (a ? a.pitch : 1), ph = Math.log(Math.max(R, r0) / r0) / Math.tan(clamp(pitch, 4, 60) * Math.PI / 180);
  if (a) ph += a.phase + a.wig * Math.sin(R * a.wf + a.wp);
  return ph; }
function wrapPi(a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; }
function armProfile(R, th) {
  if (P.arms < 1) return 0;
  var per = 2 * Math.PI / P.arms, f = 0;
  for (var k = 0; k < P.arms; k++) { var a = VAR.arms[k % VAR.arms.length]; if (R > a.rmax + 0.4) continue;
    var d = wrapPi(th - armPhase(R, k) - per * k), x = d / (per / 2), g = Math.exp(-(x * x) / (P.armWidth * P.armWidth)) * a.amp;
    if (R > a.rmax) g *= Math.max(0, 1 - (R - a.rmax) / 0.4); if (g > f) f = g; }
  for (var i = 0; i < VAR.spurs.length; i++) { var sp = VAR.spurs[i]; if (R < sp.R0 || R > sp.R0 + sp.len) continue;
    var base = armPhase(sp.R0, sp.k) + per * sp.k, want = base + Math.log(R / sp.R0) / Math.tan(clamp(P.pitch * sp.pk, 10, 70) * Math.PI / 180);
    var ds = wrapPi(th - want) / (per / 2), gs = 0.8 * Math.exp(-(ds * ds) / (0.5 * P.armWidth * P.armWidth)) * (1 - (R - sp.R0) / sp.len); if (gs > f) f = gs; }
  if (P.flocc > 0) { var n = vnoise(R * 2.2 + 11, (th - armPhase(R, 0)) * 1.6 + P.seed); f *= (1 - P.flocc) + P.flocc * Math.max(0, (n - 0.35) * 2.2); }
  var inner = P.bar > 0.05 ? P.barLen : 0.3; if (R < inner) f *= R / inner;
  return f;
}
function dustTau(p, c, s) {
  if (P.dust <= 0) return 0;
  var zd = 0.06, nz = c, R = Math.hypot(p[0], p[1]); if (R > 3.2) return 0;
  var t1, t2;
  if (Math.abs(nz) < 1e-3) { if (Math.abs(p[2]) > zd) return 0; t1 = 0; t2 = 6; }
  else { t1 = (-zd - p[2]) / nz; t2 = (zd - p[2]) / nz; if (t1 > t2) { var q = t1; t1 = t2; t2 = q; } }
  t1 = Math.max(t1, 0); t2 = Math.min(t2, 6); return P.dust * 9 * Math.max(0, t2 - t1) * Math.exp(-R / 1.6);
}
function project(p) {
  var i = P.incl * Math.PI / 180, c = Math.cos(i), s = Math.sin(i), az = azR(), cz = Math.cos(az), sz = Math.sin(az);
  var x0 = p[0] * P.winding, y0 = p[1], x = x0 * cz - y0 * sz, ya = x0 * sz + y0 * cz;          // orbit round the galaxy's axis first
  var y = ya * c - p[2] * s, a = paR(), ca = Math.cos(a), sa = Math.sin(a);
  return [VIEW.cx + (x * ca - y * sa) * VIEW.scale, VIEW.cy + (x * sa + y * ca) * VIEW.scale];
}

/* ---------- sprite instances: [x, y, tile, alpha, m0, m1, m2, m3] ---------- */
var USED, PEN = { line: 2.4, dot: 1 };
function SM(x, y) {
  if (P.distort > 0) { var s0 = 0.011, d0 = P.distort * 26; var nx = vnoise(x * s0 + 3.1, y * s0 + 7.7) - 0.5, ny = vnoise(x * s0 + 11.3, y * s0 - 2.9) - 0.5; x += d0 * nx; y += d0 * ny; }
  if (!P.unwrap) return [x, y];
  var dx = x - VIEW.cx, dy = y - VIEW.cy, r = Math.hypot(dx, dy), th = Math.atan2(dy, dx), rmin = 6, rmax = 395;
  var u = Math.log(Math.max(r, rmin) / rmin) / Math.log(rmax / rmin);
  return [VIEW.W * (0.5 + 0.47 * th / Math.PI), VIEW.W * (0.95 - 0.88 * u)];
}
var SEAMMAX = 0;
function seam(a, b) { return (P.unwrap && Math.abs(a[0] - b[0]) > VIEW.W * 0.4) || (SEAMMAX > 0 && Math.hypot(a[0] - b[0], a[1] - b[1]) > SEAMMAX); }
function inst(list, atlas, x, y, tile, alpha, M) { if (!AT[atlas].vec) { var q = SM(x, y); x = q[0]; y = q[1]; } list.push([x, y, tile, alpha, M[0], M[1], M[2], M[3]]); USED.add(AT[atlas].src[tile]); }
var WARPS = [];
function simple(size, rot, sx, sy) { return chain(Rm(rot), Sm(size * (sx || 1), size * (sy || 1))); }

function generate() {
  var r = mulberry32(P.seed * 9973 + 1), N = Math.round(P.stars * P.stipple * (1 + 0.28 * (P.starMix || 0)));   // extra samples, so the dots stay as dense as before
  var i = P.incl * Math.PI / 180, c = Math.cos(i), s = Math.sin(i);
  var wb = P.bulge, wh = P.halo * 0.25, wbar = P.bar * 0.4 * (1 - P.bulge), wring = P.ring * 0.34 * (1 - P.bulge), wd = Math.max(0, 1 - wb - wh - wbar - wring);
  var tot = wb + wh + wbar + wring + wd, armsOn = P.arms >= 1 && P.bulge < 0.98;
  var out = { old: [], disc: [], young: [], knots: [], stars: [], rstars: [] };
  var SS = AT.sstars, small = [], bright = [];
  if (SS) SS.kind.forEach(function (k, i) { (k === 'outline' ? bright : small).push(i); });
  var ZL = Math.pow(VIEW.scale / 84, 0.45);      // stars grow a little as you zoom in, so the crosses stay legible
  function rstar(x, y, young, bright1) {       // a resolved star in your hand: small crosses mostly; the odd sparkle, spikes aligned
    if (!SS || !small.length) return;
    var br = bright1 || (young ? r() < 0.18 : r() < 0.05), pool = br && bright.length ? bright : small, t = pool[Math.floor(r() * pool.length)];
    var sz = (br ? 9 + 9 * Math.pow(r(), 2.4) : Math.exp(Math.log(4.6) + 0.38 * gauss(r))) * PEN.dot * ZL;   // mostly dot-sized, spread log-normally
    sz = clamp(sz, 3.2 * PEN.dot, 20 * PEN.dot * ZL);
    var kind = SS.kind[t], rot = VAR.spike + gauss(r) * (br ? 0.1 : kind === 'asterisk' ? 0.35 : 0.2);
    inst(out.rstars, 'sstars', x, y, t, 1, simple(sz, rot)); var row = out.rstars[out.rstars.length - 1]; row.push(br ? 0.58 : clamp(0.3 + 0.03 * sz, 0.36, 0.5));
    if (br) RSP.push([row[0], row[1], sz * 0.4]);                                        // breathing room only round the big ones
  }
  var RSP = [];
  var LN = dustLanes(), LG = {}, LC = 16, LR = (3.5 + 3 * P.dustScribble) * (VIEW.scale / 84);
  LN.pts.forEach(function (q) { var k = Math.floor(q[0] / LC) + ',' + Math.floor(q[1] / LC); (LG[k] = LG[k] || []).push(q); });
  function inLane(q) { var gx = Math.floor(q[0] / LC), gy = Math.floor(q[1] / LC);
    for (var ix = -1; ix <= 1; ix++) for (var iy = -1; iy <= 1; iy++) { var c = LG[(gx + ix) + ',' + (gy + iy)]; if (!c) continue;
      for (var k = 0; k < c.length; k++) if (Math.hypot(q[0] - c[k][0], q[1] - c[k][1]) < LR) return true; } return false; }
  var DL = [];
  if (P.dustLines > 0.02 && P.bulge < 0.95) {
    var rd = mulberry32(P.seed * 431 + 9), pl = AT.penlines, lanes = incE() > 72 ? 1 : Math.min(3, P.arms);
    for (var li = 0; li < lanes; li++) {
      var pi = Math.floor(rd() * pl.n), fl = longestLine(pl.vec[pi]); if (!fl) continue; USED.add(pl.src[pi]);
      var lp = lineParam(fl), seg = [];
      lp.forEach(function (pt) {
        var P3;
        if (incE() > 72) P3 = [-3 + 6 * pt[0], 0, pt[1] * 0.28];
        else { var Rr = 0.5 + 2.0 * pt[0], th = armPhase(Rr, li) + 2 * Math.PI * li / Math.max(1, P.arms) - 0.16 + pt[1] * 0.5 / Rr; P3 = [Rr * Math.cos(th), Rr * Math.sin(th), 0]; }
        seg.push(project(P3));
      });
      DL.push(seg);
    }
  }
  function nearDust(q) {
    var wd = 4 + 5 * P.dustLines;
    for (var a = 0; a < DL.length; a++) { var sg = DL[a];
      for (var b = 1; b < sg.length; b++) { var p0 = sg[b - 1], p1 = sg[b], vx = p1[0] - p0[0], vy = p1[1] - p0[1], l2 = vx * vx + vy * vy || 1, t = clamp(((q[0] - p0[0]) * vx + (q[1] - p0[1]) * vy) / l2, 0, 1);
        var ex = p0[0] + t * vx - q[0], ey = p0[1] + t * vy - q[1]; if (ex * ex + ey * ey < wd * wd) return true; } }
    return false;
  }
  for (var n = 0; n < N; n++) {
    var u = r() * tot, p, comp, arm = 0;
    if (u < wb && P.sersicN > 0 && P.bulge >= 0.95) {              // a smooth galaxy: a Sersic profile, projected directly
      var nS = P.sersicN, bS = 2 * nS - 1 / 3, rS = P.re * Math.pow(gammaS(2 * nS, r) / bS, nS);
      if (rS > RMAX + 0.8) continue;
      var thS = r() * 6.28, xS = rS * Math.cos(thS), yS = rS * Math.sin(thS) * P.bulgeFlat, aS = paR();
      if (P.dust > 0.25 && Math.abs(yS - 0.08 * xS) < 0.09 * P.dust && Math.abs(xS) < 2.2 * P.re + 0.4 && r() < 0.85) continue;
      if (P.dust > 0.3 && Math.abs(yS + 0.04) < 0.05 + 0.03 * P.dust && Math.abs(xS) < 1.8 * P.re + 0.6 && r() < 0.85 * P.dust) continue;
      var qS = [VIEW.cx + (xS * Math.cos(aS) - yS * Math.sin(aS)) * VIEW.scale, VIEW.cy + (xS * Math.sin(aS) + yS * Math.cos(aS)) * VIEW.scale];
      if (P.starMix > 0.01 && rS < 2.2 * P.re && r() < 0.09 * P.starMix) { rstar(qS[0], qS[1], false); continue; }
      var tS = VAR.dotPool[Math.floor(r() * VAR.dotPool.length)];
      inst(out.old, 'dots', qS[0], qS[1], tS, 1, simple(dotSprite(tS, 0.9), r() * 6.28));
      continue;
    }
    if (u < wb) { comp = 'bulge';
      var a = 0.22 * P.bulgeSize, sq = Math.sqrt(Math.min(r(), 0.985)), rr = a * sq / (1 - sq), cz = 2 * r() - 1, ph = 2 * Math.PI * r(), sz = Math.sqrt(1 - cz * cz);
      p = [rr * sz * Math.cos(ph), rr * sz * Math.sin(ph), rr * cz * P.bulgeFlat];
    } else if ((u -= wb) < wh) { comp = 'halo';
      var rh = -1.4 * Math.log(r()), cz2 = 2 * r() - 1, ph2 = 2 * Math.PI * r(), s2 = Math.sqrt(1 - cz2 * cz2);
      if (rh > RMAX + 0.5) continue; p = [rh * s2 * Math.cos(ph2), rh * s2 * Math.sin(ph2), rh * cz2 * 0.7];
    } else if ((u -= wh) < wbar) { comp = 'bar';
      var x = r() * 2 - 1; x = Math.sign(x) * Math.pow(Math.abs(x), 0.8) * P.barLen; p = [x, gauss(r) * 0.1 * P.barLen, gauss(r) * 0.04];
    } else if ((u -= wbar) < wring) { comp = 'ring';
      var th, R, rt = 0; do { th = 2 * Math.PI * r(); rt++; } while (rt < 6 && r() > 0.45 + 0.55 * vnoise(Math.cos(th) * 2.2 + P.seed, Math.sin(th) * 2.2));   /* a clumpy ring, not a perfect hoop */
      R = P.ringR * (1 + gauss(r) * 0.035); p = [R * Math.cos(th), R * Math.sin(th), gauss(r) * P.thick * 0.5];
    } else { comp = 'disc';
      var R2, th2, tries = 0;
      do { R2 = -H * Math.log(r() * r() + 1e-9); th2 = 2 * Math.PI * r(); tries++;
        if (R2 > RMAX) continue;
        if (P.patchy > 0 && r() > (1 - P.patchy) + P.patchy * Math.pow(vnoise(R2 * Math.cos(th2) * 1.4 + P.seed, R2 * Math.sin(th2) * 1.4 - P.seed), 2.2) * 2.2) continue;
        if (!armsOn) break;
        arm = armProfile(R2, th2); if (r() < (1 - P.armStrength) + P.armStrength * arm) break;
      } while (tries < 30);
      if (R2 > RMAX) continue;
      if (P.irr > 0) { var nz = vnoise(R2 * Math.cos(th2) * 1.3 + P.seed, R2 * Math.sin(th2) * 1.3 - P.seed); if (r() > 0.5 + 1.1 * Math.max(0, nz - 0.3)) continue; }
      var z = -P.thick * Math.log(r()) * (r() < 0.5 ? -1 : 1);
      if (VAR.warp > 0 && R2 > 1.8) z += VAR.warp * (R2 - 1.8) * (R2 - 1.8) * Math.sin(th2 - VAR.warpA);
      p = [R2 * Math.cos(th2) + VAR.lop * R2 * Math.cos(VAR.lopA) * 0.35, R2 * Math.sin(th2) + VAR.lop * R2 * Math.sin(VAR.lopA) * 0.35, z];
      var dustHit = false; for (var dp = 0; dp < VAR.dust.length; dp++) { var D0 = VAR.dust[dp]; if (Math.hypot(p[0] - D0.R * Math.cos(D0.th), p[1] - D0.R * Math.sin(D0.th)) < D0.s && r() < 0.8) { dustHit = true; break; } }
      if (dustHit) continue;
    }
    if (P.dust > 0 && comp !== 'halo' && r() > Math.exp(-dustTau(p, c, s))) continue;
    var q = project(p), roll = r(), base = comp === 'halo' ? 0.55 : comp === 'bulge' ? 0.8 : 1.0;
    if (DL.length && comp !== 'halo' && comp !== 'bulge' && r() < 0.9 * P.dustLines && nearDust(q)) continue;
    if (LN.pts.length && comp === 'disc' && r() < 0.7 && inLane(q)) continue;                      // thinned beneath a dust lane
    if (P.starMix > 0.01 && comp !== 'halo') {
      var Rg = Math.hypot(p[0], p[1]);
      if (Rg < 2.7 && r() < 0.34 * P.starMix * (comp === 'bulge' ? 0.4 : comp === 'ring' ? 1.6 : arm > 0.55 ? 1.35 : 0.85) * (Rg > 2.1 ? 0.55 : 1)) { rstar(q[0], q[1], comp === 'ring' || (comp === 'disc' && arm > 0.55)); continue; }
    }
    if (comp === 'disc' && arm > 0.55 && roll < P.knots * 0.12 * arm) inst(out.knots, 'knots', q[0], q[1], VAR.knotPool[Math.floor(r() * VAR.knotPool.length)], 1, simple((5 + 6 * r()) * PEN.dot, r() * 6.28));
    else if ((comp === 'disc' || comp === 'ring') && roll > 1 - P.sparkle * 0.012 * (0.4 + arm)) inst(out.stars, 'stars', q[0], q[1], Math.floor(r() * AT.stars.n), 1, simple(10 + 13 * r(), r() * 6.28));
    else { var t = VAR.dotPool[Math.floor(r() * VAR.dotPool.length)], sz2 = dotSprite(t, comp === 'bulge' ? 0.85 : 1);
      inst(comp === 'bulge' || comp === 'halo' ? out.old : (arm > 0.55 ? out.young : out.disc), 'dots', q[0], q[1], t, 1, simple(sz2, r() * 6.28)); }
  }
  if (RSP.length) {
    var G = {}, cell = 24; RSP.forEach(function (s0) { var k = Math.floor(s0[0] / cell) + ',' + Math.floor(s0[1] / cell); (G[k] = G[k] || []).push(s0); });
    function clear(list) { return list.filter(function (d) { var gx = Math.floor(d[0] / cell), gy = Math.floor(d[1] / cell);
      for (var ix = -1; ix <= 1; ix++) for (var iy = -1; iy <= 1; iy++) { var c = G[(gx + ix) + ',' + (gy + iy)]; if (!c) continue;
        for (var q = 0; q < c.length; q++) if (Math.hypot(d[0] - c[q][0], d[1] - c[q][1]) < c[q][2]) return false; } return true; }); }
    out.old = clear(out.old); out.disc = clear(out.disc); out.young = clear(out.young);
  }
  if (P.ring > 0.1 && !P.merger) {                                       /* star-forming knots strung along the ring */
    var rr0 = mulberry32(P.seed * 577 + 41), nkc = Math.round(6 + 10 * P.ring);
    for (var kc = 0; kc < nkc; kc++) { var tk = rr0() * 6.2832, Rk = P.ringR * (1 + gauss(rr0) * 0.02), ck = [Rk * Math.cos(tk), Rk * Math.sin(tk), 0];
      for (var jk = 0; jk < 5 + Math.floor(rr0() * 8); jk++) { var qk = project([ck[0] + gauss(rr0) * 0.045, ck[1] + gauss(rr0) * 0.045, 0]);
        if (rr0() < 0.5) inst(out.knots, 'knots', qk[0], qk[1], VAR.knotPool[Math.floor(rr0() * VAR.knotPool.length)], 1, simple((3 + 4 * rr0()) * PEN.dot, rr0() * 6.28));
        else { var tq = VAR.dotPool[Math.floor(rr0() * VAR.dotPool.length)]; inst(out.young, 'dots', qk[0], qk[1], tq, 1, simple(dotSprite(tq, 0.9 + 0.5 * rr0()), rr0() * 6.28)); } }
      var qc = project(ck); rstar(qc[0], qc[1], true, rr0() < 0.6); } }
  // star-forming clumps: tight knots of dots and beads along the arms
  if ((P.arms >= 1 || P.irr > 0) && P.bulge < 0.9) VAR.clumps.forEach(function (cl, ci3) {
    var k = ci3 % Math.max(1, P.arms), th0 = P.irr > 0 ? cl.t * 6.28 : armPhase(cl.R, k) + 2 * Math.PI * k / P.arms, cR = P.irr > 0 ? cl.R * 0.7 : cl.R, c0 = [cR * Math.cos(th0) + (P.irr > 0 ? 0.5 * Math.cos(VAR.lopA) : 0), cR * Math.sin(th0) + (P.irr > 0 ? 0.5 * Math.sin(VAR.lopA) : 0), 0];
    for (var j = 0; j < cl.n; j++) { var pp = [c0[0] + gauss(r) * cl.s, c0[1] + gauss(r) * cl.s, gauss(r) * 0.02], qq = project(pp);
      if (r() < 0.25) inst(out.knots, 'knots', qq[0], qq[1], VAR.knotPool[Math.floor(r() * VAR.knotPool.length)], 1, simple((3 + 4 * r()) * PEN.dot, r() * 6.28));
      else { var tc = VAR.dotPool[Math.floor(r() * VAR.dotPool.length)]; inst(out.young, 'dots', qq[0], qq[1], tc, 1, simple(dotSprite(tc, 0.8 + 0.5 * r()), r() * 6.28)); } }
    if (P.starMix > 0.01 && r() < 0.85) { var ns = 1 + Math.floor(r() * (1 + 3 * P.starMix));
      for (var j2 = 0; j2 < ns; j2++) { var ps2 = project([c0[0] + gauss(r) * cl.s * 1.3, c0[1] + gauss(r) * cl.s * 1.3, 0]); rstar(ps2[0], ps2[1], true, j2 === 0 && r() < 0.55); } }
  });
  return out;
}

/* ---------- mergers: two galaxies on a parabolic orbit, each with a disc of test stars ---------- */
var REC = null;                                   // when set, the renderer also records every line, dot and star as vector geometry
var MCACHE = { key: null, res: null };
function simulateMerger() {
  var key = [P.seed, P.mRatio, P.mPeri, P.mStage, P.mSpin1, P.mSpin2, P.mFriction, P.mStars, P.vary, P.mBulge, P.mType1, P.mType2, P.mArms1, P.mArms2, P.mSize1, P.mSize2, P.mBar1, P.mBar2, P.mTilt, P.mEcc, P.mHorizon].join('|');
  if (MCACHE.key === key) return MCACHE.res;
  var r = mulberry32(P.seed * 3301 + 7), q = P.mRatio, M = [1, q], Mt = 1 + q, rp = P.mPeri, A = [0.22, 0.22 * Math.sqrt(q)];
  var f0 = -2.2, rr0 = 2 * rp / (1 + Math.cos(f0)), h = Math.sqrt(Mt * 2 * rp);
  var ox = rr0 * Math.cos(f0), oy = rr0 * Math.sin(f0), vr = Mt / h * Math.sin(f0), vt = Mt / h * (1 + Math.cos(f0));
  var ovx = vr * Math.cos(f0) - vt * Math.sin(f0), ovy = vr * Math.sin(f0) + vt * Math.cos(f0);
  var Dh = Math.tan(f0 / 2), t0 = Math.sqrt(2 * rp * rp * rp / Mt) * (Dh + Dh * Dh * Dh / 3);
  var ek = P.mEcc || 1, C = [[-q / Mt * ox, -q / Mt * oy, 0, -q / Mt * ovx * ek, -q / Mt * ovy * ek, 0], [ox / Mt, oy / Mt, 0, ovx / Mt * ek, ovy / Mt * ek, 0]];
  var tl = (P.mTilt || 0) * Math.PI / 180, ctl = Math.cos(tl), stl = Math.sin(tl);                       // the orbit's plane, tilted
  C.forEach(function (c) { [0, 3].forEach(function (o) { var y = c[o + 1], z = c[o + 2]; c[o + 1] = y * ctl - z * stl; c[o + 2] = y * stl + z * ctl; }); });
  var TY = [P.mType1 || 'spiral', P.mType2 || 'spiral'], ARM = [P.mArms1 || 2, P.mArms2 || 2], SZ = [P.mSize1 || 1, P.mSize2 || 1], BAR = [P.mBar1 || 0, P.mBar2 || 0];
  var n0 = Math.round(P.mStars * (1 - 0.6 * P.mBulge) / (1 + Math.sqrt(q))), N = [n0, Math.max(800, Math.round(n0 * Math.sqrt(q)))], tot = N[0] + N[1];
  var X = new Float32Array(tot * 3), V = new Float32Array(tot * 3), G = new Uint8Array(tot), R0 = new Float32Array(tot), DX = new Float32Array(tot), DY = new Float32Array(tot);
  var idx = 0;
  [0, 1].forEach(function (g) {
    var s = (g === 0 ? P.mSpin1 : P.mSpin2) * Math.PI / 180, az = r() * 6.28;
    var n = [Math.sin(s) * Math.cos(az), Math.sin(s) * Math.sin(az), Math.cos(s)];
    var e1 = Math.abs(n[2]) < 0.9 ? [n[1], -n[0], 0] : [0, n[2], -n[1]], l1 = Math.hypot(e1[0], e1[1], e1[2]); e1 = e1.map(function (x) { return x / l1; });
    var e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
    var rd = 0.32 * Math.sqrt(M[g]) * SZ[g], rmax = 1.7 * Math.sqrt(M[g]) * SZ[g], arms = ARM[g], pitch = 0.3 + 0.4 * r(), ty = TY[g];
    for (var i = 0; i < N[g]; i++) {
      if (ty === 'elliptical') {                                         /* a hot ball of stars: random orbits, no disc — tides make fans and shells, not thin tails */
        var u0 = Math.sqrt(Math.min(r(), 0.97)), Re = Math.min(rmax * 0.8, 0.45 * rd * u0 / (1 - u0) + 0.02), dv = unit3(r), vcE = Math.sqrt(M[g] * Re * Re / Math.pow(Re * Re + A[g] * A[g], 1.5)), vv = [gauss(r), gauss(r), gauss(r)];
        for (var d0 = 0; d0 < 3; d0++) { X[idx * 3 + d0] = C[g][d0] + Re * dv[d0]; V[idx * 3 + d0] = C[g][d0 + 3] + vv[d0] * vcE * 0.55; }
        G[idx] = g; R0[idx] = Re / rmax; DX[idx] = Re * dv[0] / rmax; DY[idx] = Re * dv[1] / rmax; idx++; continue;
      }
      var R; do { R = -rd * Math.log(r() * r() + 1e-9); } while (R > rmax || R < 0.04);
      var th = r() * 6.28;
      if (ty === 'spiral' && r() < 0.5) { var k = Math.floor(r() * arms); th = Math.log(R / 0.1) / pitch + 2 * Math.PI * k / arms + gauss(r) * 0.25; }   // spiral structure to start with (lenticulars have none)
      if (BAR[g] && ty !== 'elliptical' && R < rd * 1.6 && r() < 0.35) { var bx = (r() * 2 - 1) * rd * 1.5; R = Math.max(0.04, Math.abs(bx)); th = (bx < 0 ? Math.PI : 0) + gauss(r) * 0.12; }   // a bar
      var vc = Math.sqrt(M[g] * R * R / Math.pow(R * R + A[g] * A[g], 1.5)), c = Math.cos(th), sn = Math.sin(th), zz = gauss(r) * (ty === 'lenticular' ? 0.04 : 0.02);
      for (var d = 0; d < 3; d++) { X[idx * 3 + d] = C[g][d] + R * (c * e1[d] + sn * e2[d]) + zz * n[d]; V[idx * 3 + d] = C[g][d + 3] + vc * (-sn * e1[d] + c * e2[d]); }
      G[idx] = g; R0[idx] = R / rmax; DX[idx] = R * c / rmax; DY[idx] = R * sn / rmax; idx++;
    }
  });
  var dt = 0.012, T = P.mStage - t0, steps = Math.min(1400, Math.ceil(T / dt)), fr = P.mFriction * 0.35;
  function accCores() {
    var dx = C[1][0] - C[0][0], dy = C[1][1] - C[0][1], dz = C[1][2] - C[0][2], d2 = dx * dx + dy * dy + dz * dz + 0.02, inv = 1 / (d2 * Math.sqrt(d2));
    var out = [[dx * inv * M[1], dy * inv * M[1], dz * inv * M[1]], [-dx * inv * M[0], -dy * inv * M[0], -dz * inv * M[0]]];
    if (fr > 0) { var dvx = C[1][3] - C[0][3], dvy = C[1][4] - C[0][4], dvz = C[1][5] - C[0][5], w = fr * Math.exp(-Math.sqrt(d2) / 1.5);
      out[0][0] += w * dvx * M[1] / Mt; out[0][1] += w * dvy * M[1] / Mt; out[0][2] += w * dvz * M[1] / Mt;
      out[1][0] -= w * dvx * M[0] / Mt; out[1][1] -= w * dvy * M[0] / Mt; out[1][2] -= w * dvz * M[0] / Mt; }
    return out;
  }
  function kick(h2) {
    var a = accCores();
    for (var g = 0; g < 2; g++) for (var d = 0; d < 3; d++) C[g][d + 3] += a[g][d] * h2;
    for (var i = 0; i < tot; i++) {
      var ax = 0, ay = 0, az2 = 0, o = i * 3;
      for (var g2 = 0; g2 < 2; g2++) { var dx = C[g2][0] - X[o], dy = C[g2][1] - X[o + 1], dz = C[g2][2] - X[o + 2], d2 = dx * dx + dy * dy + dz * dz + A[g2] * A[g2], inv = M[g2] / (d2 * Math.sqrt(d2)); ax += dx * inv; ay += dy * inv; az2 += dz * inv; }
      V[o] += ax * h2; V[o + 1] += ay * h2; V[o + 2] += az2 * h2;
    }
  }
  var FR = [], CF = [], every = Math.max(1, Math.floor(steps / 90));
  FR.push(X.slice()); CF.push(C.map(function (c) { return c.slice(); }));
  kick(dt / 2);
  for (var st = 0; st < steps; st++) {
    if (st > 0 && st % every === 0) { FR.push(X.slice()); CF.push(C.map(function (c) { return c.slice(); })); }
    for (var i = 0; i < tot * 3; i++) X[i] += V[i] * dt;
    for (var g = 0; g < 2; g++) for (var d = 0; d < 3; d++) C[g][d] += C[g][d + 3] * dt;
    kick(st === steps - 1 ? dt / 2 : dt);
  }
  FR.push(X.slice()); CF.push(C.map(function (c) { return c.slice(); }));
  var Xc = X.slice(), Cc = C.map(function (c) { return c.slice(); });                 /* the moment you chose */
  var HZ = Math.max(2, Math.min(30, P.mHorizon || 2)), FUT = 5.0 * (HZ - 1), steps2 = Math.ceil(FUT / dt), every2 = Math.max(1, Math.ceil(steps2 / Math.min(420, 90 * (HZ - 1)))), FR2 = [], CF2 = [];   /* ...and on, as far into its future as asked (snapshots spaced out on long runs) */
  kick(dt / 2);
  for (var s2 = 0; s2 < steps2; s2++) {
    if (s2 > 0 && s2 % every2 === 0) { FR2.push(X.slice()); CF2.push(C.map(function (c) { return c.slice(); })); }
    for (var i2 = 0; i2 < tot * 3; i2++) X[i2] += V[i2] * dt;
    for (var g3 = 0; g3 < 2; g3++) for (var d3 = 0; d3 < 3; d3++) C[g3][d3] += C[g3][d3 + 3] * dt;
    kick(s2 === steps2 - 1 ? dt / 2 : dt);
  }
  FR2.push(X.slice()); CF2.push(C.map(function (c) { return c.slice(); }));
  var res = { X: Xc, G: G, R0: R0, C: Cc, M: M, N: tot, A: A, DX: DX, DY: DY, frames: FR, cframes: CF, fut: FR2, cfut: CF2, horizon: HZ, TY: TY, SZ: SZ, RMAX: [1.7 * Math.sqrt(M[0]) * SZ[0], 1.7 * Math.sqrt(M[1]) * SZ[1]] };
  MCACHE = { key: key, res: res }; return res;
}
function mergerGalaxyParams(g, S0) {              /* a merging galaxy, described as a single galaxy would be */
  var rg = mulberry32(P.seed * 97 + g * 131), ty = (S0.TY || ['spiral', 'spiral'])[g], q = P.mRatio, share = g === 0 ? 1 / (1 + q) : q / (1 + q);
  var base = { merger: 0, mWarp: 0, seed: P.seed * 7 + g * 101 + 1, incl: 0, az: 0, pa: 0, winding: 1, field: 0, fgstars: 0, trails: 0, companions: 0, arrow: 0, jet: 0, lensOn: 0, shellsOn: 0, ring: 0, rewind: 0, unwrap: 0, distort: 0,
    stars: Math.round(P.mStars * 0.42 * share + 700), stipple: 1, halo: 0.05 };
  if (ty === 'elliptical') return Object.assign(base, { arms: 0, bulge: 1, sersicN: 3 + rg(), re: 0.75, bulgeFlat: 0.7 + 0.3 * rg(), lines: 0, knots: 0, sparkle: 0, dustScribble: 0, bubbles: 0, starMix: P.starMix * 0.5 });
  if (ty === 'lenticular') return Object.assign(base, { arms: 0, bulge: 0.55, bulgeSize: 1.1, lines: 0, knots: 0.1, dustScribble: 0.2, bar: (g === 0 ? P.mBar1 : P.mBar2) ? 0.7 : 0 });
  return Object.assign(base, { arms: g === 0 ? P.mArms1 : P.mArms2, pitch: Math.round(14 + 18 * rg()), bulge: clamp(0.08 + 0.5 * P.mBulge, 0.05, 0.45), bar: (g === 0 ? P.mBar1 : P.mBar2) ? 0.75 : 0, barLen: 0.8,
    lines: Math.min(P.lines, 0.45), flocc: 0, dustScribble: Math.min(P.dustScribble, 0.3) });   /* lighter line-work: tides keep a disc's stars, not its crisp arms */
}
function snapAt(frames, cframes, f) {            /* the state at a fractional snapshot index: every star blended between its two neighbours */
  var n = frames.length, x = clamp(f, 0, n - 1), i0 = Math.floor(x), i1 = Math.min(n - 1, i0 + 1), a = x - i0;
  if (a < 1e-4 || i0 === i1) return { X: frames[i0], C: cframes[i0] };
  var A0 = frames[i0], A1 = frames[i1], X = new Float32Array(A0.length), b1 = 1 - a;
  for (var k = 0; k < X.length; k++) X[k] = A0[k] * b1 + A1[k] * a;
  var C = cframes[i0].map(function (c, g) { return c.map(function (v, d) { return v * b1 + cframes[i1][g][d] * a; }); });
  return { X: X, C: C };
}
/* ---------- a star, or an artefact, drawn as fully as a galaxy: your star drawings, stipple glare, spikes, rings, bleed; trails, ghosts, cosmic rays ---------- */
function starSprites() {
  var r = mulberry32(P.seed * 911 + 17), out = { old: [], disc: [], young: [], knots: [], stars: [], rstars: [] }, cx = VIEW.cx, cy = VIEW.cy, U = VIEW.scale;   /* U: pixels per galaxy unit */
  var SS = AT.sstars, bright = [], small = []; if (SS) SS.kind.forEach(function (k, i) { (k === 'outline' || k === 'burst' ? bright : small).push(i); });
  function dot(list, x, y, k) { var t = VAR.dotPool[Math.floor(r() * VAR.dotPool.length)]; inst(list, 'dots', x, y, t, 1, simple(dotSprite(t, k || 1), r() * 6.28)); }
  function knot(x, y, sz) { inst(out.knots, 'knots', x, y, VAR.knotPool[Math.floor(r() * VAR.knotPool.length)], 1, simple(sz * PEN.dot, r() * 6.28)); }
  function drawn(x, y, sz, pool, rot, ps) { if (!SS || !pool.length) return; inst(out.rstars, 'sstars', x, y, pool[Math.floor(r() * pool.length)], 1, simple(sz, rot)); out.rstars[out.rstars.length - 1].push(ps); }
  function aStar(x, y, B, full) {                     /* one star: B its brightness, 0-1 */
    var core = (0.1 + 0.2 * B) * U, spikeA = r() * 0.4 - 0.2 + (VAR.spike || 0);
    for (var k = 0; k < Math.round(20 + 90 * B); k++) { var a = r() * 6.2832, d = Math.pow(r(), 1.6) * core * 0.6; knot(x + Math.cos(a) * d, y + Math.sin(a) * d, 3 + 4 * r()); }      /* the saturated heart */
    var nh = Math.round((1500 + 7500 * B) * (full ? 1 : 0.22));                                                                                                            /* the glare: a power-law fall-off */
    for (var h = 0; h < nh; h++) { var a2 = r() * 6.2832, d2 = core * Math.pow(1 - r() * 0.99, -0.62); if (d2 > U * (1.3 + 2.3 * B)) continue; dot(d2 < core * 2.2 ? out.old : out.disc, x + Math.cos(a2) * d2, y + Math.sin(a2) * d2, d2 < core * 2 ? 1.1 : 0.85); }
    if (full && P.spikes > 0.02) { var ns = 4, L = U * (0.9 + 3.4 * P.spikes * B);                                                                                          /* diffraction spikes */
      for (var q = 0; q < ns; q++) { var sa = spikeA + q * Math.PI / 2 + (q % 2 ? 0 : 0.004);
        for (var j = 0; j < Math.round(L / 0.8); j++) { var dd = core * 0.6 + Math.pow(r(), 1.7) * L, w = (1.2 + 3 * (1 - dd / L)) * (r() - 0.5); dot(out.disc, x + Math.cos(sa) * dd - Math.sin(sa) * w, y + Math.sin(sa) * dd + Math.cos(sa) * w, 0.8 + 0.4 * (1 - dd / L)); } } }
    if (full && P.starRings > 0.02) { var nr = 1 + Math.round(2 * P.starRings);                                                                                            /* faint rings in the glare */
      for (var ri = 1; ri <= nr; ri++) { var rr0 = core * (2.6 + 2.2 * ri) * (0.8 + 0.5 * B); for (var j2 = 0; j2 < Math.round(260 * P.starRings * ri); j2++) { var a3 = r() * 6.2832; if (vnoise(Math.cos(a3) * 2 + ri, Math.sin(a3) * 2 + P.seed) < 0.35) continue; var d3 = rr0 * (1 + (r() - 0.5) * 0.05); dot(out.young, x + Math.cos(a3) * d3, y + Math.sin(a3) * d3, 0.8); } } }
    if (full && P.bleed > 0.02 && B > 0.45) { var bl = U * 2.6 * P.bleed * B;                                                                                                /* the saturation bleed column */
      for (var bj = 0; bj < Math.round(bl * 1.4); bj++) { var by = (r() * 2 - 1) * bl, bx = (r() - 0.5) * (2 + 3 * (1 - Math.abs(by) / bl)); dot(out.old, x + bx, y + by, 0.9); } }
    drawn(x, y, core * (2.6 + 2.4 * B), bright.length ? bright : small, spikeA, 0.7 + 0.4 * B);                                                                      /* one of your star drawings, at the core */
  }
  if (P.subject === 'star') { aStar(cx, cy, P.starBright, true);
    for (var f = 0; f < (P._ov ? 0 : 3 + Math.floor(r() * 5)); f++) { var fa = r() * 6.2832, fd = U * (1.6 + 2.2 * r()); aStar(cx + Math.cos(fa) * fd, cy + Math.sin(fa) * fd, 0.06 + 0.2 * r(), false); } }   /* fainter stars nearby */
  else {
    var ty = P.artefact || 'trail';
    if (ty === 'trail') { var ta = r() * Math.PI, off = (r() - 0.5) * U * 0.8, tx = cx - Math.sin(ta) * off, tyy = cy + Math.cos(ta) * off, half = U * 3.2, dbl = r() < 0.4;   /* a satellite streaks across */
      if (P._ov && OVT) { tx = OVT.mx; tyy = OVT.my; ta = OVT.a; half = OVT.half; }   /* as an overlay: its line through the scene, as seen now */
      [0, dbl ? 7 + 5 * r() : null].forEach(function (sep, li) { if (sep === null) return;
        for (var j = 0; j < Math.round(half * 2.2 * (li ? 0.55 : 1)); j++) { var tt = (r() * 2 - 1) * half, flick = 0.6 + 0.4 * vnoise(tt * 0.04 + li * 9, P.seed), w = (r() - 0.5) * (2.2 + 1.5 * flick);
          if (r() > flick) continue; dot(li ? out.disc : out.old, tx + Math.cos(ta) * tt - Math.sin(ta) * (w + sep), tyy + Math.sin(ta) * tt + Math.cos(ta) * (w + sep), 0.9 + 0.3 * flick); } });
      if (!P._ov) aStar(cx + (r() - 0.5) * U * 1.6, cy + (r() - 0.5) * U * 1.6, 0.25 + 0.25 * r(), true); }
    else if (ty === 'ghost') { var sa2 = r() * 6.2832, sx = cx + Math.cos(sa2) * U * 1.1, sy = cy + Math.sin(sa2) * U * 1.1; if (P._ov && OVG) { sx = OVG[0]; sy = OVG[1]; } aStar(sx, sy, 0.85, true);   /* the star, and its reflection inside the telescope */
      var gx = cx - (sx - cx) * 0.32, gy = cy - (sy - cy) * 0.32,   /* the reflection sits opposite its star, through the middle of the image */ R1 = U * (0.55 + 0.25 * r()), R0 = R1 * (0.45 + 0.15 * r());
      for (var g = 0; g < 2600; g++) { var ga = r() * 6.2832, gd = R0 + (R1 - R0) * Math.sqrt(r()); if (r() > 0.55 + 0.45 * vnoise(Math.cos(ga) * 1.5 + 3, Math.sin(ga) * 1.5 + P.seed)) continue; dot(g % 3 ? out.disc : out.young, gx + Math.cos(ga) * gd, gy + Math.sin(ga) * gd, 0.75); }
      for (var g2 = 0; g2 < 500; g2++) { var ga2 = r() * 6.2832, gd2 = R1 * (1 + (r() - 0.5) * 0.04); dot(out.old, gx + Math.cos(ga2) * gd2, gy + Math.sin(ga2) * gd2, 0.9); } }
    else { for (var c = 0; c < 70 + Math.floor(r() * 60); c++) { var hx = cx + (r() - 0.5) * U * 5.2, hy = cy + (r() - 0.5) * U * 5.2, ha = r() * 6.2832, hl = 3 + Math.pow(r(), 2) * 30;   /* cosmic rays: sharp little hits */
        for (var hj = 0; hj < Math.max(2, Math.round(hl / 1.5)); hj++) { var hd = (hj / Math.max(1, hl / 1.5) - 0.5) * hl; dot(out.old, hx + Math.cos(ha) * hd, hy + Math.sin(ha) * hd, 1.05); }
        if (r() < 0.15) knot(hx, hy, 3 + 2 * r()); }
      if (!P._ov) aStar(cx + (r() - 0.5) * U, cy + (r() - 0.5) * U, 0.3, true); }
  }
  return out;
}
function rotFwd(p, o) { var i = o.incl * Math.PI / 180, c = Math.cos(i), s = Math.sin(i), az = o.az * Math.PI / 180, cz = Math.cos(az), sz = Math.sin(az), x0 = p[0] * o.w, y0 = p[1], x = x0 * cz - y0 * sz, ya = x0 * sz + y0 * cz; return [x, ya * c - p[2] * s, ya * s + p[2] * c]; }
function rotInv(v, o) { var i = o.incl * Math.PI / 180, c = Math.cos(i), s = Math.sin(i), az = o.az * Math.PI / 180, cz = Math.cos(az), sz = Math.sin(az), ya = v[1] * c + v[2] * s, pz = -v[1] * s + v[2] * c, x0 = v[0] * cz + ya * sz, y0 = -v[0] * sz + ya * cz; return [x0 / o.w, y0, pz]; }
function orientNow() { return { incl: P.incl, az: P.az || 0, w: P.winding, pa: P.pa }; }
/* where things were placed is remembered with the view they were placed in; after that they are fixed in the scene, and the camera moves round them */
var OVHOME = { key: null, o: null }, LHOME = { key: null, o: null }, OVT = null, OVG = null;
function homeFor(H, key) { if (H.key !== key) { H.key = key; H.o = orientNow(); } return H.o; }
function scenePoint(H, key, sx, sy, depth) {        /* a point placed at screen offset (sx, sy) and this depth, as the current camera sees it */
  var o = homeFor(H, key), pa0 = o.pa * Math.PI / 180, lx = sx * Math.cos(pa0) + sy * Math.sin(pa0), ly = -sx * Math.sin(pa0) + sy * Math.cos(pa0), v = rotFwd(rotInv([lx, ly, depth], o), orientNow()), pa = paR();
  return [VIEW.cx + (v[0] * Math.cos(pa) - v[1] * Math.sin(pa)) * VIEW.scale, VIEW.cy + (v[0] * Math.sin(pa) + v[1] * Math.cos(pa)) * VIEW.scale];
}
function srcNow(bx, by, D) {                         /* a lensed source fixed in 3D, a distance D behind the lens: its offset as seen from here (lens-frame units) */
  var o = homeFor(LHOME, [P.seed, P.lensSrc, P.lensSrcA, P.lensR, P.lensQ, P.lensCluster, P.lensDouble, P.lensSource, P.lensSize, P.merger].join('|')), v = rotFwd(rotInv([bx, by, -D], o), orientNow()); return [v[0], v[1]];
}
function overlaySprites(S) {                     /* a bright foreground star and an artefact, laid over whatever the subject is */
  var wantStar = P.ovStar > 0.02, wantArt = P.ovArtefact && P.ovArtefact !== 'none'; if (!wantStar && !wantArt) return;
  var keep = { subject: P.subject, artefact: P.artefact, starBright: P.starBright, seed: P.seed, ov: P._ov, cx: VIEW.cx, cy: VIEW.cy };
  function merge(o) { ['old', 'disc', 'young', 'knots', 'stars', 'rstars'].forEach(function (k) { if (o[k] && o[k].length) S[k] = (S[k] || []).concat(o[k]); }); }
  try { P._ov = 1;
    var ovKey = [keep.seed, P.ovStar > 0.02, P.ovStarD, P.ovStarA, P.ovArtefact].join('|');
    if (wantStar) { var a = P.ovStarA * Math.PI / 180, sp = scenePoint(OVHOME, ovKey, P.ovStarD * Math.cos(a), P.ovStarD * Math.sin(a), 1.4); VIEW.cx = sp[0]; VIEW.cy = sp[1]; P.subject = 'star'; P.starBright = P.ovStar; P.seed = keep.seed * 7 + 3; merge(starSprites()); VIEW.cx = keep.cx; VIEW.cy = keep.cy; }   /* a foreground star, a little in front of the galaxy */
    if (wantArt) { var rt = mulberry32(keep.seed * 977 + 3), ta0 = rt() * Math.PI, off0 = (rt() - 0.5) * 0.8, mx0 = -Math.sin(ta0) * off0, my0 = Math.cos(ta0) * off0, e1 = scenePoint(OVHOME, ovKey, mx0 - Math.cos(ta0) * 3.2, my0 - Math.sin(ta0) * 3.2, 1.1), e2 = scenePoint(OVHOME, ovKey, mx0 + Math.cos(ta0) * 3.2, my0 + Math.sin(ta0) * 3.2, 1.1);
      OVT = null;   /* the trail stays on the image: a satellite near Earth doesn't turn with the galaxy */
      var ga0 = rt() * 6.2832; OVG = scenePoint(OVHOME, ovKey, Math.cos(ga0) * 1.1, Math.sin(ga0) * 1.1, 1.4);   /* the ghost's star, in the scene; its reflection follows it */
      P.subject = 'artefact'; P.artefact = P.ovArtefact; P.starBright = 0.8; P.seed = keep.seed * 11 + 5; merge(starSprites()); OVT = null; OVG = null; }
  } finally { P.subject = keep.subject; P.artefact = keep.artefact; P.starBright = keep.starBright; P.seed = keep.seed; P._ov = keep.ov; VIEW.cx = keep.cx; VIEW.cy = keep.cy; }
}
function frameOf(S) {
  if (S.frame) return S.frame;
  var C0 = S.C[0], C1 = S.C[1], c3 = [(C0[0] + C1[0]) / 2, (C0[1] + C1[1]) / 2, (C0[2] + C1[2]) / 2];
  var rWhole = Math.max(Math.hypot(C0[0] - c3[0], C0[1] - c3[1], C0[2] - c3[2]) + 1.25 * Math.sqrt(S.M[0]), Math.hypot(C1[0] - c3[0], C1[1] - c3[1], C1[2] - c3[2]) + 1.25 * Math.sqrt(S.M[1]));
  var rr = []; for (var k1 = 0; k1 < S.N; k1 += 5) rr.push(Math.hypot(S.X[k1 * 3] - c3[0], S.X[k1 * 3 + 1] - c3[1], S.X[k1 * 3 + 2] - c3[2]));
  rr.sort(function (p, q) { return p - q; });
  return (S.frame = { c: c3, r: Math.max(rWhole, 0.8 * rr[Math.floor(rr.length * 0.9)]) });
}
function unionFrame(S) {                          // a frame that holds both galaxies at every moment of the encounter
  if (S.uframe) return S.uframe;
  var mids = S.cframes.map(function (C) { return [(C[0][0] + C[1][0]) / 2, (C[0][1] + C[1][1]) / 2, (C[0][2] + C[1][2]) / 2]; });
  var c = [0, 1, 2].map(function (d) { return mids.reduce(function (a, m) { return a + m[d]; }, 0) / mids.length; }), r = 0;
  S.cframes.forEach(function (C) { for (var g = 0; g < 2; g++) r = Math.max(r, Math.hypot(C[g][0] - c[0], C[g][1] - c[1], C[g][2] - c[2]) + 1.25 * Math.sqrt(S.M[g])); });
  return (S.uframe = { c: c, r: r });
}
function mergerSprites() {
  var S0 = simulateMerger(), S = S0;
  if (P.mTime != null && P.mTime < 0.999 && S0.frames) {
    var snp = snapAt(S0.frames, S0.cframes, clamp(P.mTime, 0, 1) * (S0.frames.length - 1));
    var fu = unionFrame(S0), ff = frameOf(S0), tt = clamp(P.mTime, 0, 1), w = tt * tt * (3 - 2 * tt);      // ease in from the whole encounter to the final framing
    S = Object.assign(Object.create(null), S0, { X: snp.X, C: snp.C, frame: { c: [0, 1, 2].map(function (d) { return fu.c[d] + (ff.c[d] - fu.c[d]) * w; }), r: fu.r + (ff.r - fu.r) * w } });
  } else if (P.mTime != null && P.mTime > 1.001 && S0.fut && S0.fut.length) {             /* past the moment you chose: the rest of its story */
    var HZ2 = S0.horizon || 2, fl = S0.fut.length, snf = snapAt(S0.fut, S0.cfut, clamp((P.mTime - 1) / (HZ2 - 1), 0, 1) * (fl - 1)), ffc = frameOf(S0);
    if (!S0.fframe) S0.fframe = frameOf({ C: S0.cfut[fl - 1], X: S0.fut[fl - 1], M: S0.M, N: S0.N });
    var fe = S0.fframe, t2 = clamp((P.mTime - 1) / (HZ2 - 1), 0, 1), w2 = t2 * t2 * (3 - 2 * t2);
    S = Object.assign(Object.create(null), S0, { X: snf.X, C: snf.C, frame: { c: [0, 1, 2].map(function (d) { return ffc.c[d] + (fe.c[d] - ffc.c[d]) * w2; }), r: ffc.r + (fe.r - ffc.r) * w2 } });
  }
  var  r = mulberry32(P.seed * 17 + 3), out = { old: [], disc: [], young: [], knots: [], stars: [], rstars: [] }, cores = [];
  var SSm = AT.sstars, smallM = [], brightM = [];if (SSm) SSm.kind.forEach(function (kk, ii) { (kk === 'outline' ? brightM : smallM).push(ii); });
  function mstar(x, y, bright) { if (!SSm || !smallM.length) return; var pool = bright && brightM.length ? brightM : smallM, t = pool[Math.floor(r() * pool.length)], sz = (bright ? 9 + 9 * Math.pow(r(), 2.4) : Math.exp(Math.log(4.6) + 0.38 * gauss(r))) * PEN.dot;
    inst(out.rstars, 'sstars', x, y, t, 1, simple(sz, VAR.spike + gauss(r) * 0.2)); out.rstars[out.rstars.length - 1].push(bright ? 0.58 : 0.42); }
  var BUL = (S.TY || ['spiral', 'spiral']).map(function (t) { return t === 'elliptical' ? 1.2 : t === 'lenticular' ? Math.max(0.7, P.mBulge) : P.mBulge; });
  var i = P.incl * Math.PI / 180, ci0 = Math.cos(i), si0 = Math.sin(i), a = paR(), ca = Math.cos(a), sa = Math.sin(a);
  var az0 = azR(), cz0 = Math.cos(az0), sz0 = Math.sin(az0);
  function view(x, y, z) { var xr = x * cz0 - y * sz0, yr = x * sz0 + y * cz0, yy = yr * ci0 - z * si0; return [xr * ca - yy * sa, xr * sa + yy * ca]; }
  var pts = new Float32Array(S.N * 2), xs = [], ys = [];
  for (var k = 0; k < S.N; k++) { var v = view(S.X[k * 3], S.X[k * 3 + 1], S.X[k * 3 + 2]); pts[k * 2] = v[0]; pts[k * 2 + 1] = v[1]; if (k % 7 === 0) { xs.push(v[0]); ys.push(v[1]); } }
  // frame the merger from its 3D extent, not its on-screen spread: steady as you orbit, and the zoom applies like everywhere else
  if (!S.frame) {
    // centre between the two nuclei (equally weighted, so a small companion counts as much as its host),
    // and size the frame to hold both galaxies whole, or most of the debris, whichever is larger
    var C0 = S.C[0], C1 = S.C[1], c3 = [(C0[0] + C1[0]) / 2, (C0[1] + C1[1]) / 2, (C0[2] + C1[2]) / 2];
    var rWhole = Math.max(Math.hypot(C0[0] - c3[0], C0[1] - c3[1], C0[2] - c3[2]) + 1.25 * Math.sqrt(S.M[0]), Math.hypot(C1[0] - c3[0], C1[1] - c3[1], C1[2] - c3[2]) + 1.25 * Math.sqrt(S.M[1]));
    var rr = [];
    for (var k1 = 0; k1 < S.N; k1 += 5) rr.push(Math.hypot(S.X[k1 * 3] - c3[0], S.X[k1 * 3 + 1] - c3[1], S.X[k1 * 3 + 2] - c3[2]));
    rr.sort(function (p, q) { return p - q; });
    S.frame = { c: c3, r: Math.max(rWhole, 0.8 * rr[Math.floor(rr.length * 0.9)]) };
  }
  var cv0 = view(S.frame.c[0], S.frame.c[1], S.frame.c[2]), cx = cv0[0], cy = cv0[1];
  var sc = (P.mFit || 0.74) * VIEW.W / Math.max(2 * S.frame.r, 1e-3) * (VIEW.scale / 84);
  function px(x, y) { return [VIEW.cx + (x - cx) * sc, VIEW.cy + (y - cy) * sc]; }
  var SCR = new Float32Array(S.N * 2);
  for (var k2 = 0; k2 < S.N; k2++) {
    var p = px(pts[k2 * 2], pts[k2 * 2 + 1]), outer = S.R0[k2] > 0.45, roll = r(); SCR[k2 * 2] = p[0]; SCR[k2 * 2 + 1] = p[1];
    var gk = S.G[k2], hot = S.TY && S.TY[gk] === 'elliptical', cg = S.C[gk], dcore = Math.hypot(S.X[k2 * 3] - cg[0], S.X[k2 * 3 + 1] - cg[1], S.X[k2 * 3 + 2] - cg[2]), inTail = !hot && S.RMAX && dcore > 1.15 * S.RMAX[gk];
    if (!hot && P.starMix > 0.01 && r() < 0.05 * P.starMix * (inTail ? 1.6 : 1)) { mstar(p[0], p[1], inTail && r() < 0.25); continue; }   /* your star drawings, brightest out in the tails */
    if (inTail && roll < 0.012 * (0.4 + P.knots)) {                         /* a knot of new stars in the tidal tail — where tidal dwarf galaxies form */
      for (var kj = 0; kj < 5 + Math.floor(r() * 7); kj++) inst(out.knots, 'knots', p[0] + gauss(r) * 5 * PEN.dot, p[1] + gauss(r) * 5 * PEN.dot, VAR.knotPool[Math.floor(r() * VAR.knotPool.length)], 1, simple((3 + 4 * r()) * PEN.dot, r() * 6.28));
      mstar(p[0], p[1], true); continue; }
    if (!hot && outer && roll < 0.035 * (0.4 + P.knots)) inst(out.knots, 'knots', p[0], p[1], VAR.knotPool[Math.floor(r() * VAR.knotPool.length)], 1, simple((4 + 5 * r()) * PEN.dot, r() * 6.28));
    else if (roll > 1 - 0.004 * (0.3 + P.sparkle)) inst(out.stars, 'stars', p[0], p[1], Math.floor(r() * AT.stars.n), 1, simple(10 + 10 * r(), r() * 6.28));
    else { var t = VAR.dotPool[Math.floor(r() * VAR.dotPool.length)]; inst(outer ? out.young : out.disc, 'dots', p[0], p[1], t, 1, simple(dotSprite(t), r() * 6.28)); }
  }
  // bulges ride with their cores; each core gets one of your bulge drawings
  S.C.forEach(function (c, g) {
    var cp = view(c[0], c[1], c[2]), cc = px(cp[0], cp[1]), nb = Math.round(1500 * S.M[g] * (1 + 3.5 * BUL[g])), rb = (0.05 + 0.09 * BUL[g]) * Math.sqrt(S.M[g]) * (S.SZ ? S.SZ[g] : 1);
    for (var b = 0; b < nb; b++) { var u = Math.sqrt(Math.min(r(), 0.98)), rr = rb * u / (1 - u), cz = 2 * r() - 1, ph = r() * 6.28, sz = Math.sqrt(1 - cz * cz), bp = view(c[0] + rr * sz * Math.cos(ph), c[1] + rr * sz * Math.sin(ph), c[2] + rr * cz), bb = px(bp[0], bp[1]);
      var t2 = VAR.dotPool[Math.floor(r() * VAR.dotPool.length)]; inst(out.old, 'dots', bb[0], bb[1], t2, 1, simple(dotSprite(t2, 0.9), r() * 6.28)); }
    cores.push([cc[0], cc[1], sc * 0.34 * Math.sqrt(S.M[g])]);
  });
  var GRID = [{}, {}], GN = 20;
  for (var k3 = 0; k3 < S.N; k3++) { var key = Math.floor((S.DX[k3] + 1) / 2 * GN) + ',' + Math.floor((S.DY[k3] + 1) / 2 * GN); (GRID[S.G[k3]][key] = GRID[S.G[k3]][key] || []).push(k3); }
  function tidal(g, flip) {
    return function (x, y) {
      if (flip) x = -x;
      var nx = clamp(x * 2, -1, 1), ny = clamp(y * 2, -1, 1), gx = Math.floor((nx + 1) / 2 * GN), gy = Math.floor((ny + 1) / 2 * GN), best = [];
      for (var ring = 0; ring < 4 && best.length < 4; ring++) for (var dx = -ring; dx <= ring; dx++) for (var dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue; var c = GRID[g][(gx + dx) + ',' + (gy + dy)]; if (!c) continue;
        c.forEach(function (k4) { best.push([Math.hypot(S.DX[k4] - nx, S.DY[k4] - ny), k4]); });
      }
      if (!best.length) return [VIEW.cx, VIEW.cy];
      best.sort(function (a, b) { return a[0] - b[0]; }); best = best.slice(0, 4);
      var wx = 0, wy = 0, ws = 0; best.forEach(function (b) { var wt = 1 / (b[0] + 0.02); wx += SCR[b[1] * 2] * wt; wy += SCR[b[1] * 2 + 1] * wt; ws += wt; });
      return [wx / ws, wy / ws];
    };
  }
  return { S: out, cores: cores, tidal: tidal, scale: sc * 0.3, sc: sc };
}

/* ---------- strong lensing: stipple the image plane, tracing each dot back to a lensed background galaxy ---------- */
function lensSprites(out) {
  var r = mulberry32(P.seed * 613 + 5), thE = P.lensR, g = P.lensShear, phi = P.lensShearA * Math.PI / 180, c2 = Math.cos(2 * phi), s2 = Math.sin(2 * phi);
  var sa = P.lensSrcA * Math.PI / 180, sx = P.lensSrc * thE * Math.cos(sa), sy = P.lensSrc * thE * Math.sin(sa), rs = P.lensSize;
  var cl = [], nc = 4 + Math.floor(r() * 6);                         // the source's star-forming clumps
  for (var i = 0; i < nc; i++) cl.push([sx + gauss(r) * rs * 0.7, sy + gauss(r) * rs * 0.7, rs * (0.1 + 0.12 * r()), 0.6 + 0.8 * r()]);
  var sarm = r() * 6.28;
  var SRC = null;
  if (P.lensSource === 'drawing') {
    var pool = []; AT.whole.type.forEach(function (t, i) { if (t.indexOf('galaxy') === 0) pool.push(i); }); var wi = pool[Math.floor(r() * pool.length)], v = AT.whole.vec[wi]; USED.add(AT.whole.src[wi]);
    var N = 160, can = document.createElement('canvas'); can.width = can.height = N; var x2 = can.getContext('2d'); x2.strokeStyle = x2.fillStyle = '#000'; x2.lineWidth = 3.6; x2.lineJoin = x2.lineCap = 'round';
    v.l.forEach(function (fl) { x2.beginPath(); for (var i = 0; i < fl.length; i += 2) { var X = (fl[i] + 0.5) * N, Y = (fl[i + 1] + 0.5) * N; if (i) x2.lineTo(X, Y); else x2.moveTo(X, Y); } x2.stroke(); });
    v.d.forEach(function (d) { x2.beginPath(); x2.arc((d[0] + 0.5) * N, (d[1] + 0.5) * N, Math.max(1.8, d[2] * N), 0, 7); x2.fill(); });
    v.b.forEach(function (b) { x2.beginPath(); x2.ellipse((b[0] + 0.5) * N, (b[1] + 0.5) * N, b[2] * N, b[3] * N, b[4], 0, 7); x2.fill(); });
    SRC = { a: x2.getImageData(0, 0, N, N).data, N: N };
  }
  function S(bx, by) {
    if (SRC) { var tx = (bx - sx) / (2 * rs) + 0.5, ty = (by - sy) / (2 * rs) + 0.5; if (tx < 0 || tx >= 1 || ty < 0 || ty >= 1) return 0; return SRC.a[((ty * SRC.N | 0) * SRC.N + (tx * SRC.N | 0)) * 4 + 3] / 255 * 1.3; }
    var dx = bx - sx, dy = by - sy, rr = Math.hypot(dx, dy) / rs, th = Math.atan2(dy, dx);
    var v = Math.exp(-rr * 1.6) * (0.55 + 0.45 * Math.cos(2 * (th - Math.log(rr + 0.05) * 2.2 - sarm)));
    for (var k = 0; k < cl.length; k++) { var ex = (bx - cl[k][0]) / cl[k][2], ey = (by - cl[k][1]) / cl[k][2]; v += cl[k][3] * Math.exp(-0.5 * (ex * ex + ey * ey)); }
    return Math.min(1.5, v);
  }
  var R = 2.4 * thE, T = SRC ? 300000 : 160000, cand = [], tot = 0;
  for (var t = 0; t < T; t++) {
    var u = Math.sqrt(r()) * R, a = r() * 6.28, x = u * Math.cos(a), y = u * Math.sin(a), rt = Math.max(1e-3, u);
    var ax = thE * x / rt + g * (c2 * x + s2 * y), ay = thE * y / rt + g * (s2 * x - c2 * y);
    var sv = S(x - ax, y - ay); if (sv > 0.02) { cand.push([x, y, sv]); tot += sv; }
  }
  var k2 = P.lensStars / Math.max(tot, 1e-6), pa = paR(), ca = Math.cos(pa), sn = Math.sin(pa);
  cand.forEach(function (c) {
    if (r() > c[2] * k2) return;
    var X = VIEW.cx + (c[0] * ca - c[1] * sn) * VIEW.scale, Y = VIEW.cy + (c[0] * sn + c[1] * ca) * VIEW.scale;
    if (c[2] > 0.7 && r() < 0.3) inst(out.knots, 'knots', X, Y, VAR.knotPool[Math.floor(r() * VAR.knotPool.length)], 1, simple((3 + 3 * r()) * PEN.dot, r() * 6.28));
    else { var tt = VAR.dotPool[Math.floor(r() * VAR.dotPool.length)]; inst(out.young, 'dots', X, Y, tt, 1, simple(dotSprite(tt, 0.95), r() * 6.28)); }
  });
}
/* ---------- lensing, v10: elliptical cored lenses; a triangle-mesh solver; the source galaxy lensed mark by mark; a quasar with time delays; clusters; a double ring ---------- */
var LENSQ = null, LENSWL = null;
function lensModel(f) {                          /* the deflection field, for a source plane f times farther (in lensing strength) than the main one */
  var thE = P.lensR, halos = [], r = mulberry32(P.seed * 431 + 9);
  if (P.lensCluster) { halos.push({ x: 0, y: 0, b: thE * 1.55, q: 0.72, ang: 0.35, s: thE * 0.22 });
    var nm = 7 + Math.floor(r() * 5); for (var i = 0; i < nm; i++) { var a = r() * 6.2832, d = thE * (0.55 + 1.7 * Math.sqrt(r())); halos.push({ x: d * Math.cos(a), y: d * Math.sin(a), b: thE * (0.07 + 0.17 * r()), q: 0.6 + 0.35 * r(), ang: r() * 3.1416, s: thE * 0.01, member: true }); } }
  else halos.push({ x: 0, y: 0, b: thE, q: P.lensQ, ang: (P.lensAngle || 0) * Math.PI / 180, s: thE * P.lensCore });
  var g = P.lensShear, phi = P.lensShearA * Math.PI / 180, c2 = Math.cos(2 * phi), s2 = Math.sin(2 * phi);
  function alpha(x, y) { var ax = 0, ay = 0;
    for (var k = 0; k < halos.length; k++) { var h = halos[k], dx = x - h.x, dy = y - h.y, ca = Math.cos(h.ang), sa = Math.sin(h.ang), u = dx * ca + dy * sa, v = -dx * sa + dy * ca, q = clamp(h.q, 0.2, 0.995), e = Math.sqrt(1 - q * q), ps = Math.sqrt(q * q * (h.s * h.s + u * u) + v * v), kk = h.b * q / e;
      var au = kk * Math.atan(e * u / (ps + h.s)), av = kk * Math.atanh(clamp(e * v / (ps + q * q * h.s), -0.999999, 0.999999)); ax += au * ca - av * sa; ay += au * sa + av * ca; }   /* a non-singular isothermal ellipsoid (Keeton 2001) */
    ax += g * (c2 * x + s2 * y); ay += g * (s2 * x - c2 * y); return [ax * f, ay * f]; }
  function psi(x, y) { var pp = 0; halos.forEach(function (h) { var dx = x - h.x, dy = y - h.y, ca = Math.cos(h.ang), sa = Math.sin(h.ang), u = dx * ca + dy * sa, v = -dx * sa + dy * ca; pp += h.b * Math.sqrt(h.q * u * u + v * v / h.q + h.s * h.s); });
    return (pp + 0.5 * g * (c2 * (x * x - y * y) + 2 * s2 * x * y)) * f; }   /* the lensing potential, approximate: enough to order the time delays */
  return { alpha: alpha, psi: psi, halos: halos };
}
function lensSolver(model, R, G) {               /* a triangle mesh over the image, each triangle traced back to the source: any source point's every image, with its local stretch and parity */
  var n = G + 1, TX = new Float32Array(n * n), TY = new Float32Array(n * n), BX = new Float32Array(n * n), BY = new Float32Array(n * n), bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) { var o = j * n + i, x = -R + 2 * R * i / G, y = -R + 2 * R * j / G, a = model.alpha(x, y); TX[o] = x; TY[o] = y; BX[o] = x - a[0]; BY[o] = y - a[1];
    if (BX[o] < bx0) bx0 = BX[o]; if (BX[o] > bx1) bx1 = BX[o]; if (BY[o] < by0) by0 = BY[o]; if (BY[o] > by1) by1 = BY[o]; }
  var H = G, cw = (bx1 - bx0) / H || 1, ch = (by1 - by0) / H || 1, bins = new Array(H * H), tris = [];
  for (var j2 = 0; j2 < G; j2++) for (var i2 = 0; i2 < G; i2++) { var a0 = j2 * n + i2, a1 = a0 + 1, a2 = a0 + n, a3 = a2 + 1;
    [[a0, a1, a3], [a0, a3, a2]].forEach(function (t) { var id = tris.length; tris.push(t);
      var mnx = Math.min(BX[t[0]], BX[t[1]], BX[t[2]]), mxx = Math.max(BX[t[0]], BX[t[1]], BX[t[2]]), mny = Math.min(BY[t[0]], BY[t[1]], BY[t[2]]), mxy = Math.max(BY[t[0]], BY[t[1]], BY[t[2]]);
      var ix0 = clamp(Math.floor((mnx - bx0) / cw), 0, H - 1), ix1 = clamp(Math.floor((mxx - bx0) / cw), 0, H - 1), iy0 = clamp(Math.floor((mny - by0) / ch), 0, H - 1), iy1 = clamp(Math.floor((mxy - by0) / ch), 0, H - 1);
      if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > 400) return;                                              /* a triangle smeared across the caustic: skip it */
      for (var yy = iy0; yy <= iy1; yy++) for (var xx = ix0; xx <= ix1; xx++) { var bi = yy * H + xx; (bins[bi] || (bins[bi] = [])).push(id); } }); }
  var cell = 2 * R / G;
  function images(px, py) { var res = [], ix = Math.floor((px - bx0) / cw), iy = Math.floor((py - by0) / ch); if (ix < 0 || iy < 0 || ix >= H || iy >= H) return res; var list = bins[iy * H + ix]; if (!list) return res;
    for (var k = 0; k < list.length; k++) { var t = tris[list[k]], x0 = BX[t[0]], y0 = BY[t[0]], e1x = BX[t[1]] - x0, e1y = BY[t[1]] - y0, e2x = BX[t[2]] - x0, e2y = BY[t[2]] - y0, det = e1x * e2y - e2x * e1y; if (Math.abs(det) < 1e-12) continue;
      var dx = px - x0, dy = py - y0, l1 = (dx * e2y - e2x * dy) / det, l2 = (e1x * dy - dx * e1y) / det; if (l1 < -1e-6 || l2 < -1e-6 || l1 + l2 > 1 + 1e-6) continue;
      var f1x = TX[t[1]] - TX[t[0]], f1y = TY[t[1]] - TY[t[0]], f2x = TX[t[2]] - TX[t[0]], f2y = TY[t[2]] - TY[t[0]], ix2 = TX[t[0]] + l1 * f1x + l2 * f2x, iy2 = TY[t[0]] + l1 * f1y + l2 * f2y;
      var J = [(f1x * e2y - f2x * e1y) / det, (f2x * e1x - f1x * e2x) / det, (f1y * e2y - f2y * e1y) / det, (f2y * e1x - f1y * e2x) / det];   /* image displacement per source displacement */
      var dup = false; for (var m = 0; m < res.length; m++) if (Math.abs(res[m].x - ix2) < cell * 0.6 && Math.abs(res[m].y - iy2) < cell * 0.6) { dup = true; break; } if (dup) continue;
      res.push({ x: ix2, y: iy2, J: J, mu: J[0] * J[3] - J[1] * J[2] }); }
    return res; }
  return { images: images, R: R, cell: cell };
}
function buildSourceGalaxy(seed, sizeGU, o) {    /* a galaxy built exactly as a single one is, its every mark recorded in the source plane */
  var mainP = P, mainVAR = VAR, mainScale = VIEW.scale, mainSM = SM, Ssrc = 70, k = sizeGU / (4.2 * Ssrc);
  P = Object.assign({}, mainP, { merger: 0, lensOn: 0, lensCluster: 0, lensDouble: 0, shellsOn: 0, subject: 'galaxy', field: 0, fgstars: 0, trails: 0, companions: 0, arrow: 0, jet: 0, rewind: 0, unwrap: 0, distort: 0, ring: 0, whole: 0, envelope: 0, outline: 0,
    seed: seed, arms: o.arms, pitch: o.pitch || 22, bulge: o.bulge, bar: o.bar || 0, incl: o.incl || 25, az: 0, pa: o.pa || 0, winding: 1, stars: o.stars || 2400, stipple: 1, halo: 0.03, lines: o.lines == null ? 0.6 : o.lines, flocc: o.flocc || 0, knots: o.knots == null ? 0.6 : o.knots, sparkle: 0.3, dustScribble: 0.25, irr: o.irr || 0 });
  VIEW.scale = Ssrc; VAR = makeVariation(); SM = function (x, y) { return [x, y]; };
  var Sg = generate(), Cg = curves(mulberry32(P.seed * 31 + 5)), Lg = parts(mulberry32(P.seed * 57 + 3)), cx = VIEW.cx, cy = VIEW.cy;
  function ts(X, Y) { return [(X - cx) * k, (Y - cy) * k]; }
  var M = { sprites: [], curves: [], vecs: [], k: k };
  ['old', 'disc', 'young', 'knots', 'stars'].forEach(function (key) { (Sg[key] || []).forEach(function (row) { M.sprites.push({ key: key, row: row, b: ts(row[0], row[1]) }); }); });
  (Sg.rstars || []).forEach(function (row) { M.sprites.push({ key: 'rstars', row: row, b: ts(row[0], row[1]) }); });
  Cg.forEach(function (c) { M.curves.push({ c: c, b: c.pts.map(project).map(function (q) { return ts(q[0], q[1]); }) }); });
  Object.keys(Lg).forEach(function (key) { if (!Array.isArray(Lg[key]) || key === 'bg' || key === 'front' || key === 'bgdots') return;
    Lg[key].forEach(function (row) { if (AT[key] && AT[key].vec) M.vecs.push({ key: key, row: row, b: ts(row[0], row[1]) }); else M.sprites.push({ key: 'L:' + key, row: row, b: ts(row[0], row[1]) }); }); });
  P = mainP; VAR = mainVAR; VIEW.scale = mainScale; SM = mainSM;
  return M;
}
function lensMarks(M, solver, bc, out, LQ, CV, dens) {   /* every mark into every image: stipple keeps its surface brightness, strokes and drawings are warped, mirrored ones mirrored */
  var r = mulberry32(P.seed * 733 + Math.round(bc[0] * 997)), U = VIEW.scale, pa = paR(), ca = Math.cos(pa), sa = Math.sin(pa), k = M.k;
  function scr(x, y) { return [VIEW.cx + (x * ca - y * sa) * U, VIEW.cy + (x * sa + y * ca) * U]; }
  function rot(x, y) { return [x * ca - y * sa, x * sa + y * ca]; }
  var DOTS = { old: 1, disc: 1, young: 1 }, tot = 0, cache = [];
  M.sprites.forEach(function (m, i) { var im = solver.images(bc[0] + m.b[0], bc[1] + m.b[1]); cache[i] = im; if (DOTS[m.key]) im.forEach(function (q) { tot += Math.min(30, Math.abs(q.mu)); }); });
  var kap = Math.min(1.2, 0.5 * dens / Math.max(1, tot)), sig = 1.3 * k;   /* lighter stipple: the drawing has to read through it */
  M.sprites.forEach(function (m, i) { cache[i].forEach(function (q) { var mu = Math.min(30, Math.abs(q.mu));
    if (DOTS[m.key]) { var nC = Math.floor(kap * mu + r()); for (var c = 0; c < nC; c++) { var db = [gauss(r) * sig, gauss(r) * sig], tx = q.x + q.J[0] * db[0] + q.J[1] * db[1], ty = q.y + q.J[2] * db[0] + q.J[3] * db[1], p = scr(tx, ty), row = m.row.slice(); row[0] = p[0]; row[1] = p[1]; out[m.key].push(row); } return; }
    var p2 = scr(q.x, q.y), row2 = m.row.slice(); row2[0] = p2[0]; row2[1] = p2[1];
    if (m.key === 'knots' || m.key === 'stars') { if (r() > 0.55) return; var sc = clamp(Math.pow(mu, 0.25), 0.7, 1.3); for (var e = 4; e < 8; e++) row2[e] *= sc; out[m.key].push(row2); }
    else if (m.key === 'rstars') out.rstars.push(row2);
    else LQ.push({ key: m.key.slice(2), row: row2 }); }); });
  M.vecs.forEach(function (m) { solver.images(bc[0] + m.b[0], bc[1] + m.b[1]).forEach(function (q) { if (Math.abs(q.mu) > 40) return;
    var ax = m.row[0], ay = m.row[1], J = q.J, wid = WARPS.push({ post: function (X, Y) { var dx = (X - ax) * k, dy = (Y - ay) * k; return scr(q.x + J[0] * dx + J[1] * dy, q.y + J[2] * dx + J[3] * dy); } }) - 1;
    var row = m.row.slice(); if (row[8] == null) row[8] = 1; row[9] = wid; LQ.push({ key: m.key, row: row }); }); });
  M.curves.forEach(function (m) {                   /* strokes: resampled, traced into each image, broken where the images part */
    var pts = [], b = m.b; for (var i = 1; i < b.length; i++) { var sx = b[i - 1][0], sy = b[i - 1][1], L = Math.hypot(b[i][0] - sx, b[i][1] - sy), st = Math.max(1, Math.ceil(L / (solver.cell * 0.5)));
      for (var s2 = 0; s2 < st; s2++) pts.push([sx + (b[i][0] - sx) * s2 / st, sy + (b[i][1] - sy) * s2 / st]); } if (b.length) pts.push(b[b.length - 1]);
    var live = [], done = [];
    pts.forEach(function (pt) { var im = solver.images(bc[0] + pt[0], bc[1] + pt[1]), used = [];
      var next = []; live.forEach(function (br) { var last = br[br.length - 1], best = -1, bd = solver.cell * 4; im.forEach(function (q, qi) { if (used[qi]) return; var d = Math.hypot(q.x - last[0], q.y - last[1]); if (d < bd) { bd = d; best = qi; } });
        if (best >= 0) { used[best] = 1; br.push([im[best].x, im[best].y]); next.push(br); } else done.push(br); });
      im.forEach(function (q, qi) { if (!used[qi]) next.push([[q.x, q.y]]); }); live = next; });
    done.concat(live).forEach(function (br) { if (br.length < 3) return; CV.push(Object.assign({}, m.c, { pts2d: br.map(function (p) { return rot(p[0], p[1]); }), taper: false })); }); });
}
function lensStar(out, X, Y, B, r) {             /* a quasar image: your star drawing, a saturated heart and a little glare */
  var SS = AT.sstars, pool = []; if (SS) SS.kind.forEach(function (kk, i) { if (kk === 'outline' || kk === 'burst') pool.push(i); });
  for (var k = 0; k < Math.round(8 + 40 * B); k++) { var a = r() * 6.2832, d = Math.pow(r(), 1.5) * (2 + 7 * B) * PEN.dot; inst(out.knots, 'knots', X + Math.cos(a) * d, Y + Math.sin(a) * d, VAR.knotPool[Math.floor(r() * VAR.knotPool.length)], 1, simple((3 + 3 * r()) * PEN.dot, r() * 6.28)); }
  for (var h = 0; h < Math.round(120 + 1500 * B); h++) { var a2 = r() * 6.2832, d2 = (3 + 8 * B) * PEN.dot * Math.pow(1 - r() * 0.985, -0.62); if (d2 > VIEW.scale * 0.75 * B) continue; var t = VAR.dotPool[Math.floor(r() * VAR.dotPool.length)]; inst(out.disc, 'dots', X + Math.cos(a2) * d2, Y + Math.sin(a2) * d2, t, 1, simple(dotSprite(t, 0.85), r() * 6.28)); }
  if (pool.length) { inst(out.rstars, 'sstars', X, Y, pool[Math.floor(r() * pool.length)], 1, simple((16 + 38 * B) * PEN.dot, VAR.spike || 0)); out.rstars[out.rstars.length - 1].push(0.7 + 0.5 * B); }
}
function lensSprites10(out, V, PIE) {
  var thE = P.lensR, r = mulberry32(P.seed * 613 + 5), model = lensModel(1), R = (P.lensCluster ? 3.6 : 2.5) * thE, solver = lensSolver(model, R, P.lensCluster ? 250 : 210);
  var sa = P.lensSrcA * Math.PI / 180, bc = srcNow(P.lensSrc * thE * Math.cos(sa), P.lensSrc * thE * Math.sin(sa), 2.5 * thE), LQ = [], CV = [],   /* the source sits behind the lens: orbit, and the alignment changes */ U = VIEW.scale, pa = paR(), ca = Math.cos(pa), sn = Math.sin(pa);
  function scr(x, y) { return [VIEW.cx + (x * ca - y * sn) * U, VIEW.cy + (x * sn + y * ca) * U]; }
  if (P.lensSource === 'quasar') {                /* a quasar: four point images, each as bright as it is magnified; a flare reaches them in turn */
    var imgs = solver.images(bc[0], bc[1]).filter(function (q) { return Math.abs(q.mu) > 0.08; }), tau = imgs.map(function (q) { return 0.5 * ((q.x - bc[0]) * (q.x - bc[0]) + (q.y - bc[1]) * (q.y - bc[1])) - model.psi(q.x, q.y); });
    var t0 = Math.min.apply(null, tau.concat([0])), t1 = Math.max.apply(null, tau.concat([1e-6])), now = ((P.mTime == null ? 1 : P.mTime) / 2) % 1;
    imgs.forEach(function (q, i) { var arrive = 0.18 + 0.55 * (tau[i] - t0) / Math.max(1e-6, t1 - t0), dt = Math.min(Math.abs(now - arrive), 1 - Math.abs(now - arrive)), flare = 1 + 3.2 * Math.exp(-(dt * dt) / (2 * 0.05 * 0.05));
      var B = clamp((0.2 + 0.12 * Math.log(1 + Math.abs(q.mu))) * flare, 0.15, 1.6), p = scr(q.x, q.y); lensStar(out, p[0], p[1], B, r); });   /* dim between flares, blazing as one passes */
    var host = buildSourceGalaxy(P.seed * 17 + 5, 2 * P.lensSize, { arms: 2, bulge: 0.25, stars: 1400, lines: 0.2, knots: 0.15 }); lensMarks(host, solver, bc, out, LQ, CV, P.lensStars * 0.18);   /* a faint host */
  } else if (P.lensSource === 'drawing') {        /* one of your drawings as the source, copied and warped into every image */
    var pool = []; AT.whole.type.forEach(function (t, i) { if (t.indexOf('galaxy') === 0) pool.push(i); }); var wi = pool[Math.floor(r() * pool.length)], Sd = 70, kd = 2 * P.lensSize / (Sd * 2);
    var row = [VIEW.cx, VIEW.cy, wi, 1, Sd * 2, 0, 0, Sd * 2, 1]; USED.add(AT.whole.src[wi]); lensMarks({ sprites: [], curves: [], vecs: [{ key: 'whole', row: row, b: [0, 0] }], k: kd }, solver, bc, out, LQ, CV, 0);
  } else if (P.lensCluster) {                     /* a cluster: several background galaxies become giant arcs, radial arcs and arclets */
    var nS = 6 + Math.floor(r() * 4);
    for (var i = 0; i < nS; i++) { var a = r() * 6.2832, d = thE * (0.08 + 1.5 * Math.pow(r(), 0.8)), sz = thE * (0.14 + 0.2 * r());
      var M = buildSourceGalaxy(P.seed * 29 + i * 7 + 3, sz, { arms: 1 + Math.floor(r() * 3), bulge: 0.1 + 0.3 * r(), stars: 1200, lines: 0.45, flocc: r() < 0.3 ? 0.5 : 0, incl: r() * 60, pa: r() * 180 });
      lensMarks(M, solver, srcNow(d * Math.cos(a), d * Math.sin(a), thE * (1.5 + 2 * ((i * 0.618034) % 1))), out, LQ, CV, P.lensStars / nS * 1.1); }   /* each at its own depth */
    var smooth = []; AT.whole.type.forEach(function (t, i) { if (t.indexOf('smooth') === 0) smooth.push(i); });   /* the member galaxies, drawn in */
    model.halos.forEach(function (h) { if (!h.member || !smooth.length) return; var p = scr(h.x, h.y), wi2 = smooth[Math.floor(r() * smooth.length)], z = h.b * U * 3.2; USED.add(AT.whole.src[wi2]);
      LQ.push({ key: 'whole', row: [p[0], p[1], wi2, 1, z * Math.cos(h.ang), z * Math.sin(h.ang), -z * Math.sin(h.ang) * h.q, z * Math.cos(h.ang) * h.q, 1] }); });
    LENSWL = lensModel(1.3);
  } else {                                        /* one source galaxy, lensed mark by mark */
    var M1 = buildSourceGalaxy(P.seed * 17 + 5, 2 * P.lensSize, { arms: 2 + Math.floor(r() * 2), bulge: 0.2, stars: 2200, lines: 0.35, knots: 0.35, incl: 20 + 30 * r(), pa: r() * 180 }); lensMarks(M1, solver, bc, out, LQ, CV, P.lensStars);
  }
  if (P.lensDouble) {                             /* a second source, farther away, gives a second and wider ring */
    var model2 = lensModel(1.42), solver2 = lensSolver(model2, R * 1.2, 200), M2 = buildSourceGalaxy(P.seed * 41 + 9, 2 * P.lensSize * 0.9, { arms: 0, bulge: 0.1, stars: 1600, lines: 0.15, knots: 0.3, flocc: 0.6, irr: 1 });
    lensMarks(M2, solver2, srcNow(0.02 * thE, -0.015 * thE, 3.5 * thE), out, LQ, CV, P.lensStars * 0.45);   /* farther back */
  }
  buildCurves(CV, V, PIE); LENSQ = LQ;
}
/* ---------- shells: a small galaxy falls radially into a big elliptical; its stars phase-wrap into interleaved shells ---------- */
var SCACHE = { key: null, res: null };
function shellSprites(out) {
  var key = [P.seed, P.shellTime, P.shellStars].join('|');
  if (SCACHE.key !== key) {
    var r = mulberry32(P.seed * 977 + 3), N = P.shellStars, X = new Float32Array(N * 3), V = new Float32Array(N * 3), rc2 = 0.3;
    for (var i = 0; i < N; i++) {                                     // the satellite: a cold cloud released far out, falling almost straight in
      X[i * 3] = 3.0 + gauss(r) * 0.5; X[i * 3 + 1] = gauss(r) * 0.02; X[i * 3 + 2] = gauss(r) * 0.02;
      V[i * 3] = -0.1 + gauss(r) * 0.05; V[i * 3 + 1] = gauss(r) * 0.012; V[i * 3 + 2] = gauss(r) * 0.012;
    }
    var dt = 0.02, steps = Math.ceil(P.shellTime / dt);
    for (var st = 0; st < steps; st++) for (var j = 0; j < N; j++) {    // logarithmic potential: a flat rotation curve
      var o = j * 3, x = X[o], y = X[o + 1], z = X[o + 2], f = -1 / (x * x + y * y + z * z + rc2);
      V[o] += f * x * dt; V[o + 1] += f * y * dt; V[o + 2] += f * z * dt; X[o] += V[o] * dt; X[o + 1] += V[o + 1] * dt; X[o + 2] += V[o + 2] * dt;
    }
    var arcs = [];
    [1, -1].forEach(function (side) {
      var nb = 64, h = new Float32Array(nb), th = [], rmax = 4.2;
      for (var k = 0; k < N; k++) { var x = X[k * 3] * side; if (x <= 0) continue; var rr = Math.hypot(X[k * 3], X[k * 3 + 1], X[k * 3 + 2]); if (rr < 0.6 || rr > rmax) continue; h[Math.floor(rr / rmax * nb)]++; }
      var sm = new Float32Array(nb); for (var b = 1; b < nb - 1; b++) sm[b] = (h[b - 1] + 2 * h[b] + h[b + 1]) / 4;
      var found = [];
      for (var b2 = 3; b2 < nb - 2; b2++) { var drop = sm[b2] - sm[b2 + 2]; if (sm[b2] >= sm[b2 - 1] && sm[b2] >= sm[b2 + 1] && drop > 0.45 * sm[b2] && sm[b2] > N * 0.004) found.push([drop, (b2 + 0.8) / nb * rmax]); }
      found.sort(function (a, b) { return b[0] - a[0]; });
      found.slice(0, 3).forEach(function (f) {
        var R = f[1], angs = [];
        for (var k = 0; k < N; k++) { var rr = Math.hypot(X[k * 3], X[k * 3 + 1], X[k * 3 + 2]); if (Math.abs(rr - R) < 0.12 && X[k * 3] * side > 0) angs.push(Math.atan2(Math.hypot(X[k * 3 + 1], X[k * 3 + 2]), Math.abs(X[k * 3]))); }
        angs.sort(function (a, b) { return a - b; }); var open = angs.length ? angs[Math.floor(angs.length * 0.85)] : 0.6;
        arcs.push({ R: R, side: side, open: Math.min(1.3, Math.max(0.35, open)) });
      });
    });
    SCACHE = { key: key, res: X, arcs: arcs };
  }
  var X2 = SCACHE.res, r2 = mulberry32(P.seed * 31 + 1), ax = P.shellAxis * Math.PI / 180, ca = Math.cos(ax), sn = Math.sin(ax);
  for (var k = 0; k < X2.length / 3; k++) {
    var x0 = X2[k * 3], y0 = X2[k * 3 + 1];
    if (Math.hypot(x0, y0) > RMAX + 0.4) continue;
    var tt = VAR.dotPool[Math.floor(r2() * VAR.dotPool.length)];
    inst(out.old, 'dots', VIEW.cx + (x0 * ca - y0 * sn) * VIEW.scale, VIEW.cy + (x0 * sn + y0 * ca) * VIEW.scale, tt, 1, simple(dotSprite(tt, 0.85), r2() * 6.28));
  }
}

function shellArcs() {
  if (!P.shellsOn || !SCACHE.arcs || SCACHE.key !== [P.seed, P.shellTime, P.shellStars].join('|')) return [];
  var ax = P.shellAxis * Math.PI / 180, r = mulberry32(P.seed * 5 + 17), out = [];
  SCACHE.arcs.forEach(function (a) {
    var pts = [], c0 = a.side > 0 ? 0 : Math.PI;
    for (var j = 0; j <= 40; j++) { var t = c0 - a.open + 2 * a.open * j / 40; pts.push([a.R * Math.cos(t + ax), a.R * Math.sin(t + ax)]); }
    out.push({ pts2d: pts, w: 0.7, k: strokeIndex('faint', r), a: 1 });
  });
  return out;
}

/* ---------- curves: ribbons (tiled) and re-spaced pieces ---------- */
function strokeIndex(kind, r) {
  var ks = AT.strokes.kind, pool = [];
  for (var k = 0; k < ks.length; k++) if (kind === 'mixed' ? (ks[k] === 'plain' || ks[k] === 'beaded' || ks[k] === 'spurred') : ks[k] === kind) pool.push(k);
  if (!pool.length) for (var k2 = 0; k2 < ks.length; k2++) pool.push(k2);
  return pool[Math.floor(r() * pool.length)];
}
function curves(r) {
  var C = []; if (P.lines <= 0) return C;
  var w = 1, A = 1;                                     // width is set per stroke from its measured ink thickness
  var rs = mulberry32(VAR.strokeSeed); r = function () { return rs(); };
  if (P.arms >= 1 && P.bulge < 0.95 && P.armStyle === 'ribbons' && !P.ringOnlyLines) {
    var r0 = P.bar > 0.05 ? P.barLen : 0.25;
    for (var k = 0; k < P.arms; k++) {
      var pts = [], off = 2 * Math.PI * k / P.arms, rmax = Math.min(VAR.arms[k % VAR.arms.length].rmax, 2.1 + 0.5 * (1 - P.bulge));
      for (var j = 0; j <= 160; j++) { var R = r0 + (rmax - r0) * j / 160, th = armPhase(R, k) + off; pts.push([R * Math.cos(th) + VAR.lop * R * Math.cos(VAR.lopA) * 0.35, R * Math.sin(th) + VAR.lop * R * Math.sin(VAR.lopA) * 0.35, 0]); }
      if (P.flocc > 0.3) { var seg = [];
        for (var j2 = 0; j2 < pts.length; j2++) { if (vnoise(j2 * 0.08 + k * 7, P.seed) > 0.25 + 0.35 * P.flocc) seg.push(pts[j2]); else { if (seg.length > 6) C.push({ pts: seg, w: w * 0.8, k: strokeIndex(P.stroke, r), a: A }); seg = []; } }
        if (seg.length > 6) C.push({ pts: seg, w: w * 0.8, k: strokeIndex(P.stroke, r), a: A });
      } else C.push({ pts: pts, w: w, k: strokeIndex(P.stroke, r), a: A, taper: true });
    }
    VAR.spurs.forEach(function (sp) { if (r() > 0.6) return; var pts2 = [], base = armPhase(sp.R0, sp.k) + 2 * Math.PI * sp.k / P.arms;
      for (var j3 = 0; j3 <= 30; j3++) { var R3 = sp.R0 + sp.len * j3 / 30, t3 = base + Math.log(R3 / sp.R0) / Math.tan(clamp(P.pitch * sp.pk, 10, 70) * Math.PI / 180); pts2.push([R3 * Math.cos(t3), R3 * Math.sin(t3), 0]); }
      C.push({ pts: pts2, w: w * 0.7, k: strokeIndex(P.stroke === 'mixed' ? 'spurred' : P.stroke, r), a: A, taper: true }); });
  }
  if (P.ring > 0.1 && P.ringStyle === 'ribbon') { var rp = []; for (var a = 0; a <= 180; a++) { var t = a / 180 * 2 * Math.PI; rp.push([P.ringR * Math.cos(t), P.ringR * Math.sin(t), 0]); } C.push({ pts: rp, w: w * 0.45, k: strokeIndex(P.stroke, r), a: A * P.ring }); }
  if (P.bar > 0.1 && P.barStyle === 'ribbon') C.push({ pts: [[-P.barLen, 0, 0], [0, 0, 0], [P.barLen, 0, 0]], w: w * (1.2 + 1.6 * P.bar), k: strokeIndex('plain', r), a: Math.min(1, P.lines * 1.2) * P.bar, stretch: true });
  if (incE() > 80 && P.kind !== 'merger' && P.bulge < 0.95) C.push({ pts: [[-3.2, 0, 0], [0, 0, 0], [3.2, 0, 0]], w: w * 0.8, k: strokeIndex(P.dust > 0.3 ? 'faint' : P.stroke, r), a: P.lines * (P.incl - 72) / 18, stretch: true });
  if (P.outline > 0.05) {
    [2.6].forEach(function (R, ri) { var a0 = r() * 6.28;
      for (var s = 0; s < 2; s++) { var st = a0 + s * (1.9 + r() * 0.5), len = 0.7 + r() * 0.8, pts = [];
        for (var j = 0; j <= 40; j++) { var t = st + len * j / 40; pts.push([R * Math.cos(t), R * Math.sin(t), 0]); }
        C.push({ pts: pts, w: w * 0.55, k: strokeIndex('faint', r), a: 1 }); } });
  }
  if (P.tail > 0.05) {                                    // a tidal tail swept out from the disc edge
    var tp = [], a1 = r() * 6.28;
    for (var j3 = 0; j3 <= 90; j3++) { var f = j3 / 90, R3 = 2.6 + 2.8 * f, t3 = a1 + 1.5 * f; tp.push([R3 * Math.cos(t3), R3 * Math.sin(t3) + 0.6 * f * f, 0]); }
    C.push({ pts: tp, w: w * 0.9, k: strokeIndex(r() < 0.5 ? 'faint' : 'broken', r), a: 1, taper: true });
  }
  return C;
}
function buildCurves(C, V, pieceList) {
  C.forEach(function (c) {
    var q = c.pts2d ? c.pts2d.map(function (p) { return [VIEW.cx + p[0] * VIEW.scale, VIEW.cy + p[1] * VIEW.scale]; }) : c.pts.map(project), n = q.length; if (n < 2) return;
    USED.add(AT.strokes.src[c.k]);
    var L = [0]; for (var i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]));
    var cw = clamp(PEN.line * c.w * AT.strokes.h / AT.strokes.thick[c.k], 6, 90), tot = L[n - 1] || 1, kpx = cw / AT.strokes.h, pat = AT.strokes.w * kpx;
    c = Object.assign({}, c, { w: cw });
    var reps = c.stretch ? 1 : Math.max(1, Math.round(tot / (pat * 1.4)));
    var pieces = AT.strokes.pieces[c.k];
    if (pieces && pieces.length && !c.stretch) {         // re-spaced: each dot or bead placed at its own spacing along the curve
      var along = tot / (reps * AT.strokes.w);           // px per tile pixel along the curve
      for (var rep = 0; rep < reps; rep++) pieces.forEach(function (pc) {
        var sPos = (rep * AT.strokes.w + pc[0]) * along, j = 1; while (j < n - 1 && L[j] < sPos) j++;
        var f = (sPos - L[j - 1]) / ((L[j] - L[j - 1]) || 1), x = q[j - 1][0] + (q[j][0] - q[j - 1][0]) * f, y = q[j - 1][1] + (q[j][1] - q[j - 1][1]) * f;
        var tx = q[j][0] - q[j - 1][0], ty = q[j][1] - q[j - 1][1], tl = Math.hypot(tx, ty) || 1, nx = -ty / tl, ny = tx / tl;
        var taper = c.taper ? (1.1 - 0.45 * sPos / tot) : 1, off = (pc[1] - AT.strokes.h / 2) * kpx * taper;
        inst(pieceList, 'pieces', x + nx * off, y + ny * off, pc[3], c.a, simple(pc[2] * kpx * taper, Math.atan2(ty, tx)));
      });
      return;
    }
    if (REC) REC.lines.push({ pts: q.map(function (p) { return SM(p[0], p[1]); }), w: Math.max(0.8, PEN.line * (c.w / cw) * 1.0 * (AT.strokes.thick[c.k] / AT.strokes.h) * cw / PEN.line), layer: 'arms' });
    var rows = AT.strokes.n;
    for (var i2 = 0; i2 < n - 1; i2++) {
      var v = [];
      [i2, i2 + 1].forEach(function (j) {
        var a = q[Math.max(0, j - 1)], b = q[Math.min(n - 1, j + 1)], tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
        var nx = -ty / tl, ny = tx / tl, f = L[j] / tot, w = c.w * (c.taper ? (1.1 - 0.45 * f) : 1) / 2;
        var u = f * reps, v0 = (c.k + 0.02) / rows, v1 = (c.k + 0.98) / rows;
        v.push([q[j][0] + nx * w, q[j][1] + ny * w, u, v0], [q[j][0] - nx * w, q[j][1] - ny * w, u, v1]);
      });
      var mv = v.map(function (p) { var m = SM(p[0], p[1]); return [m[0], m[1], p[2], p[3]]; });
      if (seam(mv[0], mv[2]) || (P.unwrap && Math.hypot(mv[2][0] - mv[0][0], mv[2][1] - mv[0][1]) > 60)) continue;
      if (SEAMMAX > 0) { var ol = Math.hypot(v[2][0] - v[0][0], v[2][1] - v[0][1]) + 1, ml = Math.hypot(mv[2][0] - mv[0][0], mv[2][1] - mv[0][1]); if (ml / ol > 1.8) continue; var ow = Math.hypot(v[1][0] - v[0][0], v[1][1] - v[0][1]) + 1, mw = Math.hypot(mv[1][0] - mv[0][0], mv[1][1] - mv[0][1]); if (mw / ow > 1.8) continue; }   /* torn by the tides — along the stroke or across it */
      [[0, 1, 2], [1, 3, 2]].forEach(function (tr) { tr.forEach(function (t) { var p = mv[t]; V.push(p[0], p[1], p[2], p[3], c.a); }); });
    }
  });
}

/* ---------- drawn parts: arms, bar, ring, core, envelopes, whole drawings, oddities ---------- */
function drawingFlip(w) { return w === 'S' ? 1 : w === 'Z' ? -1 : -1; }         // unknown winding: most of the drawings are Z-wise
function rewindFn(pd, pt, flip) {
  var dk = clamp(1 / Math.tan(clamp(pt, 5, 60) * Math.PI / 180) - 1 / Math.tan(clamp(pd, 5, 60) * Math.PI / 180), -4, 4);
  return function (x, y) { if (flip) x = -x; var rr = Math.hypot(x, y); if (rr < 0.015) return [x, y]; var th = Math.atan2(y, x) + dk * Math.log(rr / 0.08); return [rr * Math.cos(th), rr * Math.sin(th)]; };
}
function longestLine(v) { var best = null, bl = 0; v.l.forEach(function (fl) { var L = 0; for (var i = 2; i < fl.length; i += 2) L += Math.hypot(fl[i] - fl[i - 2], fl[i + 1] - fl[i - 1]); if (L > bl) { bl = L; best = fl; } }); return best; }
function lineParam(fl) {
  var pts = []; for (var i = 0; i < fl.length; i += 2) pts.push([fl[i], fl[i + 1]]);
  var xs = pts.map(function (p) { return p[0]; }), x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), ym = pts.reduce(function (a, p) { return a + p[1]; }, 0) / pts.length;
  return pts.map(function (p) { return [(p[0] - x0) / Math.max(1e-6, x1 - x0), p[1] - ym]; }).sort(function (a, b) { return a[0] - b[0]; });
}

/* ---------- the extras live in 3D. Background galaxies fill a volume behind the scene, each a small 3D galaxy of your dots
   (disc with thickness, a bulge) with your drawing laid on its disc plane. Foreground stars sit nearer. A perspective camera
   orbits the main galaxy; everything is drawn back to front, so nothing pops. ---------- */
function incE() { var i = ((P.incl % 360) + 360) % 360; if (i > 180) i = 360 - i; return i > 90 ? 180 - i : i; }
var SKY = { key: null }, CAM = 30, RMIN = 40, RMAX = 240, R_FG = 42, ZOOM = 1;
function unit3(r) { var z = 2 * r() - 1, t = r() * 6.28318, q = Math.sqrt(1 - z * z); return [q * Math.cos(t), q * Math.sin(t), z]; }
function toView(w) { var i = P.incl * Math.PI / 180, c = Math.cos(i), sn = Math.sin(i), az = azR(), cz = Math.cos(az), sz = Math.sin(az), x = w[0] * cz - w[1] * sz, y = w[0] * sz + w[1] * cz; return [x, y * c - w[2] * sn, y * sn + w[2] * c]; }
function toScreen(v, k) { var a = paR(), ca = Math.cos(a), sa = Math.sin(a), f = VIEW.scale * k; return [VIEW.cx + (v[0] * ca - v[1] * sa) * f, VIEW.cy + (v[0] * sa + v[1] * ca) * f]; }
function basis(n) { var a = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], e1 = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]], l = Math.hypot(e1[0], e1[1], e1[2]);
  e1 = e1.map(function (x) { return x / l; }); return [e1, [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]]]; }
function orient(nw, size, spin, flat) {
  var n = toView(nw), cosI = Math.abs(n[2]), phi = Math.atan2(n[1], n[0]) + Math.PI / 2 + paR();
  return chain(Rm(phi), Sm(size, size * Math.max(flat || 0.12, cosI)), Sm(n[2] < 0 ? -1 : 1, 1), Rm(spin));
}
function buildSky() {
  var key = [P.seed, P.field, P.fgstars].join('|'); if (SKY.key === key) return SKY;
  var r = mulberry32(P.seed * 1013 + 71), bg = [], fg = [], fpool = [];
  ['whole', 'env', 'companions', 'arms'].forEach(function (k) { for (var i = 0; i < AT[k].n; i++) fpool.push([k, i]); });
  var nb = Math.min(6000, Math.round(P.field * 26 / 0.0145));
  for (var b = 0; b < nb; b++) { var u = unit3(r), R = Math.cbrt(RMIN * RMIN * RMIN + r() * (RMAX * RMAX * RMAX - RMIN * RMIN * RMIN));
    bg.push({ w: u.map(function (x) { return x * R; }), n: unit3(r), it: pick(r, fpool), rad: 1.4 + 3.2 * Math.pow(r(), 1.4), spin: r() * 6.28, na: 2 + (r() < 0.3 ? 1 : 0), seed: Math.floor(r() * 1e9), bulge: 0.15 + 0.35 * r() }); }
  var nf = Math.min(2500, Math.round(P.fgstars * 7 / 0.021));
  for (var f = 0; f < nf; f++) fg.push({ w: unit3(r).map(function (x) { return x * R_FG * (0.85 + 0.3 * r()); }), t: Math.floor(r() * AT.fgstars.n), size: 16 + 26 * r(), rot: (r() - 0.5) * 0.6 });
  SKY = { key: key, bg: bg, fg: fg }; return SKY;
}
function skyParts(L, r) {
  var sc = VIEW.scale, zf = sc / 84, cx = VIEW.cx, cy = VIEW.cy, massive = P.bulge > 0.5 || P.lensOn || P.merger || P.sersicN > 0, thE = 1.3 * sc, sky = buildSky();
  L.bg = L.bg || []; L.front = L.front || []; L.bgdots = L.bgdots || [];
  function onScreen(q, m) { return q[0] > -m && q[0] < VIEW.W + m && q[1] > -m && q[1] < VIEW.W + m; }
  if (P.field > 0.02) {
    var vis = [];
    sky.bg.forEach(function (o) { var v = toView(o.w); if (CAM - v[2] < 2) return; var k = CAM / (CAM - v[2]); if (k > 0.8) return;
      var q = toScreen(v, k); if (!onScreen(q, 120 * zf)) return; if (o.rad * k * sc > 140) return; vis.push([o, v, k, q]); });
    vis.sort(function (a, b) { return a[1][2] - b[1][2]; });                 // far to near
    vis.forEach(function (e) {
      var o = e[0], v = e[1], k = e[2], q = e[3], appR = o.rad * k * sc;         // apparent radius, px
      // 1. a real 3D galaxy: a disc with thickness and a bulge, in its own orientation, projected point by point
      var rr = mulberry32(o.seed), B = basis(o.n), np = Math.round(clamp(appR * 2.2, 10, 150));
      for (var j = 0; j < np; j++) {
        var lx, ly, lz;
        if (rr() < o.bulge) { var sq = Math.sqrt(Math.min(rr(), 0.97)), br = 0.18 * sq / (1 - sq), d3 = unit3(rr); lx = d3[0] * br; ly = d3[1] * br; lz = d3[2] * br * 0.8; }
        else { var R2 = -0.35 * Math.log(rr() * rr() + 1e-9), th = rr() * 6.28; if (rr() < 0.55) th = Math.log(R2 / 0.08 + 1) / 0.45 + Math.PI * Math.floor(rr() * 2) + gauss(rr) * 0.35; R2 = Math.min(R2, 1.6);
          lx = R2 * Math.cos(th); ly = R2 * Math.sin(th); lz = gauss(rr) * 0.05; }
        var wx = o.w[0] + o.rad * (lx * B[0][0] + ly * B[1][0] + lz * o.n[0]), wy = o.w[1] + o.rad * (lx * B[0][1] + ly * B[1][1] + lz * o.n[1]), wz = o.w[2] + o.rad * (lx * B[0][2] + ly * B[1][2] + lz * o.n[2]);
        var pv = toView([wx, wy, wz]), pk = CAM / (CAM - pv[2]), pq = toScreen(pv, pk), t = VAR.dotPool[Math.floor(rr() * VAR.dotPool.length)];
        inst(L.bgdots, 'dots', pq[0], pq[1], t, 1, simple(dotSprite(t, 0.62 * Math.max(0.6, Math.min(1.3, zf))), rr() * 6.28));
      }
      // 2. your drawing, laid on the same disc plane
      var M0 = orient(o.n, appR * 2.1, o.spin);
      if (massive) { var dx = q[0] - cx, dy = q[1] - cy, rf = Math.hypot(dx, dy) || 1, gam = Math.min(0.45, 0.35 * thE / rf), ph = Math.atan2(dy, dx) + Math.PI / 2; M0 = chain(Rm(ph), Sm(1 + gam, 1 - gam), Rm(-ph), M0); }
      if (o.it[0] === 'arms') { for (var a2 = 0; a2 < o.na; a2++) { var ra = [q[0], q[1], o.it[1], 1].concat(chain(M0, Rm(2 * Math.PI * a2 / o.na))); ra.push(0.42); L.bg.push({ k: 'arms', row: ra }); } }
      else { var rw = [q[0], q[1], o.it[1], 1].concat(M0); rw.push(0.42); L.bg.push({ k: o.it[0], row: rw }); }
      USED.add(AT[o.it[0]].src[o.it[1]]);
    });
  }
  if (P.fgstars > 0.02) sky.fg.forEach(function (o) {
    var v = toView(o.w); if (CAM - v[2] < 3) return;
    var k = CAM / (CAM - v[2]), q = toScreen(v, k); if (!onScreen(q, 40)) return;
    inst(L.fgstars, 'fgstars', q[0], q[1], o.t, 1, simple(o.size * Math.min(2.2, k / 0.42), o.rot));
  });
  if (P.companions > 0.05) { var rc = mulberry32(P.seed * 331 + 17);
    for (var c2 = 0; c2 < Math.round(1 + 3 * P.companions); c2++) {
      var u = unit3(rc), rad = 3.4 + 1.2 * rc(), w = [u[0] * rad, u[1] * rad, u[2] * rad * 0.7], nrm = unit3(rc), ti = Math.floor(rc() * AT.companions.n), s5 = sc * (0.8 + 0.8 * rc()), sp = rc() * 6.28;
      var v2 = toView(w), k2 = CAM / (CAM - v2[2]), q2 = toScreen(v2, k2);
      var row = [q2[0], q2[1], ti, 1].concat(orient(nrm, s5 * k2, sp, 0.35)); row.push(1);
      (v2[2] > 0 ? L.front : L.bg).push({ k: 'companions', row: row }); USED.add(AT.companions.src[ti]);   // in front of the galaxy, or behind it
    } }
}
/* dust clouds: along the inner edges of the arms (where real dust lanes sit), or an edge-on midplane */
var CLOUDS = { key: null, list: [] };
function dustClouds() {
  var key = [P.seed, P.dustScribble, P.arms, P.pitch, P.incl, P.az, P.pa, P.bulge, P.winding, P.bar, P.barLen, VIEW.scale, P.vary].join('|');
  if (CLOUDS.key === key) return CLOUDS.list;
  var out = [];
  if (P.dustScribble > 0.02 && P.bulge < 0.9 && !P.merger && !P.irr) {
    var r = mulberry32(P.seed * 733 + 29), edge = incE() > 74, n = Math.round((edge ? 3 : 5) + 9 * P.dustScribble);
    for (var i = 0; i < n; i++) {
      var c3, t3;
      if (edge) { var x = (r() * 2 - 1) * 2.6; c3 = [x, 0, gauss(r) * 0.03]; t3 = [1, 0, 0]; }
      else if (P.arms >= 1) { var k = i % P.arms, R = 0.6 + 1.9 * r(), th = armPhase(R, k) + 2 * Math.PI * k / P.arms - 0.15, th2 = armPhase(R + 0.05, k) + 2 * Math.PI * k / P.arms - 0.15;
        c3 = [R * Math.cos(th), R * Math.sin(th), 0]; t3 = [(R + 0.05) * Math.cos(th2) - c3[0], (R + 0.05) * Math.sin(th2) - c3[1], 0]; }
      else continue;
      var q = project(c3), q2 = project([c3[0] + t3[0] * 4, c3[1] + t3[1] * 4, c3[2] + t3[2] * 4]);
      out.push({ q: q, ang: Math.atan2(q2[1] - q[1], q2[0] - q[0]), rad: (8 + 14 * r()) * (VIEW.scale / 84), n: 3 + Math.floor(5 * r()), s: Math.floor(r() * 1e9) });
    }
  }
  CLOUDS = { key: key, list: out }; return out;
}
/* dust lanes, hatched: short strokes of your pen lines laid along the inner edge of each arm, patchy, with the odd feather;
   an edge-on galaxy gets a hatched lane along its midplane, thickest at the centre */
var LANES = { key: null, v: { strokes: [], pts: [] } };
function dustLanes() {
  var key = [P.seed, P.dustScribble, P.arms, P.pitch, P.incl, P.az, P.pa, P.bulge, P.winding, P.bar, P.barLen, VIEW.scale, P.vary, P.merger, P.irr, P.ring, P.ringR].join('|');
  if (LANES.key === key) return LANES.v;
  var strokes = [], pts = [], zf = VIEW.scale / 84;
  if ((P.dustScribble > 0.02 || P.ring > 0.1) && P.bulge < 0.9 && !P.merger && !P.irr) {
    var r = mulberry32(P.seed * 733 + 29), keep = 0.3 + 0.55 * Math.max(P.dustScribble, P.ring > 0.1 ? 0.5 : 0);
    if (incE() > 74) {
      for (var row = 0; row < 3; row++) { var zo = (row - 1) * 0.022;
        for (var x = -2.8; x <= 2.8; x += 0.055) {
          var dens = Math.exp(-Math.abs(x) / 1.5), n = vnoise(x * 1.9 + P.seed * 0.1, row * 3.1);
          var q = project([x, 0, zo]); if (row === 1) pts.push(q);
          if (n > keep * (0.4 + 0.8 * dens) || r() > 0.85) continue;
          var q2 = project([x + 0.1, 0, zo]);
          strokes.push([q[0], q[1] + gauss(r) * 1.2 * zf, Math.atan2(q2[1] - q[1], q2[0] - q[0]) + gauss(r) * 0.08, (10 + 9 * r()) * zf * (0.6 + 0.6 * dens)]);
        } }
    }
    if (P.ring > 0.1 && incE() <= 74) {                                  /* a hatched dust lane just inside the ring */
      for (var tr0 = 0; tr0 < 6.2832; tr0 += 0.07) { var Rr = P.ringR * 0.9, nr = vnoise(Math.cos(tr0) * 2.6 + 11, Math.sin(tr0) * 2.6 + P.seed * 0.01);
        var qr = project([Rr * Math.cos(tr0), Rr * Math.sin(tr0), 0]), qr2 = project([Rr * Math.cos(tr0 + 0.05), Rr * Math.sin(tr0 + 0.05), 0]);
        if (nr > keep * 1.05) continue; pts.push(qr); strokes.push([qr[0], qr[1], Math.atan2(qr2[1] - qr[1], qr2[0] - qr[0]) + gauss(r) * 0.08, (9 + 8 * r()) * zf]); }
    }
    if (incE() > 74) {} else if (P.arms >= 1) {
      for (var k = 0; k < P.arms; k++) {
        var a = VAR.arms[k % VAR.arms.length], Rend = a.rmax * 0.95, off = 2 * Math.PI * k / P.arms, prev = null;
        for (var R = 0.45; R <= Rend; R += 0.035 + 0.02 * R) {
          var th = armPhase(R, k) + off - (0.12 + 0.04 * Math.sin(R * 3 + k)), lx = VAR.lop * R * Math.cos(VAR.lopA) * 0.35, ly = VAR.lop * R * Math.sin(VAR.lopA) * 0.35;
          var P3 = [R * Math.cos(th) + lx, R * Math.sin(th) + ly, 0], q = project(P3);
          var th2 = armPhase(R + 0.05, k) + off - (0.12 + 0.04 * Math.sin((R + 0.05) * 3 + k)), q2 = project([(R + 0.05) * Math.cos(th2) + lx, (R + 0.05) * Math.sin(th2) + ly, 0]);
          var ang = Math.atan2(q2[1] - q[1], q2[0] - q[0]), n = vnoise(R * 2.1 + k * 5.3, P.seed * 0.01 + 7);
          if (n > keep) { prev = null; continue; }                                      // dust is patchy
          pts.push(q);
          var nx = -Math.sin(ang), ny = Math.cos(ang), jit = gauss(r) * 2.2 * zf;
          strokes.push([q[0] + nx * jit, q[1] + ny * jit, ang + gauss(r) * 0.07, (9 + 9 * r()) * zf]);
          if (r() < 0.14 * P.dustScribble) {                                             // a feather: a short wisp crossing outward
            var fa = ang + (r() < 0.5 ? 1 : -1) * (1.0 + 0.4 * r()), fl = (8 + 8 * r()) * zf;
            strokes.push([q[0] + Math.cos(fa) * fl * 0.45, q[1] + Math.sin(fa) * fl * 0.45, fa, fl]);
          }
        }
      }
    }
  }
  LANES = { key: key, v: { strokes: strokes, pts: pts } }; return LANES.v;
}
function parts(r) {
  var L = { env: [], whole: [], arms: [], bars: [], rings: [], cores: [], arcs: [], shells: [], companions: [], penlines: [], fgstars: [], trails: [], misc: [], sdots: [], sknots: [] };
  var sc = VIEW.scale, D = discM(), cx = VIEW.cx, cy = VIEW.cy;
  // envelopes: one halo or disc drawing behind everything
  if (P.envelope > 0.5) {
    var want = P.bulge >= 0.99 || P.arms === 0 ? 'halo' : (r() < 0.5 ? 'halo' : 'disc'), cand = [];
    AT.env.kind.forEach(function (k, i) { if (k === want) cand.push(i); }); if (!cand.length) cand = [0];
    var e = pick(r, cand), big = 2 * 3.6 * sc;
    var M = P.bulge >= 0.99 ? chain(Rm(paR()), Sm(1, Math.max(P.bulgeFlat, ci())), Sm(big, big)) : chain(D, Rm(r() * 6.28), Sm(big, big));
    inst(L.env, 'env', cx, cy, e, 1, M);
  }
  // one of your whole drawings, matched to the galaxy's type
  if (P.whole > 0.5) {
    var type = P.kind !== 'auto' ? P.kind : P.bulge >= 0.95 ? (P.bulgeFlat * Math.max(ci(), 0.05) < 0.5 || incE() > 70 && P.bulgeFlat < 0.6 ? 'smooth:elongated' : 'smooth') :
      incE() > 78 ? (P.dust > 0.3 ? 'edge-on:dust-lane' : P.bulge < 0.08 ? 'edge-on:thick' : 'edge-on') : P.flocc > 0.5 ? 'galaxy:flocculent' : P.bar > 0.3 ? 'galaxy:barred-spiral' : P.arms >= 1 ? 'galaxy:spiral' : 'smooth';
    var pool = []; AT.whole.type.forEach(function (t, i) { if (t === type || (type === 'merger' && (t === 'galaxy:merger'))) pool.push(i); });
    if (type === 'galaxy:spiral') AT.whole.type.forEach(function (t, i) { if (t === 'galaxy:spiral') pool.push(i); });
    if (!pool.length) AT.whole.type.forEach(function (t, i) { if (t.indexOf('galaxy') === 0) pool.push(i); });
    var wi = pick(r, pool), wt = AT.whole.type[wi], size = 2 * 3.3 * sc, Mw;
    if (wt.indexOf('edge-on') === 0 || wt === 'smooth:elongated') Mw = chain(Rm(paR()), Sm(size, size));
    else if (wt === 'smooth') Mw = chain(Rm(paR()), Sm(size, size * Math.max(P.bulgeFlat, ci())));
    else if (P.rewind && AT.whole.pitch[wi] && P.arms >= 1) {
      var wid = WARPS.push({ fn: rewindFn(AT.whole.pitch[wi], P.pitch, AT.whole.winding[wi] === 'Z') }) - 1;
      Mw = chain(D, Rm(r() * 6.28), Sm(size, size)); var rw = [cx, cy, wi, 1].concat(Mw); rw.push(1, wid); L.whole.push(rw); USED.add(AT.whole.src[wi]); Mw = null;
    }
    else Mw = chain(D, Sm(drawingFlip(AT.whole.winding[wi]) * MODEL_SIGN, 1), Rm(r() * 6.28), Sm(size, size));
    if (Mw) inst(L.whole, 'whole', cx, cy, wi, 1, Mw);
  }
  // your curved arms, copied round the centre
  if (P.armStyle === 'drawn' && P.arms >= 1 && P.bulge < 0.95) {
    var cls = P.pitch < 14 ? 'tight' : P.pitch < 26 ? 'medium' : 'loose', pool2 = [];
    AT.arms.meta.forEach(function (m, i) { if (m[0] === cls && m[2] === 'arm' && m[3]) pool2.push(i); });
    if (!pool2.length) AT.arms.meta.forEach(function (m, i) { if (m[2] === 'arm' && m[3]) pool2.push(i); });
    var ai = pick(r, pool2), asz = 2 * 2.6 * sc / 0.95;
    for (var k = 0; k < P.arms; k++) {
      var aj = r() < 0.5 ? ai : pick(r, pool2);
      inst(L.arms, 'arms', cx, cy, aj, 1, chain(D, Rm(2 * Math.PI * k / P.arms + 0.3), Sm(drawingFlip(AT.arms.meta[aj][1]) * MODEL_SIGN, 1), Sm(asz, asz)));
    }
  }
  if (P.bar > 0.1 && P.barStyle === 'drawn') { var bOk = []; AT.bars.solid.forEach(function (sd, i) { if (!sd) bOk.push(i); }); var bi = bOk.length ? pick(r, bOk) : 0, bs = 2 * P.barLen * sc / 0.92; inst(L.bars, 'bars', cx, cy, bi, 1, chain(D, Sm(bs, bs))); }
  if (P.ring > 0.1 && P.ringStyle === 'drawn') { var ri = Math.floor(r() * AT.rings.n), rs = 2 * P.ringR * sc * 1.04; inst(L.rings, 'rings', cx, cy, ri, 0.55, chain(D, Rm(r() * 6.28), Sm(rs, rs))); }   /* lighter: the ring reads as stars first */
  if (P.bulge > 0.03 && P.bulge < 0.97 && !(P.sersicN > 0 && P.bulge >= 0.95) && incE() < 80) {
    var n = AT.cores.kind.filter(function (k) { return k === 'core'; }).length, wantS = (P.stipple > 0.5 && P.lines < 0.5) || incE() > 70 ? 'dotted' : 'line';
    var idx = Math.min(n - 1, Math.floor(Math.pow(P.bulge, 0.6) * n)); for (var k2 = 0; k2 < n; k2++) { var j = (idx + k2) % n; if (AT.cores.style[j] === wantS) { idx = j; break; } }
    if (incE() > 78) { var sflat = chain(Rm(paR()), Sm(1, 0.55)); }
    var s = sc * (0.32 + 0.8 * P.bulgeSize * Math.sqrt(P.bulge));
    inst(L.cores, 'cores', cx, cy, idx, 0.9, chain(Rm(paR()), Sm(s, s * Math.max(P.bulgeFlat, ci()))));
    if (P.nuclear) { var nn = []; AT.cores.kind.forEach(function (k, i) { if (k === 'nuclear') nn.push(i); }); inst(L.cores, 'cores', cx, cy, pick(r, nn), 0.9, chain(D, Sm(s * 0.9, s * 0.9))); }
  }
  // oddities
  if (P.lens > 0.05) for (var li = 0; li < 1 + (P.lens > 0.6 ? 1 : 0); li++) { var s3 = 2 * (1.6 + 0.6 * r()) * sc * 1.2; inst(L.arcs, 'arcs', cx, cy, Math.floor(r() * AT.arcs.n), 1, chain(Rm(r() * 6.28), Sm(s3, s3))); }
  if (P.shells > 0.05) { var s4 = 2 * 2.8 * sc; inst(L.shells, 'shells', cx, cy, Math.floor(r() * AT.shells.n), 1, chain(Rm(r() * 6.28), Sm(s4, s4))); }
  if (P.tail > 0.05) { var ang2 = r() * 6.28, s6 = 1.3 * sc; inst(L.penlines, 'penlines', cx + Math.cos(ang2) * 3.6 * sc, cy + Math.sin(ang2) * 3.6 * sc, Math.floor(r() * AT.penlines.n), 1, simple(s6, ang2 + 0.4)); }
  if (P.trails > 0.02) {
    var ts = []; AT.trails.kind.forEach(function (k, i) { ts.push([k, i]); });
    var long = ts.filter(function (t) { return t[0] === 'trail'; }), cr = ts.filter(function (t) { return t[0] === 'trail:cosmic-ray'; });
    if (P.trails > 0.4 && long.length) inst(L.trails, 'trails', 400 + (r() - 0.5) * 300, 400 + (r() - 0.5) * 300, pick(r, long)[1], 1, simple(900, r() * 3.14));
    for (var q2 = 0; q2 < Math.round(P.trails * 3); q2++) if (cr.length) inst(L.trails, 'trails', 60 + r() * 680, 60 + r() * 680, pick(r, cr)[1], 1, simple(40 + 30 * r(), r() * 6.28));
  }
  skyParts(L, r);
  var rrL = mulberry32(P.seed * 919 + 3);
  dustLanes().strokes.forEach(function (st) {                 // each hatch: one of your pen lines, flattened and laid along the lane
    var ti = Math.floor(rrL() * AT.penlines.n), row = [st[0], st[1], ti, 1].concat(chain(Rm(st[2]), Sm(st[3], st[3] * 0.28))); row.push(0.38); L.penlines.push(row); USED.add(AT.penlines.src[ti]);
  });
  if (P.field > 0.02) {
    if (P.arrow > 0.02 && r() < 0.25 * P.field * (0.5 + P.arrow) && AT.misc) {        /* a stray arrow through the deep field: off unless asked for */ var ar = [60 + r() * 680, 60 + r() * 680, 1, 1].concat(simple(40 + 30 * r(), r() * 6.28)); ar.push(0.5); L.misc.push(ar); USED.add(AT.misc.src[1]); }
  }
  if (P.bubbles > 0.02 && VAR.clumps && (P.arms >= 1 || P.irr > 0) && !P.merger) {
    var cpool = []; AT.rings.kind.forEach(function (k, i) { if (k === 'curve') cpool.push(i); });
    VAR.clumps.forEach(function (cl, ci3) {
      if (r() > P.bubbles * 0.6) return;
      var k = ci3 % Math.max(1, P.arms), th0 = P.irr > 0 ? cl.t * 6.28 : armPhase(cl.R, k) + 2 * Math.PI * k / Math.max(1, P.arms), R0 = P.irr > 0 ? cl.R * 0.7 : cl.R;
      var pp = project([R0 * Math.cos(th0), R0 * Math.sin(th0), 0]), bs = Math.max(14, cl.s * 3.6 * sc), ri = pick(r, cpool);
      var rb = [pp[0], pp[1], ri, 1].concat(chain(D, Rm(r() * 6.28), Sm(bs, bs))); rb.push(0.6); L.rings.push(rb); USED.add(AT.rings.src[ri]);
    });
  }
  if (P.jet > 0.5 && AT.misc) {
    var ja = r() * 6.28, jl = (3.6 + 1.0 * r()) * sc;
    [1, -1].forEach(function (s2) { var len = s2 > 0 ? jl : jl * 0.65, jx = cx + Math.cos(ja) * s2 * len * 0.5, jy = cy + Math.sin(ja) * s2 * len * 0.5;
      var rj = [jx, jy, 0, 1].concat(chain(Rm(ja + (s2 < 0 ? Math.PI : 0)), Sm(len, len * 0.28))); rj.push(1.1); L.misc.push(rj); });
    USED.add(AT.misc.src[0]);
  }
  if (P.streams > 0.02) {
    var ns = 1 + (P.streams > 0.6 ? 1 : 0);
    for (var q3 = 0; q3 < ns; q3++) {
      var pi = Math.floor(r() * AT.penlines.n), fl = longestLine(AT.penlines.vec[pi]); if (!fl) continue; USED.add(AT.penlines.src[pi]);
      var lp = lineParam(fl), R0s = 2.0 + 1.2 * r(), span = 2.0 + 1.6 * r(), a0 = r() * 6.28, prev = null;
      lp.forEach(function (pt) {
        var ang = a0 + span * pt[0], Rr = R0s * (1 - 0.25 * pt[0]) + pt[1] * 0.35, X = cx + Rr * Math.cos(ang) * sc, Y = cy + Rr * Math.sin(ang) * sc;
        if (prev) { var dd = Math.hypot(X - prev[0], Y - prev[1]), nn = Math.max(1, Math.round(dd / 2.4));
          for (var m2 = 0; m2 < nn; m2++) { if (r() > 0.55 + 0.45 * P.streams) continue; var tt = VAR.dotPool[Math.floor(r() * VAR.dotPool.length)], fx2 = prev[0] + (X - prev[0]) * m2 / nn + gauss(r) * 1.4, fy2 = prev[1] + (Y - prev[1]) * m2 / nn + gauss(r) * 1.4;
            if (r() < 0.04) inst(L.sknots, 'knots', fx2, fy2, VAR.knotPool[Math.floor(r() * VAR.knotPool.length)], 1, simple((3 + 3 * r()) * PEN.dot, r() * 6.28));
            else inst(L.sdots, 'dots', fx2, fy2, tt, 1, simple(dotSprite(tt, 0.95), r() * 6.28)); } }
        prev = [X, Y];
      });
    }
  }
  return L;
}

/* ---------- WebGL ---------- */
var cv = $('gl'), gl = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: true });
if (!gl) { $('fallback').hidden = false; return; }
function shd(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
function prog(vs, fs) { var p = gl.createProgram(); gl.attachShader(p, shd(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shd(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
var FS = '#version 300 es\nprecision mediump float;in vec2 vUV;in float vA;uniform sampler2D uTex;uniform vec3 uInk;uniform float uGain;uniform vec2 uEdge;out vec4 o;void main(){float t=texture(uTex,vUV).a;float a=smoothstep(uEdge.x,uEdge.y,t)*vA*uGain;o=vec4(uInk*a,a);}';
var SPR = prog('#version 300 es\nlayout(location=0) in vec2 corner;layout(location=1) in vec4 i0;layout(location=2) in vec4 i1;uniform vec2 uRes;uniform vec2 uGrid;uniform vec2 uOff;out vec2 vUV;out float vA;' +
  'void main(){vec2 p=mat2(i1.x,i1.y,i1.z,i1.w)*corner+i0.xy+uOff;vec2 d=p/uRes*2.0-1.0;gl_Position=vec4(d.x,-d.y,0,1);' +
  'float col=mod(i0.z,uGrid.x),row=floor(i0.z/uGrid.x);vUV=(vec2(col,row)+corner+0.5)/uGrid;vA=i0.w;}', FS);
var RIB = prog('#version 300 es\nlayout(location=0) in vec2 pos;layout(location=1) in vec2 uv;layout(location=2) in float a;uniform vec2 uRes;uniform vec2 uOff;out vec2 vUV;out float vA;' +
  'void main(){vec2 d=(pos+uOff)/uRes*2.0-1.0;gl_Position=vec4(d.x,-d.y,0,1);vUV=uv;vA=a;}', FS);
var quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.5, -.5, .5, -.5, -.5, .5, .5, .5]), gl.STATIC_DRAW);
var TEX = {}, pending = 0, MAGNIFIED = { arms: 1, whole: 1, env: 1, rings: 1, bars: 1, arcs: 1, shells: 1, trails: 1, penlines: 1, companions: 1, misc: 1, sstars: 1 };
function loadTex(name, uri, repeatS) {
  pending++; var im = new Image();
  im.onload = function () { var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeatS ? gl.REPEAT : gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    TEX[name] = t; if (--pending === 0) render(); };
  im.src = uri;
}
Object.keys(AT).forEach(function (k) { if (AT[k].uri) loadTex(k, AT[k].uri, k === 'strokes'); });
(function () { var c = document.createElement('canvas'); c.width = c.height = 4; var x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 4, 4); loadTex('solid', c.toDataURL(), false); })();
var vao = gl.createVertexArray(), ibuf = gl.createBuffer(), rbuf = gl.createBuffer();
function drawSprites(atlas, rows, ink, off, gain) {
  if (REC && !off[0] && !off[1]) rows.forEach(function (rw) { REC.sprites.push([atlas, rw[0], rw[1], rw[2], rw[4], rw[5], rw[6], rw[7], REC.bg ? 1 : 0]); });
  if (!rows.length || !TEX[atlas]) return;
  var A = AT[atlas], d = new Float32Array(rows.length * 8);
  rows.forEach(function (s, k) { d.set(s, k * 8); });
  gl.useProgram(SPR); gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, ibuf); gl.bufferData(gl.ARRAY_BUFFER, d, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);
  gl.uniform2f(gl.getUniformLocation(SPR, 'uRes'), VIEW.W, VIEW.W); gl.uniform2f(gl.getUniformLocation(SPR, 'uGrid'), A.cols, Math.ceil(A.n / A.cols));
  gl.uniform2f(gl.getUniformLocation(SPR, 'uOff'), off[0], off[1]); gl.uniform3fv(gl.getUniformLocation(SPR, 'uInk'), ink); gl.uniform1f(gl.getUniformLocation(SPR, 'uGain'), gain);
  var E = MAGNIFIED[atlas] ? [0.46, 0.62] : [0.12, 0.55]; gl.uniform2f(gl.getUniformLocation(SPR, 'uEdge'), E[0], E[1]);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, TEX[atlas]); gl.uniform1i(gl.getUniformLocation(SPR, 'uTex'), 0);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, rows.length); gl.bindVertexArray(null);
}
function drawRibbons(V, ink, off, gain, texName) {
  if (!V.length) return;
  gl.useProgram(RIB);
  gl.bindBuffer(gl.ARRAY_BUFFER, rbuf); gl.bufferData(gl.ARRAY_BUFFER, V, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0); gl.vertexAttribDivisor(0, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 8); gl.vertexAttribDivisor(1, 0);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16); gl.vertexAttribDivisor(2, 0);
  gl.uniform2f(gl.getUniformLocation(RIB, 'uRes'), VIEW.W, VIEW.W); gl.uniform2f(gl.getUniformLocation(RIB, 'uOff'), off[0], off[1]);
  gl.uniform3fv(gl.getUniformLocation(RIB, 'uInk'), ink); gl.uniform1f(gl.getUniformLocation(RIB, 'uGain'), gain); gl.uniform2f(gl.getUniformLocation(RIB, 'uEdge'), 0.12, 0.55);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, TEX[texName || 'strokes']); gl.uniform1i(gl.getUniformLocation(RIB, 'uTex'), 0);
  gl.drawArrays(gl.TRIANGLES, 0, V.length / 5);
}
/* plates: printing inks (the Principia palette) */
var CYAN = [0.0, 0.55, 0.69], MAG = [0.81, 0.06, 0.40], YEL = [0.89, 0.77, 0.0], OLD = [0.62, 0.30, 0.08], YOUNG = [0.06, 0.35, 0.62], HII = [0.74, 0.07, 0.36];
/* the two themes: ink on cream paper, or cream ink on warm near-black; colour modes get lighter, warmer versions in the dark */
var PALETTES = {
  light: { ink: [0.114, 0.106, 0.098], disc: [0.25, 0.23, 0.2], old: [0.62, 0.30, 0.08], young: [0.06, 0.35, 0.62], hii: [0.74, 0.07, 0.36] },
  dark: { ink: [0.925, 0.894, 0.824], disc: [0.76, 0.72, 0.64], old: [0.90, 0.64, 0.38], young: [0.58, 0.78, 0.92], hii: [0.92, 0.56, 0.71] }
};
function applyTheme(t) {
  THEME = t; var pl = PALETTES[t]; INK = pl.ink; DISC_INK = pl.disc; OLD = pl.old; YOUNG = pl.young; HII = pl.hii;
  document.documentElement.setAttribute('data-theme', 'light'); var pl0 = document.querySelector('.plate'); if (pl0) pl0.dataset.surface = t === 'dark' ? 'chalk' : 'paper';   /* only the plate: paper, or a chalkboard */
  var b = document.getElementById('theme'); if (b) b.textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
  try { localStorage.setItem('foundry-theme', t); } catch (e) {}
}
applyTheme(THEME);
/* ---------- SVG for a pen plotter: every line a path, every dot a tiny circle, cores as nested rings; one layer per pen ---------- */
function exportSVG() {
  var keepPlates = P.plates; P.plates = 'ink';
  REC = { lines: [], sprites: [], layer: null, bg: false }; render(); var R = REC; REC = null; P.plates = keepPlates; render();
  var f = function (v) { return Math.round(v * 100) / 100; }, INKC = '#1d1b19';
  var layers = { background: [], drawings: [], arms: [], dust: [], cores: [], knots: [], dots: [], stars: [] };
  function inside(x, y) { return x > -20 && x < 820 && y > -20 && y < 820; }
  R.lines.forEach(function (ln) {
    var pts = ln.pts.filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); }); if (pts.length < 2 || !pts.some(function (p) { return inside(p[0], p[1]); })) return;
    (layers[ln.layer] || layers.drawings).push('<path d="M' + pts.map(function (p) { return f(p[0]) + ' ' + f(p[1]); }).join(' L') + '" stroke-width="' + f(ln.w) + '"/>');
  });
  function rays(x, y, a, ang, n, frac) { var d = ''; for (var k = 0; k < n; k++) { var t = ang + k * Math.PI / n * 2, L = a * (k % 2 && frac ? frac : 1); d += 'M' + f(x) + ' ' + f(y) + ' L' + f(x + Math.cos(t) * L) + ' ' + f(y + Math.sin(t) * L) + ' '; } return d; }
  R.sprites.forEach(function (sp) {
    var at = sp[0], x = sp[1], y = sp[2], t = sp[3], sx = Math.hypot(sp[4], sp[5]), sy = Math.hypot(sp[6], sp[7]), ang = Math.atan2(sp[5], sp[4]), bg = sp[8];
    if (!inside(x, y)) return;
    if (at === 'dots') { var rd = Math.max(0.35, sx * (AT.dots.size[t] || 8) / 80); (bg ? layers.background : layers.dots).push('<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(rd) + '" fill="' + INKC + '" stroke="none"/>'); }
    else if (at === 'pieces') layers.arms.push('<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(Math.max(0.35, sx * 0.14)) + '" fill="' + INKC + '" stroke="none"/>');
    else if (at === 'knots') layers.knots.push('<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(Math.max(0.5, sx * 0.24)) + '" fill="' + INKC + '" stroke="none"/>');
    else if (at === 'stars') layers.stars.push('<path d="' + rays(x, y, sx * 0.42, ang, 4, 0) + '" stroke-width="0.9"/>');
    else if (at === 'fgstars') layers.background.push('<path d="' + rays(x, y, sx * 0.46, ang, 8, 0.5) + '" stroke-width="0.9"/>');
    else if (at === 'cores') {                                          // a solid core, drawn as nested rings a pen can fill
      var rx = sx * 0.3, ry = sy * 0.3, g = '<g transform="translate(' + f(x) + ' ' + f(y) + ') rotate(' + f(ang * 180 / Math.PI) + ')">';
      for (var k = 1; k <= Math.ceil(Math.max(rx, ry) / 0.9); k++) { var fr = k * 0.9 / Math.max(rx, ry); g += '<ellipse rx="' + f(rx * fr) + '" ry="' + f(ry * fr) + '" stroke-width="0.9"/>'; }
      layers.cores.push(g + '</g>');
    }
  });
  var names = { background: 'background: deep field and foreground stars', drawings: 'hand-drawn parts', arms: 'arm strokes', dust: 'dust lanes', cores: 'cores', knots: 'knots', dots: 'dots', stars: 'drawn stars' };
  var out = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 800 800" width="200mm" height="200mm">',
    '<title>A galaxy, drawn by hand · Rosse · seed ' + P.seed + '</title>',
    '<g fill="none" stroke="' + INKC + '" stroke-linecap="round" stroke-linejoin="round">'];
  Object.keys(layers).forEach(function (k) { if (layers[k].length) out.push('<g id="' + k + '" inkscape:groupmode="layer" inkscape:label="' + names[k] + '">' + layers[k].join('') + '</g>'); });
  out.push('</g></svg>');
  return { svg: out.join('\n'), counts: Object.keys(layers).reduce(function (a, k) { a[k] = layers[k].length; return a; }, {}) };
}
var STATS = {};
function expandVector(k, row, VL, VD, VB) {
  var A = AT[k].vec[row[2]], x0 = row[0], y0 = row[1], M = [row[4], row[5], row[6], row[7]], sc = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]));
  var ps = row[8] || 1, WF = row[9] != null ? WARPS[row[9]] : null;
  if (WF && WF.screen) sc = WF.scale || sc;
  function tf(x, y) {
    if (WF && WF.post) { var w3 = WF.post(x0 + M[0] * x + M[2] * y, y0 + M[1] * x + M[3] * y); return SM(w3[0], w3[1]); }   /* a merging galaxy's mark, carried by the tides */
    if (WF) { var w2 = WF.fn(x, y); if (WF.screen) return SM(w2[0], w2[1]); x = w2[0]; y = w2[1]; }
    return SM(x0 + M[0] * x + M[2] * y, y0 + M[1] * x + M[3] * y);
  }
  var w = PEN.line / 2 * ps;
  A.l.forEach(function (fl) {
    var raw = []; for (var i = 0; i < fl.length; i += 2) raw.push([fl[i], fl[i + 1]]);
    if (WF) { var dens = [raw[0]]; for (var i3 = 1; i3 < raw.length; i3++) { var a0 = raw[i3 - 1], b0 = raw[i3], nseg = Math.max(1, Math.ceil(Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) / 0.012)); for (var s3 = 1; s3 <= nseg; s3++) dens.push([a0[0] + (b0[0] - a0[0]) * s3 / nseg, a0[1] + (b0[1] - a0[1]) * s3 / nseg]); } raw = dens; }
    var pts = raw.map(function (q) { return tf(q[0], q[1]); });
    if (REC) REC.lines.push({ pts: pts, w: Math.max(0.6, w * 2), layer: REC.layer || (k === 'sstars' ? 'stars' : k === 'penlines' ? 'dust' : 'drawings') });
    for (var j = 0; j < pts.length - 1; j++) {
      if (seam(pts[j], pts[j + 1])) continue;
      if (WF && Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1]) > 22) continue;
      if (WF && WF.post) { var r0a = raw[j], r0b = raw[j + 1], olv = Math.hypot(M[0] * (r0b[0] - r0a[0]) + M[2] * (r0b[1] - r0a[1]), M[1] * (r0b[0] - r0a[0]) + M[3] * (r0b[1] - r0a[1])) + 0.8, mlv = Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1]); if (mlv / olv > 1.8) continue; }
      var a = pts[j], b = pts[j + 1], tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1, nx = -ty / tl * w, ny = tx / tl * w;
      var ex = tx / tl * w * 0.9, ey = ty / tl * w * 0.9;       // a little overlap so the joins stay closed
      var q = [[a[0] - ex + nx, a[1] - ey + ny], [a[0] - ex - nx, a[1] - ey - ny], [b[0] + ex + nx, b[1] + ey + ny], [b[0] + ex - nx, b[1] + ey - ny]];
      [[0, 1, 2], [1, 3, 2]].forEach(function (tr) { tr.forEach(function (t) { VL.push(q[t][0], q[t][1], 0.5, 0.5, 1); }); });
    }
  });
  A.d.forEach(function (d) { var p = tf(d[0], d[1]), t = VAR.dotPool[(Math.abs(Math.round(d[0] * 997 + d[1] * 131)) >>> 0) % VAR.dotPool.length], sz = dotSprite(t, clamp(2 * d[2] * sc * 0.42 / 2.6, 0.8, 1.6) * Math.max(0.55, ps));
    VD.push([p[0], p[1], t, 1, sz, 0, 0, sz]); USED.add(AT.dots.src[t]); });
  A.b.forEach(function (b) { if (WF && WF.screen) return; var p = tf(b[0], b[1]), Mb = chain(M, Rm(b[4]), Sm(Math.max(2 * b[2] * 0.85, 3 / sc), Math.max(2 * b[3] * 0.85, 3 / sc))), t = VAR.knotPool[(Math.abs(Math.round(b[0] * 991)) >>> 0) % VAR.knotPool.length];
    VB.push([p[0], p[1], t, 1, Mb[0], Mb[1], Mb[2], Mb[3]]); });
}
function render() {
  if (pending) return;
  P.unwrap = 0;   /* the log-polar view is gone */
  if (window.__refreshCards) window.__refreshCards();
  var t0 = performance.now(), dpr = Math.min(2, window.devicePixelRatio || 1), sz = cv.clientWidth;
  cv.width = cv.height = Math.round(sz * dpr); gl.viewport(0, 0, cv.width, cv.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  VIEW.scale = 84 * ZOOM; USED = new Set(); WARPS = []; VAR = makeVariation(); PEN.line = P.pen; PEN.dot = 0.75 + 0.1 * P.pen;
  var S, C, V = [], PIE = [], L;
  if (P.subject === 'star' || P.subject === 'artefact') {       /* a star or an artefact, in the same deep field */
    S = starSprites(); C = []; buildCurves(C, V, PIE); L = parts(mulberry32(P.seed * 57 + 3)); ['env', 'whole', 'arms', 'bars', 'rings', 'cores', 'arcs', 'shells', 'companions', 'penlines'].forEach(function (k) { L[k] = []; });
  } else if (P.merger) {
    var MS = mergerSprites(); C = [];
    var keep = { seed: P.seed, fgstars: P.fgstars, trails: P.trails };
    L = parts(mulberry32(P.seed * 57 + 3)); ['env', 'whole', 'arms', 'bars', 'rings', 'cores', 'arcs', 'shells', 'companions', 'penlines'].forEach(function (k) { L[k] = []; });
    /* the tidal debris itself: a light scatter of the simulated stars, and the knots and stars flung into the tails */
    var rd0 = mulberry32(P.seed * 13 + 9); S = { old: [], disc: [], young: [], knots: MS.S.knots.slice(), stars: MS.S.stars.slice(), rstars: MS.S.rstars.slice() };
    ['disc', 'young'].forEach(function (k) { MS.S[k].forEach(function (row) { if (rd0() < 0.16) S[k].push(row); }); });
    S.knots = S.knots.filter(function () { return rd0() < 0.6; }); S.rstars = S.rstars.filter(function () { return rd0() < 0.5; });
    /* each galaxy built exactly as a single galaxy is — arms, bulge, bar, knots, dust, your drawings — then carried by the tides */
    var S0m = simulateMerger(), mainP = P, mainVAR = VAR, mainScale = VIEW.scale, mainSM = SM;
    [0, 1].forEach(function (g) {
      var RM = S0m.RMAX ? S0m.RMAX[g] : 1.7, s0 = MS.sc * RM / 4.2, tfn0 = MS.tidal(g, false), R2 = 2 * 4.2 * s0, GNm = 48, GX2 = new Float32Array((GNm + 1) * (GNm + 1) * 2);
      for (var gy2 = 0; gy2 <= GNm; gy2++) for (var gx2 = 0; gx2 <= GNm; gx2++) { var wq = tfn0(gx2 / GNm - 0.5, gy2 / GNm - 0.5), o2 = (gy2 * (GNm + 1) + gx2) * 2; GX2[o2] = wq[0]; GX2[o2 + 1] = wq[1]; }   /* the tides, sampled once */
      var tfn = function (u, v) { var fx = clamp((u + 0.5) * GNm, 0, GNm - 1e-6), fy = clamp((v + 0.5) * GNm, 0, GNm - 1e-6), ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy, o = (iy * (GNm + 1) + ix) * 2, o3 = o + (GNm + 1) * 2;
        return [(GX2[o] * (1 - ax) + GX2[o + 2] * ax) * (1 - ay) + (GX2[o3] * (1 - ax) + GX2[o3 + 2] * ax) * ay, (GX2[o + 1] * (1 - ax) + GX2[o + 3] * ax) * (1 - ay) + (GX2[o3 + 1] * (1 - ax) + GX2[o3 + 3] * ax) * ay]; };
      P = Object.assign({}, mainP, mergerGalaxyParams(g, S0m)); VIEW.scale = s0; VAR = makeVariation();
      var post = function (x, y) { return tfn((x - VIEW.cx) / R2, (y - VIEW.cy) / R2); };
      SM = function (x, y) { var w = post(x, y); return mainSM(w[0], w[1]); };
      var wid = WARPS.push({ post: post }) - 1;
      SEAMMAX = 30; var Sg = generate(), Cg = curves(mulberry32(P.seed * 31 + 5)); buildCurves(Cg, V, PIE);
      var Lg = parts(mulberry32(P.seed * 57 + 3));
      ['old', 'disc', 'young', 'knots', 'stars'].forEach(function (k) { (Sg[k] || []).forEach(function (row) { S[k].push(row); }); });
      (Sg.rstars || []).forEach(function (row) { if (row[8] == null) row[8] = 0.5; var wq = post(row[0], row[1]); row[0] = wq[0]; row[1] = wq[1]; S.rstars.push(row); });   /* a star moves with the tides but keeps its shape: it's a point of light */
      Object.keys(Lg).forEach(function (k) { if (!Array.isArray(Lg[k]) || k === 'bg' || k === 'front' || k === 'bgdots') return; L[k] = L[k] || [];
        Lg[k].forEach(function (row) { if (AT[k] && AT[k].vec) { if (row[8] == null) row[8] = 1; row[9] = wid; } L[k].push(row); }); });
      P = mainP; VAR = mainVAR; VIEW.scale = mainScale; SM = mainSM; SEAMMAX = 0;
    });
    var nCore = AT.cores.kind.filter(function (k) { return k === 'core'; }).length, rc = mulberry32(P.seed * 5 + 1);
    /* merging galaxies keep only their simulated bulge stars: no drawn core */
    if (P.mWarp) {
      var rw2 = mulberry32(P.seed * 211 + 7), wpool = []; AT.whole.type.forEach(function (t, i) { if (t === 'galaxy:spiral' || t === 'galaxy:barred-spiral' || t === 'galaxy:flocculent') wpool.push(i); });
      [0, 1].forEach(function (g) { var wi2 = pick(rw2, wpool), wid2 = WARPS.push({ screen: true, fn: MS.tidal(g, AT.whole.winding[wi2] === 'S'), scale: MS.scale }) - 1;
        var rr2 = [0, 0, wi2, 1, 1, 0, 0, 1]; rr2.push(g === 0 ? 0.9 : 0.75, wid2); L.whole.push(rr2); USED.add(AT.whole.src[wi2]); });
    }
    LENSWL = null; if (P.lensOn) { lensSprites10(S, V, PIE); if (LENSQ) { LENSQ.forEach(function (o) { (L[o.key] = L[o.key] || []).push(o.row); }); LENSQ = null; } }   /* a merging pair can lens a galaxy behind it */
    if (P.shellsOn) { shellSprites(S); buildCurves(shellArcs(), V, PIE); }
  } else {
    S = generate(); var r = mulberry32(P.seed * 31 + 5); C = curves(r);
    LENSWL = null; if (P.lensOn) lensSprites10(S, V, PIE); if (P.shellsOn) { shellSprites(S); if (P.lines > 0 || true) C = C.concat(shellArcs()); }
    buildCurves(C, V, PIE);
    L = parts(mulberry32(P.seed * 57 + 3));
    if (LENSQ) { LENSQ.forEach(function (o) { (L[o.key] = L[o.key] || []).push(o.row); }); LENSQ = null; }
    if (LENSWL) { var WM = LENSWL, Uw = VIEW.scale, paw = paR(), cw2 = Math.cos(paw), sw2 = Math.sin(paw);      /* weak lensing: the deep field stretched tangentially round the cluster */
      (L.bg || []).forEach(function (o) { if (!AT[o.k] || !AT[o.k].vec) return; var row = o.row, X = row[0], Y = row[1], dx = (X - VIEW.cx) / Uw, dy = (Y - VIEW.cy) / Uw, x = dx * cw2 + dy * sw2, y = -dx * sw2 + dy * cw2, h = 0.01;
        var a0 = WM.alpha(x, y), axx = (WM.alpha(x + h, y)[0] - a0[0]) / h, axy = (WM.alpha(x, y + h)[0] - a0[0]) / h, ayx = (WM.alpha(x + h, y)[1] - a0[1]) / h, ayy = (WM.alpha(x, y + h)[1] - a0[1]) / h;
        var A11 = 1 - axx, A12 = -axy, A21 = -ayx, A22 = 1 - ayy, det = A11 * A22 - A12 * A21; if (Math.abs(det) < 0.25) return; var M11 = A22 / det, M12 = -A12 / det, M21 = -A21 / det, M22 = A11 / det;
        var S11 = cw2 * (M11 * cw2 - M12 * sw2) - sw2 * (M21 * cw2 - M22 * sw2), S12 = cw2 * (M11 * sw2 + M12 * cw2) - sw2 * (M21 * sw2 + M22 * cw2), S21 = sw2 * (M11 * cw2 - M12 * sw2) + cw2 * (M21 * cw2 - M22 * sw2), S22 = sw2 * (M11 * sw2 + M12 * cw2) + cw2 * (M21 * sw2 + M22 * cw2);
        var wid = WARPS.push({ post: function (Xs, Ys) { var ex = Xs - X, ey = Ys - Y; return [X + S11 * ex + S12 * ey, Y + S21 * ex + S22 * ey]; } }) - 1; if (row[8] == null) row[8] = 1; row[9] = wid; }); }
  }
  if (S) overlaySprites(S);   /* the field's own stars and artefacts, over any subject */
  V = new Float32Array(V);
  var VLbg = [], VDbg = [], VBbg = [], VLf = [], VDf = [], VBf = [];
  if (REC) REC.layer = 'background'; (L.bg || []).forEach(function (o) { expandVector(o.k, o.row, VLbg, VDbg, VBbg); }); if (REC) REC.layer = null; (L.front || []).forEach(function (o) { expandVector(o.k, o.row, VLf, VDf, VBf); });
  VLbg = new Float32Array(VLbg); VLf = new Float32Array(VLf);
  L.sstars = (S.rstars || []);
  var VLa = [], VD = [], VB = [];
  Object.keys(MAGNIFIED).forEach(function (k) { if (AT[k] && AT[k].vec) { (L[k] || []).forEach(function (row) { expandVector(k, row, VLa, VD, VB); }); L[k] = []; } });
  VLa = new Float32Array(VLa);
  function scene(inkOf, off, gain) {
    if (REC) REC.bg = true; drawSprites('dots', L.bgdots || [], inkOf('line'), off, gain); if (REC) REC.bg = false; drawRibbons(VLbg, inkOf('line'), off, gain, 'solid'); drawSprites('dots', VDbg, inkOf('line'), off, gain); drawSprites('knots', VBbg, inkOf('line'), off, gain);
    drawSprites('env', L.env, inkOf('line'), off, gain); drawSprites('whole', L.whole, inkOf('line'), off, gain);
    drawSprites('shells', L.shells, inkOf('line'), off, gain);
    drawRibbons(V, inkOf('line'), off, gain); drawRibbons(VLa, inkOf('line'), off, gain, 'solid'); drawSprites('dots', VD, inkOf('line'), off, gain); drawSprites('knots', VB, inkOf('line'), off, gain);
    drawSprites('pieces', PIE, inkOf('young'), off, gain);
    drawSprites('dots', S.old, inkOf('old'), off, gain); drawSprites('dots', S.disc, inkOf('disc'), off, gain); drawSprites('dots', S.young, inkOf('young'), off, gain); drawSprites('dots', L.sdots || [], inkOf('old'), off, gain); drawSprites('knots', L.sknots || [], inkOf('old'), off, gain);
    drawSprites('knots', S.knots, inkOf('hii'), off, gain); drawSprites('stars', S.stars, inkOf('young'), off, gain);
    drawSprites('bars', L.bars, inkOf('old'), off, gain); drawSprites('rings', L.rings, inkOf('line'), off, gain); drawSprites('cores', L.cores, inkOf('old'), off, gain);
    drawSprites('arcs', L.arcs, inkOf('young'), off, gain); drawSprites('companions', L.companions, inkOf('line'), off, gain); drawSprites('penlines', L.penlines, inkOf('line'), off, gain);
    drawRibbons(VLf, inkOf('line'), off, gain, 'solid'); drawSprites('dots', VDf, inkOf('line'), off, gain); drawSprites('knots', VBf, inkOf('line'), off, gain);
    drawSprites('fgstars', L.fgstars, inkOf('star'), off, gain); drawSprites('trails', L.trails, inkOf('line'), off, gain);
  }
  if (P.plates === 'slip') {                      // three process plates, each slipped a little, then the key ink
    scene(function () { return CYAN; }, [-3.6, -1.2], 0.32); scene(function () { return MAG; }, [3.4, 1.0], 0.3); scene(function () { return YEL; }, [0.6, 3.8], 0.42);
    scene(function () { return INK; }, [0, 0], 1);
  } else if (P.plates === 'colour') {
    scene(function (pop) { return pop === 'old' ? OLD : pop === 'young' ? YOUNG : pop === 'hii' ? HII : pop === 'star' ? INK : pop === 'disc' ? DISC_INK : INK; }, [0, 0], 1);
  } else scene(function () { return INK; }, [0, 0], 1);
  STATS = { rstars: (S.rstars || []).length, dots: S.old.length + S.disc.length + S.young.length, knots: S.knots.length, stars: S.stars.length, curves: C.length, used: USED.size, ms: Math.round(performance.now() - t0) };
  $('stats').textContent = STATS.dots.toLocaleString('en-GB') + ' dots · ' + STATS.knots + ' knots · ' + STATS.stars + ' stars · drawn in ' + STATS.ms + ' ms';
  $('used').textContent = STATS.used + ' of the ' + TOTAL_DRAWINGS + ' drawings are in this galaxy';
  var fr0 = document.getElementById('factrow'); if (fr0) fr0.innerHTML = [['dots', STATS.dots.toLocaleString('en-GB')], ['knots', STATS.knots.toLocaleString('en-GB')], ['stars', STATS.stars.toLocaleString('en-GB')], ['drawings used', STATS.used + ' of ' + TOTAL_DRAWINGS], ['drawn in', STATS.ms >= 1000 ? (STATS.ms / 1000).toFixed(1) + ' s' : STATS.ms + ' ms']].map(function (f) { return '<span class="fact"><b>' + f[0] + '</b><span>' + f[1] + '</span></span>'; }).join('');   /* the facts row */
  var un = document.getElementById('unwrapnote'); if (un) un.style.display = P.unwrap ? 'flex' : 'none';
  var pb = document.getElementById('play'); if (pb) pb.style.display = (P.merger || (P.lensOn && P.lensSource === 'quasar')) ? '' : 'none';
  if (typeof tlUpdate === 'function') tlUpdate();
}
var raf = 0; function req() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; render(); }); }
new ResizeObserver(req).observe(cv);

/* ---------- real galaxies: parameters from the volunteers' votes and the photo ---------- */
function fromReal(g) { return fromVotes(g.votes, g.q, g.pa, Math.abs(g.wind) > 0.06 ? Math.sign(g.wind) : 0, parseInt(g.id.slice(-6), 10) % 9973 + 1, g.ex || null); }
function fromVotes(v, qIn, paIn, windSign, seed, ex) {
  var q = clamp(qIn, 0.1, 1), p = Object.assign({}, DEF), rr = mulberry32(seed * 101 + 9);
  p.seed = seed; p.pa = Math.round(paIn); p.vary = 0.45 + 0.4 * rr(); p.pen = 2.0 + 0.8 * rr();
  p.winding = windSign ? (windSign === MODEL_SIGN ? 1 : -1) : (seed % 2 ? 1 : -1);
  p.stroke = ['mixed', 'mixed', 'plain', 'beaded', 'spurred', 'broken'][Math.floor(rr() * 6)]; p.armStyle = 'ribbons'; p.whole = 0;
  var cB = ex && ex.conc ? clamp((ex.conc - 2.15) / 1.2, 0, 1) : 0.4, red = ex && ex.gr ? clamp((ex.gr - 0.55) / 0.4, 0, 1) : 0.5, detail = ex && ex.r90 ? clamp((ex.r90 - 4) / 8, 0.15, 1) : 0.7, fdev = ex && ex.fdev != null ? ex.fdev : 0.4;
  p.field = 0.15 + 0.45 * rr(); p.bubbles = 0.2 + 0.6 * (1 - red); p.rewind = 1;
  p.knots = 0.06 + 0.6 * (1 - red); p.sparkle = 0.04 + 0.45 * (1 - red); p.stars = Math.round(6000 + 6000 * detail); p.lines = detail > 0.35 ? 0.8 : 0; p.fgstars = 0.15 + 0.3 * rr();
  var odd = v.odd > 0.5 ? ['ring', 'lens', 'disturbed', 'irregular', 'other', 'merger', 'dust'].reduce(function (b, k) { return v[k] > (v[b] || 0) ? k : b; }, 'ring') : null;
  if (v.star > v.smooth && v.star > v.feat) {                                  /* volunteers said star or artefact: draw one */
    return Object.assign(p, { subject: rr() < 0.7 ? 'star' : 'artefact', artefact: ['trail', 'ghost', 'cosmic'][Math.floor(rr() * 3)], starBright: 0.45 + 0.5 * rr(), spikes: 0.4 + 0.6 * rr(), starRings: 0.5 * rr(), bleed: rr() < 0.5 ? 0.3 + 0.5 * rr() : 0 });
  }
  if (v.smooth >= v.feat && v.smooth >= v.star) {
    var Cc = ex && ex.conc ? ex.conc : 2.9, smoothDust = v.odd > 0.5 && v.dust > 0.4 ? 0.8 : 0;
    Object.assign(p, { arms: 0, bulge: 1, bulgeSize: 1.5, bulgeFlat: Math.max(q, 0.22), incl: 88, halo: 0.12, knots: 0, sparkle: 0, lines: 0, envelope: 0, stars: p.stars + 4000,
      sersicN: clamp(1 + (Cc - 2.1) * 2.6, 1, 4.5), re: clamp(2.3 / Cc, 0.55, 1.2), dust: smoothDust });
    p.stars = Math.round(p.stars * (0.45 + 0.55 * clamp(q, 0.2, 1)));
    p.stars = Math.round(p.stars * (0.5 + 0.5 * Math.max(q, 0.22)));
  } else if (v.edge > 0.5) {
    var bs = v.bround + v.bboxy + v.bnone || 1;
    var qe = Math.sqrt(Math.max(0, (q * q - 0.12 * 0.12) / (1 - 0.12 * 0.12))), ie = Math.round(Math.acos(clamp(qe, 0, 1)) * 180 / Math.PI);
    Object.assign(p, { incl: Math.max(84, ie), thick: clamp(0.17 * q, 0.028, 0.09), bulge: 0.6 * (0.35 * v.bround + 0.28 * v.bboxy + 0.04 * v.bnone) / bs + 0.25 * cB, bulgeSize: 0.6 + 0.8 * cB, dust: v.dust > 0.3 ? 0.8 : 0.25 + 0.4 * (1 - red), arms: 2, lines: detail > 0.35 ? 0.5 : 0, stroke: 'plain' });
  } else {
    var q0 = 0.15, c = Math.sqrt(Math.max(0, (q * q - q0 * q0) / (1 - q0 * q0)));
    p.incl = Math.round(Math.acos(clamp(c, 0, 1)) * 180 / Math.PI);
    var bsum = v.b0 + v.b1 + v.b2 + v.b3 || 1, vb = (0.03 * v.b0 + 0.12 * v.b1 + 0.28 * v.b2 + 0.5 * v.b3) / bsum;
    p.bulge = clamp(0.55 * vb + 0.3 * cB * 0.55 + 0.15 * fdev * 0.5, 0.02, 0.75); p.bulgeSize = 0.45 + 0.9 * cB; p.armStrength = 0.55 + 0.35 * v.spiral;
    p.bar = v.bar > 0.5 ? 0.5 + 0.5 * v.bar : 0; p.barLen = 0.45;
    if (v.spiral > 0.5) {
      var ac = [[1, v.a1], [2, v.a2], [3, v.a3], [4, v.a4], [6, v.amore], ['cant', v.acant]].sort(function (a, b) { return b[1] - a[1]; })[0][0];
      if (ac === 'cant') { p.arms = 3; p.flocc = 0.75; p.stroke = 'broken'; } else p.arms = ac;
      var ws = v.tight + v.medium + v.loose || 1; p.pitch = Math.round((12 * v.tight + 22 * v.medium + 36 * v.loose) / ws);
    } else { p.arms = 0; p.outline = 1; p.envelope = 0; p.knots *= 0.3; }
  }
  if (odd === 'ring') { p.ringOnlyLines = 1; p.ring = 0.85; p.ringR = 1.5; p.ringStyle = 'ribbon'; p.stroke = 'faint'; p.armStrength = Math.min(p.armStrength, 0.45); p.outline = 0; if (p.bar > 0) p.bar = Math.max(p.bar, 0.8); }
  if (odd === 'merger' && v.merger > 0.5) {
    p.merger = 1; p.incl = Math.round(rr() * 70); p.mSpin1 = rr() * 70; p.mSpin2 = rr() * 180;
    if (red > 0.6) { p.mRatio = 0.6 + 0.4 * rr(); p.mPeri = 0.6 + 0.6 * rr(); p.mStage = 0.1 + 0.8 * rr(); p.mBulge = 0.8; p.mFriction = 0.5; p.mType1 = rr() < 0.6 ? 'elliptical' : 'lenticular'; p.mType2 = rr() < 0.5 ? 'elliptical' : 'lenticular'; }      // a dry merger: two red, bulge-heavy galaxies close together
    else { p.mRatio = 0.35 + 0.65 * rr(); p.mPeri = 0.8 + 1.2 * rr(); p.mStage = 0.35 + 1.9 * rr(); p.mBulge = 0.15 + 0.3 * cB; p.mFriction = rr() < 0.25 ? 0.6 : 0; p.mType1 = rr() < 0.8 ? 'spiral' : 'lenticular'; p.mType2 = rr() < 0.7 ? 'spiral' : (rr() < 0.5 ? 'lenticular' : 'elliptical'); }
    p.mArms1 = 1 + Math.floor(rr() * 4); p.mArms2 = 1 + Math.floor(rr() * 4); p.mSize1 = 0.8 + 0.5 * rr(); p.mSize2 = 0.7 + 0.6 * rr(); p.mTilt = rr() < 0.5 ? rr() * 25 : rr() * 90; p.mEcc = 0.85 + 0.3 * rr(); p.mBar1 = rr() < 0.25 ? 1 : 0;
  }
  if (odd === 'disturbed') p.tail = 0.6;
  if ((odd === 'irregular' && v.irregular > 0.5) || (ex && ex.gr != null && ex.gr < 0.6 && cB < 0.25 && v.spiral < 0.55 && v.edge < 0.4 && v.smooth < v.feat)) { p.irr = 1; p.arms = 0; p.lines = 0; p.bulge = Math.min(p.bulge, 0.05); p.knots = 0.8; p.outline = 0; p.vary = 1; }
  if (odd === 'lens' && v.lens > 0.5) Object.assign(p, { lensOn: 1, lensR: 1.1 + 0.6 * rr(), lensSrc: rr() < 0.25 ? 0.02 * rr() : 0.08 + 0.35 * rr(), lensSrcA: rr() * 360, lensShear: 0.02 + 0.14 * rr(), lensShearA: rr() * 180, lensSize: 0.08 + 0.3 * rr() });
  if ((odd === 'disturbed' || odd === 'other') && v.smooth >= v.feat && red > 0.5 && rr() < 0.6) Object.assign(p, { shellsOn: 1, shellTime: 45 + 60 * rr(), shellAxis: rr() * 180, stars: Math.round(p.stars * 0.6) });
  if (odd === 'dust' && v.dust > 0.5) p.dust = Math.max(p.dust, 0.7);
  if (p.arms >= 1 && !p.irr) { p.dustLines = v.dust > 0.3 || rr() < 0.35 ? 0.4 + 0.5 * rr() : 0; if (rr() < 0.18) p.whole = 1; }
  if (p.incl > 80 && p.bulge < 0.95) p.dustLines = 0.3 + 0.6 * (1 - red) * rr();
  if (p.bulge >= 0.95) { if (rr() < 0.1 || ((odd === 'disturbed' || odd === 'other') && red > 0.5)) p.streams = 0.6 + 0.4 * rr(); if (red > 0.7 && rr() < 0.04) p.jet = 1; }
  /* layers: every odd feature with a real share switches on its own layer; a real star-or-artefact share adds an overlay */
  if (!p.subject || p.subject === 'galaxy') {
    var oddOn = v.odd > 0.3 ? ['ring', 'lens', 'disturbed', 'irregular', 'dust'].filter(function (k) { return k !== odd && v[k] >= 0.3; }) : [];
    oddOn.forEach(function (k) {
      if (k === 'ring') { p.ring = Math.max(p.ring || 0, 0.55); if (!p.ringR) p.ringR = 1.6; }
      else if (k === 'lens' && !p.lensOn) Object.assign(p, { lensOn: 1, lensR: 1.2 + 0.5 * rr(), lensSrc: 0.1 + 0.3 * rr(), lensSrcA: rr() * 360, lensSize: 0.12 + 0.06 * rr(), lensQ: 0.7 + 0.25 * rr() });
      else if (k === 'disturbed') p.tail = Math.max(p.tail || 0, 0.45);
      else if (k === 'irregular') p.flocc = Math.max(p.flocc || 0, 0.45);
      else if (k === 'dust') { p.dust = Math.max(p.dust || 0, 0.6); p.dustLines = Math.max(p.dustLines || 0, 0.5); }
    });
    if (v.star >= 0.12) { p.ovStar = clamp(0.3 + 0.9 * v.star, 0.3, 0.95); p.ovStarD = 1.3 + 1.1 * rr(); p.ovStarA = rr() * 360; if (v.star >= 0.25 && rr() < 0.3) p.ovArtefact = ['trail', 'ghost', 'cosmic'][Math.floor(rr() * 3)]; }
  }
  return { p: p, odd: odd };
}
function describe(g, res) {
  var v = g.votes, bits = [];
  if (v.smooth >= v.feat) bits.push(Math.round(v.smooth * 100) + '% smooth');
  else { bits.push(Math.round(v.feat * 100) + '% features or disc');
    if (v.edge > 0.5) bits.push('edge-on'); else { if (v.bar > 0.5) bits.push(Math.round(v.bar * 100) + '% barred'); if (v.spiral > 0.5) bits.push(res.p.arms === 3 && res.p.flocc > 0.5 ? 'arms uncountable' : res.p.arms + (res.p.arms === 1 ? ' arm' : ' arms')); } }
  if (res.odd) bits.push('odd: ' + res.odd);
  return (g.n >= 255 ? '255+' : g.n) + ' volunteers: ' + bits.join(', ') + '. Axis ratio ' + g.q.toFixed(2) + ', angle ' + Math.round(g.pa) + '° measured from the photo' + (Math.abs(g.wind) > 0.06 ? '; winds ' + (g.wind > 0 ? 'S' : 'Z') + '-wise' : '') + '.';
}
function shortType(p, odd) {                       /* a few words for what Rosse drew: written on the real galaxy's print */
  var n = Math.round(p.arms || 0), num = ['', 'one', 'two', 'three', 'four', 'five', 'six'][n] || String(n), t;
  if (p.subject === 'star') t = 'a star'; else if (p.subject === 'artefact') t = 'an artefact';
  else if (p.merger) t = 'two galaxies merging';
  else if (n < 1 && (p.bulge || 0) >= 0.9) t = (p.bulgeFlat || 1) < 0.55 ? 'a cigar-shaped elliptical' : 'a round elliptical';
  else if ((p.incl || 0) > 80) t = 'an edge-on disc';
  else if (n < 1) t = 'a disc, no arms';
  else t = ((p.bar || 0) > 0.35 ? 'a barred spiral' : 'a spiral') + ', ' + num + ' arm' + (n > 1 ? 's' : '');
  var extra = odd === 'ring' || (p.ring || 0) > 0.3 ? 'with a ring' : odd === 'lens' || p.lensOn ? 'lensed' : odd === 'dust' || (p.dustLines || 0) > 0.45 ? 'with a dust lane' : odd === 'disturbed' ? 'disturbed' : odd === 'irregular' ? 'irregular' : '';
  return extra ? t + ', ' + extra : t;
}
function showReal(i) {
  REALSEL = i; var g = REAL[i], res = fromReal(g); P = res.p; sync(); req();
  $('inset').hidden = false; $('insetimg').src = g.photo; $('insetcap').textContent = shortType(res.p, res.odd);   /* what it is, written on the print */
  $('realcap').textContent = describe(g, res);
  document.querySelectorAll('.rg').forEach(function (b, k) { b.classList.toggle('on', k === i); });
}
function clearReal() { REALSEL = null; $('inset').hidden = true; $('realcap').textContent = ''; document.querySelectorAll('.rg').forEach(function (b) { b.classList.remove('on'); }); }

/* ---------- controls ---------- */
var GROUPS = [
  ['Shape', [['bulge', 'Bulge fraction', 0, 1, 0.01], ['bulgeSize', 'Bulge size', 0.2, 1.4, 0.01], ['bulgeFlat', 'Bulge roundness', 0.3, 1, 0.01], ['thick', 'Disc thickness', 0.02, 0.3, 0.005], ['halo', 'Halo stars', 0, 1, 0.01]]],
  ['Arms', [['arms', 'Number of arms', 0, 6, 1], ['pitch', 'Pitch angle', 5, 45, 0.5, '°'], ['armStrength', 'Arm contrast', 0, 1, 0.01], ['armWidth', 'Arm width', 0.12, 0.8, 0.01], ['flocc', 'Flocculence', 0, 1, 0.01]],
    ['armStyle', 'Arms drawn as', [['ribbons', 'straight strokes, bent'], ['drawn', 'drawn curved arms'], ['none', 'stars only']]]],
  ['Bar and ring', [['bar', 'Bar strength', 0, 1, 0.01], ['barLen', 'Bar length', 0.2, 0.9, 0.01], ['ring', 'Ring', 0, 1, 0.01], ['ringR', 'Ring radius', 0.8, 2.8, 0.01]],
    ['barStyle', 'Bar', [['drawn', 'a drawn bar'], ['ribbon', 'a stroke']]], ['ringStyle', 'Ring', [['drawn', 'a drawn ring'], ['ribbon', 'a stroke']]]],
  ['Star or artefact', [['starBright', 'Brightness', 0, 1, 0.01], ['spikes', 'Diffraction spikes', 0, 1, 0.01], ['starRings', 'Rings in the glare', 0, 1, 0.01], ['bleed', 'Bleed column', 0, 1, 0.01]], ['subject', 'Draw', [['galaxy', 'a galaxy'], ['star', 'a star'], ['artefact', 'an artefact']]], ['artefact', 'Artefact', [['trail', 'satellite trail'], ['ghost', 'ghost reflection'], ['cosmic', 'cosmic rays']]]],
['In the field', [['ovStar', 'A bright foreground star', 0, 1, 0.01], ['ovStarD', 'Its distance from the galaxy', 0, 3, 0.05], ['ovStarA', 'Its direction', 0, 360, 1, '°']], ['ovArtefact', 'An artefact across it', [['none', 'none'], ['trail', 'satellite trail'], ['ghost', 'ghost reflection'], ['cosmic', 'cosmic rays']]]],
['View', [['incl', 'Inclination', 0, 180, 0.5, '°'], ['az', 'Orbit round the axis', 0, 360, 1, '°'], ['pa', 'Roll', 0, 360, 1, '°'], ['dust', 'Dust lane', 0, 1, 0.01]]],
  ['Pen and variation', [['pen', 'Pen weight', 1, 5, 0.1, ' px'], ['vary', 'Variation', 0, 1, 0.01]]],
  ['Stars and dust', [['starMix', 'Drawn stars among the dots', 0, 1, 0.01], ['dustScribble', 'Dust lanes, hatched with pen lines', 0, 1, 0.01]]],
  ['Creative', [['field', 'Deep field of drawn galaxies', 0, 1, 0.01], ['dustLines', 'Dust carved by pen lines', 0, 1, 0.01], ['bubbles', 'Closed curves as bubbles', 0, 1, 0.01], ['streams', 'Stellar streams from pen lines', 0, 1, 0.01], ['distort', 'Hand wobble', 0, 1, 0.01]],
    ['rewind', 'Rewind the drawings to this pitch', [[0, 'off'], [1, 'on']]],
    ['lensSource', 'What gets lensed', [['galaxy', 'a small galaxy'], ['drawing', 'a drawn galaxy'], ['quasar', 'a quasar']]], ['jet', 'Jet (a drawn spring)', [[0, 'off'], [1, 'on']]], ['mWarp', 'Tear the drawings in mergers', [[0, 'off'], [1, 'on']]]],
  ['Merger', [['mTime', 'Moment in the merger', 0, 2, 0.005], ['mRatio', 'Mass ratio', 0.1, 1, 0.01], ['mPeri', 'Closest approach', 0.6, 3, 0.01], ['mStage', 'Time since closest approach', -1.5, 6, 0.05], ['mSpin1', 'Big disc tilt', 0, 180, 1, '°'], ['mSpin2', 'Small disc tilt', 0, 180, 1, '°'], ['mFriction', 'Merging (friction)', 0, 1, 0.01], ['mArms1', 'Big galaxy’s arms', 1, 4, 1], ['mSize1', 'Big galaxy’s size', 0.6, 1.5, 0.01], ['mArms2', 'Small galaxy’s arms', 1, 4, 1], ['mSize2', 'Small galaxy’s size', 0.6, 1.5, 0.01], ['mTilt', 'Orbit tilt', 0, 90, 1, '°'], ['mEcc', 'Encounter speed (bound ← → fly-by)', 0.8, 1.2, 0.01], ['mStars', 'Stars simulated', 4000, 30000, 500]], ['mType1', 'Big galaxy', [['spiral', 'spiral'], ['lenticular', 'lenticular'], ['elliptical', 'elliptical']]], ['mType2', 'Small galaxy', [['spiral', 'spiral'], ['lenticular', 'lenticular'], ['elliptical', 'elliptical']]],
    ['merger', 'Merger simulation', [[0, 'off'], [1, 'on']]]],
  ['The drawings', [],
    ['lines', 'Line strokes', [[0, 'off'], [0.8, 'on']]], ['whole', 'A whole drawing behind', [[0, 'off'], [1, 'on']]], ['envelope', 'Halo or disc drawing', [[0, 'off'], [1, 'on']]], ['outline', 'Disc outline arcs', [[0, 'off'], [1, 'on']]],
    ['stroke', 'Stroke kind', [['mixed', 'mixed'], ['plain', 'plain'], ['beaded', 'beaded'], ['spurred', 'spurred'], ['broken', 'broken'], ['dotted', 'dotted'], ['faint', 'faint']]],
    ['nuclear', 'Nuclear spiral', [[0, 'off'], [1, 'on']]]],
  ['Stars', [['stars', 'Stars sampled', 2000, 40000, 500], ['stipple', 'Stipple density', 0, 1.5, 0.01], ['knots', 'Knots on arms', 0, 1, 0.01], ['sparkle', 'Bright stars', 0, 1, 0.01]]],
  ['Lensing', [['lensR', 'Einstein radius', 0.6, 2.2, 0.01], ['lensSrc', 'Source offset', 0, 0.8, 0.005], ['lensSrcA', 'Source direction', 0, 360, 1, '°'], ['lensSize', 'Source size', 0.05, 0.6, 0.005], ['lensShear', 'External shear', 0, 0.3, 0.005], ['lensShearA', 'Shear angle', 0, 180, 1, '°'], ['lensStars', 'Dots in the arcs', 500, 12000, 100], ['lensQ', 'Lens axis ratio', 0.4, 1, 0.01], ['lensAngle', 'Lens angle', 0, 180, 1, '°'], ['lensCore', 'Lens core', 0, 0.4, 0.005]], ['lensCluster', 'A galaxy cluster', [[0, 'off'], [1, 'on']]], ['lensDouble', 'A second source (double ring)', [[0, 'off'], [1, 'on']]],
    ['lensOn', 'Lensed background galaxy', [[0, 'off'], [1, 'on']]]],
  ['Shells', [['shellTime', 'Time since infall', 20, 140, 1], ['shellAxis', 'Infall direction', 0, 180, 1, '°'], ['shellStars', 'Stars', 1000, 12000, 250]], ['shellsOn', 'Shells from a radial merger', [[0, 'off'], [1, 'on']]]],
  ['Oddities', [['companions', 'Companions', 0, 1, 0.01], ['tail', 'Tidal tail', 0, 1, 0.01], ['lens', 'Drawn arcs', 0, 1, 0.01], ['shells', 'Drawn shells', 0, 1, 0.01], ['fgstars', 'Foreground stars', 0, 1, 0.01], ['trails', 'Satellite trail, cosmic rays', 0, 1, 0.01], ['arrow', 'A stray arrow through the deep field', 0, 1, 0.01]]],
  ['Print', [], ['plates', 'Plates', [['ink', 'ink'], ['slip', 'slipped CMY plates'], ['colour', 'colour by population']]]]
];
var INPUTS = {}, CHOICES = {}, PTAB = null, ptabRefresh = function () {};
function fmtV(v, unit) { return (Number.isInteger(v) ? String(v) : v.toFixed(2)) + (unit || ''); }
(function () {                                     /* the plate's column stays in view; when it's taller than the window, it pins by its bottom, so the timeline and facts can always be seen */
  function pin() { var col = document.querySelector('.main > div:first-child'); if (!col) return; col.style.top = Math.min(12, window.innerHeight - col.offsetHeight - 12) + 'px'; }
  window.addEventListener('resize', pin); setInterval(pin, 500); setTimeout(pin, 0); })();
(function () { var lt = document.getElementById('ltag'); if (lt) lt.onclick = function () { $('reseed').click(); }; })();
/* ---------- the recipe: a galaxy as a stack of component cards, driven by one schema ---------- */
function onOff(key, onVal, offVal) { return { get: function () { return offVal === undefined ? +P[key] > 0.02 : P[key] !== offVal; }, key: key, onVal: onVal, offVal: offVal === undefined ? 0 : offVal }; }
function pct100(v) { return Math.round(v * 100) + '%'; }
var COMPONENTS = [
  { id: 'subject', tab: 'galaxy', name: 'What it is', icon: ['whole', 'galaxy:spiral'], custom: 'subject',
    summary: function () { return P.merger ? 'two galaxies, merging' : P.subject === 'star' ? 'a lone star' : P.subject === 'artefact' ? 'an artefact' : 'a single galaxy'; } },
  { id: 'merger', tab: 'galaxy', name: 'The merger', icon: ['companions', 0], show: function () { return !!P.merger; },
    main: ['mStage', 'mRatio', 'mPeri'], more: ['mTime', 'mSpin1', 'mSpin2', 'mFriction', 'mArms1', 'mSize1', 'mArms2', 'mSize2', 'mTilt', 'mEcc', 'mStars', 'mType1', 'mType2', 'mWarp', 'mBar1'],
    summary: function () { return 'mass ratio ' + (+P.mRatio).toFixed(2) + ', pericentre ' + (+P.mPeri).toFixed(1); } },
  { id: 'star', tab: 'galaxy', name: 'The star or artefact', icon: ['sstars', 'plus'], show: function () { return P.subject === 'star' || P.subject === 'artefact'; },
    main: ['starBright', 'spikes'], more: ['starRings', 'bleed', 'artefact'], summary: function () { return P.subject === 'artefact' ? ({ trail: 'a satellite trail', ghost: 'a ghost reflection', cosmic: 'cosmic rays' }[P.artefact] || 'an artefact') : 'brightness ' + pct100(P.starBright) + ', spikes ' + pct100(P.spikes); } },
  { id: 'bulge', tab: 'galaxy', name: 'Bulge', icon: ['sstars', 'burst'], on: onOff('bulge', 0.5), main: ['bulge', 'bulgeSize'], more: ['bulgeFlat', 'sersicN', 're'], show: function () { return !P.subject || P.subject === 'galaxy'; },
    summary: function () { return (P.bulge > 0.7 ? 'dominant' : P.bulge > 0.35 ? 'prominent' : 'modest') + ', ' + (P.bulgeFlat < 0.6 ? 'flattened' : 'round'); } },
  { id: 'disc', tab: 'galaxy', name: 'Disc', icon: ['env', 'disc'], main: ['thick', 'halo'], show: function () { return !P.merger && (!P.subject || P.subject === 'galaxy'); },
    summary: function () { return (P.thick > 0.5 ? 'thick' : 'thin') + (P.halo > 0.08 ? ', with a halo' : ''); } },
  { id: 'arms', tab: 'galaxy', name: 'Spiral arms', icon: ['arms', 34], on: onOff('arms', 2), main: ['arms', 'pitch', 'armStrength'], more: ['armWidth', 'flocc', 'winding'], show: function () { return !P.merger && (!P.subject || P.subject === 'galaxy'); },
    summary: function () { var n = Math.round(P.arms); return n + ' arm' + (n > 1 ? 's' : '') + ', ' + (P.pitch < 14 ? 'tightly wound' : P.pitch > 26 ? 'open' : 'moderately wound') + ', ' + Math.round(P.pitch) + '°' + (P.flocc > 0.4 ? ', flocculent' : ''); } },
  { id: 'bar', tab: 'galaxy', name: 'Bar', icon: ['bars', 0], on: onOff('bar', 0.6), main: ['bar', 'barLen'], show: function () { return !P.merger && (!P.subject || P.subject === 'galaxy'); },
    summary: function () { return (P.bar > 0.7 ? 'strong' : P.bar > 0.35 ? 'clear' : 'weak') + ', ' + (P.barLen > 0.55 ? 'long' : 'short'); } },
  { id: 'ring', tab: 'galaxy', name: 'Ring', icon: ['rings', 0], on: onOff('ring', 0.6), main: ['ring', 'ringR'], show: function () { return !P.merger && (!P.subject || P.subject === 'galaxy'); },
    summary: function () { return 'strength ' + pct100(P.ring) + ', at radius ' + (+P.ringR).toFixed(1); } },
  { id: 'dust', tab: 'galaxy', name: 'Dust', icon: ['penlines', 0], on: onOff('dust', 0.5), main: ['dust', 'dustLines'], show: function () { return !P.subject || P.subject === 'galaxy'; },
    summary: function () { return (P.dust > 0.6 ? 'heavy' : 'light') + (P.dustLines > 0.1 ? ', with dust lanes' : ''); } },
  { id: 'stars', tab: 'galaxy', name: 'Stars and knots', icon: ['sstars', 'spark'], main: ['stars', 'knots'], more: ['stipple', 'sparkle'],
    summary: function () { return Math.round(P.stars).toLocaleString('en-GB') + ' stars, ' + (P.knots > 0.5 ? 'plenty of knots' : P.knots > 0.15 ? 'a few knots' : 'no knots'); } },
  { id: 'surface', tab: 'ink', name: 'Surface', icon: ['sstars', 'spark'], custom: 'surface', summary: function () { return THEME === 'dark' ? 'chalk on a blackboard' : 'ink on paper'; } },
  { id: 'pen', tab: 'ink', name: 'Pen', icon: ['penlines', 3], main: ['pen', 'vary'], summary: function () { return 'line weight ' + (+P.pen).toFixed(1) + ', variation ' + pct100(P.vary); } },
  { id: 'inkstars', tab: 'ink', name: 'Stars and dust', icon: ['sstars', 'asterisk'], main: ['starMix', 'dustScribble'], summary: function () { return 'drawn stars ' + pct100(P.starMix) + ', hatching ' + pct100(P.dustScribble); } },
  { id: 'camera', tab: 'sky', name: 'Camera', icon: ['misc', 'arrow'], main: ['incl', 'az', 'pa'],
    summary: function () { return 'tilted ' + Math.round(P.incl) + '°, turned ' + Math.round(P.pa) + '°'; } },
  { id: 'lens', tab: 'sky', name: 'Lensing', icon: ['arcs', 'einstein-ring'], on: onOff('lensOn', 1), main: ['lensR', 'lensSrc', 'lensSize'], more: ['lensSource', 'lensCluster', 'lensDouble', 'lensSrcA', 'lensShear', 'lensShearA', 'lensStars', 'lensQ', 'lensAngle', 'lensCore'],
    summary: function () { return (P.lensCluster ? 'a galaxy cluster' : P.lensSource === 'quasar' ? 'a lensed quasar' : P.lensDouble ? 'two sources behind' : 'a galaxy behind') + ', Einstein radius ' + (+P.lensR).toFixed(1); } },
  { id: 'fgstar', tab: 'sky', name: 'A foreground star', icon: ['sstars', 'asterisk'], on: onOff('ovStar', 0.7), main: ['ovStar', 'ovStarD', 'ovStarA'],
    summary: function () { return 'brightness ' + pct100(P.ovStar) + ', ' + (P.ovStarD < 0.6 ? 'on top of the galaxy' : 'beside it'); } },
  { id: 'artefact', tab: 'sky', name: 'An artefact', icon: ['trails', 'trail'], on: onOff('ovArtefact', 'trail', 'none'), main: ['ovArtefact'],
    summary: function () { return { trail: 'a satellite trail', ghost: 'a ghost reflection', cosmic: 'cosmic rays' }[P.ovArtefact] || 'none'; } },
  { id: 'shells', tab: 'sky', name: 'Shells', icon: ['shells', 0], on: onOff('shellsOn', 1), main: ['shellTime', 'shellAxis', 'shellStars'],
    summary: function () { return 'shells from a galaxy it swallowed'; } },
  { id: 'odd', tab: 'sky', name: 'Companions and oddities', icon: ['companions', 0], main: ['companions', 'tail'], more: ['lens', 'shells', 'fgstars', 'trails', 'arrow', 'jet'],
    summary: function () { var o = []; if (P.companions > 0.05) o.push('companions'); if (P.tail > 0.05) o.push('a tidal tail'); if (P.lens > 0.05) o.push('drawn arcs'); if (P.fgstars > 0.05) o.push('field stars'); if (P.trails > 0.05) o.push('trails'); return o.length ? o.join(', ') : 'none'; } },
  { id: 'field', tab: 'sky', name: 'The deep field', icon: ['whole', 'galaxy:flocculent'], main: ['field', 'bubbles'], more: ['streams', 'distort', 'dustLines'],
    summary: function () { return P.field > 0.05 ? 'galaxies behind, ' + pct100(P.field) : 'a bare sky'; } }
];
var RCARDS = [], ROPEN = {};
function buildRecipe(panes, tbtns, selectTab) {
  var pan = $('controls');
  function rowFor(k) { var inp = document.getElementById('r_' + k); if (inp) return inp.closest('.sl-row'); var b = pan.querySelector('.ctl.choice button[data-key="' + k + '"]'); return b ? b.closest('.ctl.choice') : null; }
  function iconFor(spec) { var c = document.createElement('canvas'); c.width = c.height = 72; c.className = 'rc-ic'; var A = AT[spec[0]]; if (!A || !A.vec) return c; var idx = spec[1];
    if (typeof idx === 'string') { var list = A.kind || A.type || []; idx = 0; for (var q = 0; q < list.length; q++) if (String(list[q]).indexOf(spec[1]) >= 0) { idx = q; break; } }
    var v = A.vec[idx]; if (!v) return c; var x = c.getContext('2d'); x.strokeStyle = '#1d1b19'; x.fillStyle = '#1d1b19'; x.lineWidth = 2.4; x.lineCap = 'round'; x.lineJoin = 'round';
    (v.l || []).forEach(function (fl) { x.beginPath(); for (var i = 0; i < fl.length; i += 2) { var X = (fl[i] + 0.5) * 72, Y = (fl[i + 1] + 0.5) * 72; if (i) x.lineTo(X, Y); else x.moveTo(X, Y); } x.stroke(); }); return c; }   /* your own drawing, as the card's icon */
  function mk(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  var stacks = {}, adds = {};
  ['galaxy', 'sky', 'ink'].forEach(function (t) { var st = mk('div', 'rstack'); stacks[t] = st; var ad = mk('div', 'radd'); adds[t] = ad; var sub = panes[t].querySelector('.ptsub'); panes[t].insertBefore(st, sub ? sub.nextSibling : panes[t].firstChild); panes[t].insertBefore(ad, st.nextSibling); });
  COMPONENTS.forEach(function (comp) {
    var card = mk('div', 'rcard'), hd = mk('div', 'rc-hd'), ic = iconFor(comp.icon), tx = mk('div', 'rc-tx'), nm = mk('div', 'rc-nm', comp.name), sm = mk('div', 'rc-sm'), body = mk('div', 'rc-body');
    tx.appendChild(nm); tx.appendChild(sm); hd.appendChild(ic); hd.appendChild(tx);
    var tg = null; if (comp.on) { tg = mk('button', 'rc-tg'); tg.setAttribute('aria-label', 'Take the ' + comp.name.toLowerCase() + ' out'); tg.onclick = function (e) { e.stopPropagation(); setOn(comp, false); }; hd.appendChild(tg); }
    var chev = mk('span', 'rc-chev', '▾'); hd.appendChild(chev); card.appendChild(hd); card.appendChild(body);
    if (comp.custom === 'surface') { var sg2 = mk('div', 'rc-seg'); [['light', 'Paper'], ['dark', 'Chalkboard']].forEach(function (o) { var b = mk('button', 'tb', o[1]); b.dataset.surf = o[0]; b.onclick = function () { applyTheme(o[0]); req(); window.__refreshCards(); }; sg2.appendChild(b); }); body.appendChild(sg2); ROPEN[comp.id] = true; }
    if (comp.custom === 'subject') { var seg = mk('div', 'rc-seg'); [['galaxy', 'A galaxy'], ['merger', 'A merger'], ['star', 'A star'], ['artefact', 'An artefact']].forEach(function (o) { var b = mk('button', 'tb', o[1]); b.dataset.subj = o[0];
        b.onclick = function () { if (o[0] === 'merger') { P.merger = 1; P.subject = 'galaxy'; } else { P.merger = 0; P.subject = o[0]; } sync(); req(); }; seg.appendChild(b); }); body.appendChild(seg); var sr = rowFor('subject'); if (sr) sr.hidden = true; }
    (comp.main || []).forEach(function (k) { var r = rowFor(k); if (r) body.appendChild(r); });
    var more = (comp.more || []).map(rowFor).filter(Boolean);
    if (more.length) { var mb = mk('button', 'tb rc-more', 'more'), mw = mk('div', 'rc-morew'); mw.hidden = true; more.forEach(function (r) { mw.appendChild(r); }); mb.onclick = function () { mw.hidden = !mw.hidden; mb.textContent = mw.hidden ? 'more' : 'less'; }; body.appendChild(mb); body.appendChild(mw); }
    hd.onclick = function () { ROPEN[comp.id] = !ROPEN[comp.id]; card.classList.toggle('open', !!ROPEN[comp.id]); };
    stacks[comp.tab].appendChild(card); RCARDS.push({ comp: comp, card: card, sm: sm });
  });
  function setOn(comp, on) { var o = comp.on; if (on) { P[o.key] = P['__was_' + o.key] != null ? P['__was_' + o.key] : o.onVal; ROPEN[comp.id] = true; } else { P['__was_' + o.key] = P[o.key]; P[o.key] = o.offVal; } sync(); req(); window.__refreshCards(); }
  /* whatever the schema doesn't list is kept, in one card per tab */
  ['galaxy', 'sky', 'merger'].forEach(function (t) { var left = []; panes[t].querySelectorAll('.sl-row, .ctl.choice').forEach(function (r) { if (!r.closest('.rcard') && !r.hidden) left.push(r); });
    if (left.length) { var tt = t === 'merger' ? 'galaxy' : t, card = mk('div', 'rcard rc-rest'), hd = mk('div', 'rc-hd'), tx = mk('div', 'rc-tx'), body = mk('div', 'rc-body'); tx.appendChild(mk('div', 'rc-nm', 'Everything else')); tx.appendChild(mk('div', 'rc-sm', left.length + ' more controls')); hd.appendChild(tx); hd.appendChild(mk('span', 'rc-chev', '▾'));
      hd.onclick = function () { card.classList.toggle('open'); }; left.forEach(function (r) { body.appendChild(r); }); card.appendChild(hd); card.appendChild(body); stacks[tt].appendChild(card); }
    panes[t].querySelectorAll('.sec').forEach(function (sec) { if (!sec.querySelector('.sl-row, .ctl.choice, button, input')) sec.hidden = true; }); });
  panes.galaxy.querySelectorAll('.sec').forEach(function (sec) { sec.hidden = true; }); panes.sky.querySelectorAll('.sec').forEach(function (sec) { sec.hidden = true; });
  tbtns.merger.hidden = true; panes.merger.hidden = true;   /* the merger is a subject now, not a tab */
  panes.sky.querySelectorAll('.mnote').forEach(function (n) { n.remove(); });   /* the Add row replaces the old note */
  /* ink: each of its groups becomes a card too */
  var INKICON = { 'The drawings': ['whole', 'galaxy:spiral'], 'Print': ['misc', 'spring'] }, INKSUM = { 'The drawings': 'which kinds of drawing are used', 'Print': 'export and printing' };
  panes.ink.querySelectorAll('details.sec').forEach(function (sec) { var sm0 = sec.querySelector('summary'), name = sm0 ? sm0.textContent.trim() : 'Ink', kids = Array.prototype.filter.call(sec.children, function (c) { return c.tagName !== 'SUMMARY'; });
    if (!kids.some(function (c) { return c.querySelector ? (c.matches('.sl-row, .ctl.choice, button, input, div') ) : false; })) { sec.hidden = true; return; }
    var card = mk('div', 'rcard'), hd = mk('div', 'rc-hd'), tx = mk('div', 'rc-tx'), body = mk('div', 'rc-body'); hd.appendChild(iconFor(INKICON[name] || ['penlines', 0])); tx.appendChild(mk('div', 'rc-nm', name)); tx.appendChild(mk('div', 'rc-sm', INKSUM[name] || '')); hd.appendChild(tx); hd.appendChild(mk('span', 'rc-chev', '▾'));
    hd.onclick = function () { card.classList.toggle('open'); }; kids.forEach(function (c) { body.appendChild(c); }); card.appendChild(hd); card.appendChild(body); stacks.ink.appendChild(card); sec.hidden = true; });   /* each ink group, a card like the rest */
  window.__refreshCards = function () {
    RCARDS.forEach(function (rc) { var c = rc.comp, shown = c.show ? c.show() : true, on = c.on ? c.on.get() : true; rc.card.hidden = !shown || !on; rc.card.classList.toggle('open', !!ROPEN[c.id]); try { rc.sm.textContent = c.summary(); } catch (e) {}
      if (c.custom === 'surface') rc.card.querySelectorAll('[data-surf]').forEach(function (b) { b.classList.toggle('on', THEME === b.dataset.surf); });
      if (c.custom === 'subject') rc.card.querySelectorAll('[data-subj]').forEach(function (b) { var v = b.dataset.subj; b.classList.toggle('on', v === 'merger' ? !!P.merger : (!P.merger && (P.subject || 'galaxy') === v)); }); });
    ['galaxy', 'sky'].forEach(function (t) { var ad = adds[t]; ad.innerHTML = ''; var off = RCARDS.filter(function (rc) { return rc.comp.tab === t && rc.comp.on && !rc.comp.on.get() && (rc.comp.show ? rc.comp.show() : true); });
      if (!off.length) return; ad.appendChild(mk('span', 'radd-lab', 'Add')); off.forEach(function (rc) { var nm2 = rc.comp.name.replace(/^(A|An) /, ''); var b = mk('button', 'tb radd-b', '+ ' + nm2.charAt(0).toUpperCase() + nm2.slice(1)); b.onclick = function () { setOn(rc.comp, true); }; ad.appendChild(b); }); });
  };
  window.__refreshCards();
}
function buildControls() {
  var pan = $('controls'); pan.innerHTML = '';
  var pr = document.createElement('div'); pr.className = 'group pstart';
  var row = document.createElement('div'); row.className = 'presets';
  /* presets, grouped: galaxies, mergers, lenses, creative */
  var CRE = ['Deep field', 'A sketch, lensed', 'Sketches, torn apart', 'Radio jet', 'Stellar streams', 'Dusty spiral', 'Hand wobble', 'Plates slipped', 'Stellar populations', 'Shell galaxy'];
  var groups = [['Galaxies', []], ['Mergers', []], ['Lenses', []], ['Stars and artefacts', []], ['Scenes', []], ['Creative', []]];
  Object.keys(PRESETS).forEach(function (name) { var gi = name.indexOf('Merger:') === 0 ? 1 : name.indexOf('Lens:') === 0 ? 2 : (name.indexOf('Star:') === 0 || name.indexOf('Artefact:') === 0) ? 3 : name.indexOf('Layered:') === 0 ? 4 : CRE.indexOf(name) >= 0 ? 5 : 0; groups[gi][1].push(name); });
  var allB = [];
  groups.forEach(function (gr) { if (!gr[1].length) return; var sub = document.createElement('div'); sub.className = 'psub'; sub.textContent = gr[0]; row.appendChild(sub);
    var wrap = document.createElement('div'); wrap.className = 'pgrp';
    gr[1].forEach(function (name) { var b = document.createElement('button'); b.className = 'tb'; var nm = name.replace(/^(Merger|Lens|Star|Artefact|Layered): /, ''); if (name.indexOf('Star:') === 0) nm = 'star, ' + nm; nm = nm.charAt(0).toUpperCase() + nm.slice(1); b.classList.add('pcard'); var th = (window.__PTHUMBS || {})[name]; if (th) { var ti = document.createElement('img'); ti.src = th; ti.alt = ''; b.appendChild(ti); } var tl = document.createElement('span'); tl.textContent = nm; b.appendChild(tl);   /* a small drawing on a post-it */ b.title = name; allB.push(b);
      b.onclick = function () { clearReal(); P = Object.assign({}, DEF, PRESETS[name], { seed: P.seed }); sync(); req(); allB.forEach(function (c) { c.classList.toggle('on', c === b); }); };
      wrap.appendChild(b); });
    row.appendChild(wrap); });
  pr.appendChild(row); pan.appendChild(pr);
  GROUPS.forEach(function (g) {
    var box = document.createElement('details'); box.className = 'group'; box.open = ['Shape', 'Arms', 'Pen and variation', 'Stars and dust', 'Creative', 'Print'].indexOf(g[0]) >= 0;
    var sm = document.createElement('summary'); sm.className = 'gh'; sm.textContent = g[0]; box.appendChild(sm);
    g[1].forEach(function (c) {                      /* a slider in the Principia style: an inset well, a hairline track with its fill, a square ink handle, end ticks, a typeable value */
      var k = c[0], mn = c[2], mx = c[3], rng = mx - mn || 1, dec = String(c[4]).indexOf('.') < 0 ? 0 : String(c[4]).length - String(c[4]).indexOf('.') - 1;
      function div(cls) { var d = document.createElement('div'); d.className = cls; return d; }
      function fmtN(v) { return Math.abs(v) >= 1000 ? (v / 1000) + 'k' : String(+v.toFixed(dec)); }
      var row = div('sl-row'), lab = document.createElement('label'); lab.textContent = c[1]; lab.htmlFor = 'r_' + k; row.appendChild(lab);
      var tr = div('sl-track-row'), wrap = div('sl-range-wrap'), tc = div('sl-track-container'), bg = div('sl-track-bg'), fill = div('sl-track-fill'), mk = div('sl-markers');
      function marker(cls, pos, text) { var m = div('sl-marker ' + cls); m.style.left = pos + '%'; m.innerHTML = '<div class="sl-marker-line"></div><div class="sl-marker-label">' + text + '</div>'; mk.appendChild(m); }
      marker('min', 0, fmtN(mn)); if (mn < 0 && mx > 0) marker('zero', (0 - mn) / rng * 100, '0'); marker('max', 100, fmtN(mx));
      var inp = document.createElement('input'); inp.type = 'range'; inp.id = 'r_' + k; inp.min = mn; inp.max = mx; inp.step = c[4]; inp.setAttribute('aria-label', c[1]);
      tc.appendChild(bg); tc.appendChild(fill); tc.appendChild(mk); tc.appendChild(inp); wrap.appendChild(tc);
      var vw = div('sl-val-wrap'), num = document.createElement('input'); num.type = 'text'; num.inputMode = 'decimal'; num.className = 'slider-num'; num.setAttribute('aria-label', c[1] + ' value'); vw.appendChild(num);
      if (c[5]) { num.classList.add('hasunit'); var un = document.createElement('span'); un.className = 'slider-unit'; un.textContent = c[5]; vw.appendChild(un); }
      tr.appendChild(wrap); tr.appendChild(vw); row.appendChild(tr); box.appendChild(row);
      function paint(v) { var vp = clamp((v - mn) / rng * 100, 0, 100);
        if (mn < 0 && mx > 0) { var zp = (0 - mn) / rng * 100; fill.style.left = Math.min(zp, vp) + '%'; fill.style.width = Math.abs(vp - zp) + '%'; } else { fill.style.left = '0%'; fill.style.width = vp + '%'; }
        if (document.activeElement !== num) num.value = (+v).toFixed(dec); }
      inp.oninput = function () { P[k] = parseFloat(inp.value); paint(P[k]); req(); };
      num.onchange = function () { var v = parseFloat(num.value.replace(',', '.')); if (isFinite(v)) { v = clamp(v, mn, mx); P[k] = v; inp.value = v; req(); } paint(P[k]); };
      num.onkeydown = function (e) { if (e.key === 'Enter') num.blur(); e.stopPropagation(); };
      num.onblur = function () { paint(P[k]); };
      INPUTS[k] = [inp, c[5], paint];
    });
    g.slice(2).forEach(function (ch) {
      var w = document.createElement('div'); w.className = 'ctl choice'; w.innerHTML = '<span class="nm">' + ch[1] + '</span>';
      ch[2].forEach(function (o) { var b = document.createElement('button'); b.className = 'tb'; b.textContent = o[1]; b.dataset.key = ch[0]; b.dataset.val = o[0];
        b.onclick = function () { P[ch[0]] = o[0]; sync(); req(); }; w.appendChild(b); });
      CHOICES[ch[0]] = true; box.appendChild(w);
    });
    if (g[0] === 'View') {
      var w2 = document.createElement('div'); w2.className = 'ctl choice'; w2.innerHTML = '<span class="nm">Winding</span>';
      [['S-wise', 1], ['Z-wise', -1]].forEach(function (o) { var b = document.createElement('button'); b.className = 'tb'; b.textContent = o[0]; b.dataset.key = 'winding'; b.dataset.val = o[1] * MODEL_SIGN; b.onclick = function () { P.winding = o[1] * MODEL_SIGN; sync(); req(); }; w2.appendChild(b); });
      box.appendChild(w2);
    }
    pan.appendChild(box);
  });
  /* ---------- tabs: one part of the panel at a time ---------- */
  var TABS = [['start', 'Choose', 'a preset, a Galaxy Zoo galaxy, or a real one with its photo'], ['galaxy', 'Galaxy', 'the galaxy itself: its shape, arms, bar and stars'], ['merger', 'Merger', 'two galaxies meeting, and what the tides do'],
    ['sky', 'Sky', 'how it’s seen, and what’s around it'], ['ink', 'Ink', 'how it’s drawn: pen, stars, dust and print']];
  var TABOF = { 'In the field': 'sky', 'Star or artefact': 'galaxy', 'Shape': 'galaxy', 'Arms': 'galaxy', 'Bar and ring': 'galaxy', 'Stars': 'galaxy', 'Merger': 'merger', 'View': 'sky', 'Oddities': 'sky', 'Lensing': 'sky', 'Shells': 'sky', 'Creative': 'sky', 'Pen and variation': 'ink', 'Stars and dust': 'ink', 'The drawings': 'ink', 'Print': 'ink' };
  var tabbar = document.createElement('div'); tabbar.className = 'ptabs'; tabbar.setAttribute('role', 'tablist'); var panes = {}, tbtns = {};
  TABS.forEach(function (t) { var b = document.createElement('button'); b.className = 'ptab'; b.dataset.tab = t[0]; b.textContent = t[1]; b.setAttribute('role', 'tab'); b.onclick = function () { selectTab(t[0]); }; tabbar.appendChild(b); tbtns[t[0]] = b;
    var pn = document.createElement('div'); pn.className = 'ppane'; pn.setAttribute('role', 'tabpanel'); var sub = document.createElement('div'); sub.className = 'hand ptsub'; sub.textContent = t[2]; pn.appendChild(sub); panes[t[0]] = pn; });
  Array.prototype.slice.call(pan.children).forEach(function (ch) {
    if (ch === pr) { panes.start.appendChild(ch); return; }
    var sm = ch.querySelector('summary'), name = sm ? sm.textContent.trim() : '', tab = TABOF[name] || 'sky'; ch.open = true; ch.classList.add('sec'); panes[tab].appendChild(ch);
    ch.querySelectorAll('.ctl.choice').forEach(function (w) { var opts = document.createElement('span'); opts.className = 'chs'; Array.prototype.slice.call(w.children).forEach(function (c2) { if (!c2.classList.contains('nm')) opts.appendChild(c2); }); w.appendChild(opts); });
  });
  var mnote = document.createElement('div'); mnote.className = 'mnote'; mnote.innerHTML = '<p>This galaxy isn’t a merger.</p>'; var mb = document.createElement('button'); mb.className = 'tb'; mb.textContent = 'Make it a merger';
  mb.onclick = function () { clearReal(); P = Object.assign({}, P, PRESETS['Merger: the Mice'], { seed: P.seed }); sync(); req(); }; mnote.appendChild(mb); panes.merger.insertBefore(mnote, panes.merger.children[1]);
  /* a few choices belong elsewhere: tearing with the merger, rewinding with your drawings */
  function moveChoice(key, toPane, beforeSec) { var bt = null; Object.keys(panes).some(function (k2) { bt = panes[k2].querySelector('[data-key="' + key + '"]'); return !!bt; }); var row = bt && bt.closest('.ctl.choice'); if (!row) return; var tgt = beforeSec ? Array.prototype.find.call(panes[toPane].querySelectorAll('details.sec'), function (d) { return d.querySelector('summary').textContent.trim() === beforeSec; }) : null; (tgt || panes[toPane]).appendChild(row); }
  moveChoice('mWarp', 'merger', 'Merger'); moveChoice('rewind', 'ink', 'The drawings'); moveChoice('unwrap', 'sky', 'View'); moveChoice('lensSource', 'sky', 'Lensing'); moveChoice('jet', 'sky', 'Oddities');
  /* the Sky tab: view and oddities first; lensing and shells only once they're switched on */
  function secByName(pn, name) { return Array.prototype.find.call(panes[pn].querySelectorAll('details.sec'), function (d) { return d.querySelector('summary').textContent.trim() === name; }); }
  ['View', 'In the field', 'Oddities', 'Creative', 'Lensing', 'Shells'].forEach(function (n) { var d = secByName('sky', n); if (d) panes.sky.appendChild(d); });
  var skyNote = document.createElement('div'); skyNote.className = 'mnote'; skyNote.innerHTML = '<p>Lensing and shell settings appear here once you turn on a lens or shells under Oddities.</p>'; panes.sky.appendChild(skyNote);
  var surp = document.createElement('div'); surp.className = 'pstartbar'; (function () { var b = document.createElement('button'); b.className = 'pile'; b.setAttribute('aria-label', 'Surprise me: a galaxy at random'); b.innerHTML = '<span class="pile-img"></span><span class="pile-tx"><b>Surprise me</b><span>pull one off the pile</span></span>';
    b.onclick = function () { b.classList.remove('pull'); void b.offsetWidth; b.classList.add('pull'); setTimeout(function () { $('surprise').click(); }, 180); }; surp.appendChild(b); })();   /* a pile of post-its: pull one off */
  panes.start.insertBefore(surp, panes.start.children[1]);
  ['Any Galaxy Zoo 2 galaxy', 'Real galaxies'].forEach(function (lbl) { var sec = document.querySelector('section.real[aria-label="' + lbl + '"]'); if (sec) panes.start.appendChild(sec); });   /* everything about choosing, in one tab */
  (function () {                                   /* one kind of choosing at a time: presets, a Galaxy Zoo galaxy, or the prints */
    var secZ = panes.start.querySelector('section.real[aria-label="Any Galaxy Zoo 2 galaxy"]'), secP = panes.start.querySelector('section.real[aria-label="Real galaxies"]'),   /* found inside the tab, which isn't in the page yet */ views = { presets: [pr], real: [secZ, secP] };
    var seg = document.createElement('div'); seg.className = 'chooseseg'; seg.setAttribute('role', 'tablist');
    [['presets', 'Examples'], ['real', 'Real galaxies']].forEach(function (v) { var b = document.createElement('button'); b.className = 'tb'; b.textContent = v[1]; b.dataset.v = v[0]; b.setAttribute('role', 'tab');
      b.onclick = function () { Object.keys(views).forEach(function (k) { views[k].forEach(function (e) { if (e) e.hidden = k !== v[0]; }); }); Array.prototype.forEach.call(seg.children, function (c) { c.classList.toggle('on', c === b); c.setAttribute('aria-selected', String(c === b)); }); }; seg.appendChild(b); });
    var sb = panes.start.querySelector('.pstartbar'); panes.start.insertBefore(seg, sb ? sb.nextSibling : panes.start.children[1]); seg.children[0].onclick();
  })();
  pan.innerHTML = ''; pan.appendChild(tabbar); TABS.forEach(function (t) { pan.appendChild(panes[t[0]]); });
  function selectTab(id) { PTAB = id; Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== id; tbtns[k].classList.toggle('on', k === id); tbtns[k].setAttribute('aria-selected', String(k === id)); }); ptabRefresh(); }
  ptabRefresh = function () { var m = !!P.merger; mnote.hidden = m; Array.prototype.forEach.call(panes.merger.querySelectorAll('.sec, .ctl.choice'), function (x) { x.hidden = !m; }); tbtns.merger.classList.toggle('dim', !m);
    var lensOn = P.lens > 0.02 || !!P.lensOn, shOn = P.shells > 0.02 || P.shellsOn == 1, dl = secByName('sky', 'Lensing'), ds = secByName('sky', 'Shells'); if (dl) dl.hidden = !lensOn; if (ds) ds.hidden = !shOn; skyNote.hidden = lensOn && shOn; };
  selectTab(PTAB === 'merger' ? 'galaxy' : (PTAB || 'start'));
  buildRecipe(panes, tbtns, selectTab);   /* the rail as a recipe of component cards */
  // the real galaxies
  var gal = $('gallery'); gal.innerHTML = '';
  REAL.forEach(function (g, i) { var b = document.createElement('button'); b.className = 'rg'; b.title = 'Galaxy Zoo 2 galaxy ' + g.id; var rz = Math.sin((i + 1) * 12.9898) * 43758.5453; b.style.setProperty('--rot', (((rz - Math.floor(rz)) - 0.5) * 3).toFixed(2) + 'deg');
    b.setAttribute('aria-label', 'Draw real galaxy ' + (i + 1) + ' (' + g.from + ')');
    var inner = document.createElement('span'); inner.className = 'rg-inner'; var fr = document.createElement('span'); fr.className = 'rg-face rg-front'; var bk = document.createElement('span'); bk.className = 'rg-face rg-back b' + (i % 4); var rt = (window.__RTHUMBS || [])[i]; if (rt) { var pit = document.createElement('img'); pit.className = 'rg-pit'; pit.src = rt; pit.alt = ''; pit.style.setProperty('--pr', ((((i * 37) % 9) - 4) * 0.8) + 'deg'); bk.appendChild(pit); }   /* its drawing, on a post-it stuck to the back */
    var im = document.createElement('img'); im.src = g.photo; im.alt = ''; fr.appendChild(im); var cp = document.createElement('span'); cp.className = 'rg-cap hand'; try { var fr0 = fromReal(g); cp.textContent = shortType(fr0.p, fr0.odd); } catch (e) {} fr.appendChild(cp); inner.appendChild(fr);   /* what it is, written on the print */ inner.appendChild(bk); b.appendChild(inner); b.onclick = function () { showReal(i); }; gal.appendChild(b); });   /* a two-sided print: photo on the front, one of your real backs behind */
  sync();
}
function sync() {
  if (window.__refreshCards) setTimeout(window.__refreshCards, 0);
  Object.keys(INPUTS).forEach(function (k) { INPUTS[k][0].value = P[k]; if (INPUTS[k][2]) INPUTS[k][2](P[k]); });
  document.querySelectorAll('[data-key]').forEach(function (b) { b.classList.toggle('on', String(P[b.dataset.key]) === String(b.dataset.val)); });
  $('seedv').textContent = 'no. ' + P.seed; var lt0 = document.getElementById('ltagno'); if (lt0) { var sd = String(P.seed); lt0.textContent = sd; lt0.parentNode.style.fontSize = (sd.length <= 2 ? 19 : sd.length === 3 ? 17 : sd.length === 4 ? 15 : 13) + 'px'; }   /* the number fits the tag */
  var pcap = document.getElementById('platecapt'); if (pcap) pcap.textContent = P.subject === 'star' ? 'a star, in your hand' : P.subject === 'artefact' ? 'an artefact, in your hand' : 'a galaxy, in your hand';
  ptabRefresh();
}
/* ---------- the merger's timeline: loop until stopped, scrub, set an end, export a GIF ---------- */
var TL = { playing: false, t0: 0, from: 0, end: 2, speed: 1, loop: true, raf: 0 }, TL_BASE = 12, PLAYING = 0;   /* at 1x, the whole story (0 to 2) takes 12 seconds */
function tlPhase(t) { if (P.lensOn && P.lensSource === 'quasar') return 'the flare reaches the images in turn'; return t < 0.97 ? 'approach' : t <= 1.03 ? 'the moment you chose' : t <= 2 ? 'after' : 'long after'; }
function tlUpdate() {
  var tl = $('timeline'), anim = P.merger || (P.lensOn && P.lensSource === 'quasar'); if (!tl) return; tl.hidden = !anim; if (!anim) { if (TL.playing) tlStop(); return; }
  var HZt = Math.max(2, P.mHorizon || 2); $('tlscrub').max = HZt; var t = P.mTime == null ? 1 : P.mTime; $('tlscrub').value = t; $('tlread').textContent = 't = ' + t.toFixed(2) + ' · ' + tlPhase(t);
  $('tlchosen').style.left = (100 / HZt) + '%'; $('tlendmark').style.left = (TL.end / HZt * 100) + '%'; if (document.activeElement !== $('tlend')) $('tlend').value = TL.end.toFixed(2); $('tlspeedv').textContent = TL.speed + '×';
  var lbl = TL.playing ? '❚❚' : '▶'; $('tlplay').textContent = lbl; $('tlplay').setAttribute('aria-label', TL.playing ? 'Pause' : 'Play the merger'); $('play').textContent = TL.playing ? 'Pause merger' : 'Play merger';
}
function tlStart() { if (!(P.merger || (P.lensOn && P.lensSource === 'quasar'))) return; TL.playing = true; TL.from = (P.mTime != null && P.mTime < TL.end - 0.01) ? P.mTime : 0;   /* from where it is, or from the start if it's at the end */ TL.t0 = performance.now(); tlUpdate(); tlStep(); }
function tlStop() { TL.playing = false; cancelAnimationFrame(TL.raf); tlUpdate(); }
function tlStep() {
  if (!TL.playing) return;
  var period = TL_BASE / TL.speed * Math.max(0.1, TL.end) / 2,   /* 6 s per unit of t at 1x */ el = (performance.now() - TL.t0) / 1000, t = TL.from + el / period * TL.end;   /* the same pace whatever the end */
  if (TL.loop) t = t % TL.end; else if (t >= TL.end) { P.mTime = TL.end; render(); sync(); tlStop(); return; }   /* looping, or once through to the end */
  P.mTime = t; render(); sync(); tlUpdate();
  TL.raf = requestAnimationFrame(tlStep);
}
$('play').onclick = function () { if (TL.playing) tlStop(); else tlStart(); };
$('tlplay').onclick = function () { if (TL.playing) tlStop(); else tlStart(); };
$('tlscrub').oninput = function () { if (TL.playing) tlStop(); P.mTime = parseFloat(this.value); render(); sync(); tlUpdate(); };
function tlSetEnd(v) { if (!isFinite(v)) { tlUpdate(); return; } TL.end = Math.min(30, Math.max(0.2, v)); if (TL.end > (P.mHorizon || 2)) { P.mHorizon = Math.ceil(TL.end); } else if (TL.end <= 2) P.mHorizon = 2;   /* simulate as far as the end asks */ if (P.mTime > TL.end) { P.mTime = TL.end; render(); sync(); } if (TL.playing) { TL.from = P.mTime < TL.end ? P.mTime : 0; TL.t0 = performance.now(); } $('tlend').value = TL.end.toFixed(2); tlUpdate(); }
$('tlend').onchange = function () { tlSetEnd(parseFloat(this.value.replace(',', '.'))); };            /* on Enter or leaving the field: checked, clamped to 0.2-2 */
$('tlend').onkeydown = function (e) { if (e.key === 'Enter') { this.blur(); } e.stopPropagation(); };
$('tlspeed').oninput = function () { TL.speed = parseFloat(this.value); if (TL.playing) { TL.from = P.mTime; TL.t0 = performance.now(); } tlUpdate(); };
$('tlloop').onchange = function () { TL.loop = this.checked; if (TL.playing) { TL.from = P.mTime; TL.t0 = performance.now(); } };

/* a small GIF encoder: ink on paper maps onto a 256-shade ramp almost exactly; colour modes get a colour cube */
function gifEncode(frames, w, h, pal, delayCs) {
  var cap = 1 << 20, out = new Uint8Array(cap), n = 0;
  function b(x) { if (n >= cap) { cap *= 2; var o2 = new Uint8Array(cap); o2.set(out); out = o2; } out[n++] = x & 255; }
  function w16(x) { b(x); b(x >> 8); } function str(t) { for (var i = 0; i < t.length; i++) b(t.charCodeAt(i)); }
  str('GIF89a'); w16(w); w16(h); b(0xF7); b(0); b(0);
  for (var i = 0; i < 256; i++) { var c = pal[i] || [0, 0, 0]; b(c[0]); b(c[1]); b(c[2]); }
  b(0x21); b(0xFF); b(11); str('NETSCAPE2.0'); b(3); b(1); w16(0); b(0);                  /* loop forever */
  frames.forEach(function (px) {
    b(0x21); b(0xF9); b(4); b(0); w16(delayCs); b(0); b(0);
    b(0x2C); w16(0); w16(0); w16(w); w16(h); b(0);
    var minSize = 8, clear = 256, eoi = 257, cs = 9, next = 258, table = new Map(), acc = 0, nb = 0, blk = [];
    function emit(code) { acc |= code << nb; nb += cs; while (nb >= 8) { blk.push(acc & 255); acc >>>= 8; nb -= 8; } }
    b(minSize); emit(clear); var cur = px[0];
    for (var k = 1; k < px.length; k++) {
      var v = px[k], key = cur * 256 + v, hit = table.get(key);
      if (hit !== undefined) { cur = hit; continue; }
      emit(cur);
      if (next === 4096) { emit(clear); next = 258; cs = 9; table.clear(); }
      else { if (next >= (1 << cs)) cs++; table.set(key, next++); }
      cur = v;
    }
    emit(cur); emit(eoi); if (nb > 0) blk.push(acc & 255);
    for (var j2 = 0; j2 < blk.length; j2 += 255) { var m = Math.min(255, blk.length - j2); b(m); for (var t = 0; t < m; t++) b(blk[j2 + t]); } b(0);
  });
  b(0x3B); return out.slice(0, n);
}
function cssRGB(str0) { var m = (str0 || '').match(/\d+(\.\d+)?/g); return m ? [+m[0], +m[1], +m[2]] : [226, 217, 198]; }
var GIFBUSY = false;
$('gifbtn').onclick = function () {
  if (GIFBUSY || !(P.merger || (P.lensOn && P.lensSource === 'quasar'))) return; GIFBUSY = true; var wasPlaying = TL.playing; tlStop();
  var S2 = parseInt($('gifsize').value, 10), nF = parseInt($('gifframes').value, 10), keepT = P.mTime, btn = $('gifbtn'), end = TL.end;
  var paper = cssRGB(getComputedStyle(document.querySelector('.plate')).backgroundColor), ink = INK.map(function (x) { return Math.round(x * 255); }), ramp = P.plates === 'ink';
  var pal = []; if (ramp) { for (var i = 0; i < 256; i++) { var f = i / 255; pal.push([Math.round(paper[0] + (ink[0] - paper[0]) * f), Math.round(paper[1] + (ink[1] - paper[1]) * f), Math.round(paper[2] + (ink[2] - paper[2]) * f)]); } }
  else { for (var r6 = 0; r6 < 6; r6++) for (var g7 = 0; g7 < 7; g7++) for (var b6 = 0; b6 < 6; b6++) pal.push([Math.round(r6 * 51), Math.round(g7 * 42.5), Math.round(b6 * 51)]); pal.push(paper); }
  var dx = ink[0] - paper[0], dy = ink[1] - paper[1], dz = ink[2] - paper[2], dd = dx * dx + dy * dy + dz * dz || 1;
  var off = document.createElement('canvas'); off.width = off.height = S2; var ox = off.getContext('2d', { willReadFrequently: true }), frames = [], k = 0;
  function one() {
    if (k >= nF) { finish(); return; }
    P.mTime = k / nF * end; render();                                                   /* frames from the start to your end, evenly spaced, so the GIF loops cleanly */
    ox.fillStyle = 'rgb(' + paper.join(',') + ')'; ox.fillRect(0, 0, S2, S2); ox.drawImage(cv, 0, 0, S2, S2);
    var d = ox.getImageData(0, 0, S2, S2).data, px = new Uint8Array(S2 * S2);
    for (var q = 0, o = 0; q < px.length; q++, o += 4) {
      if (ramp) { var tt = ((d[o] - paper[0]) * dx + (d[o + 1] - paper[1]) * dy + (d[o + 2] - paper[2]) * dz) / dd; px[q] = tt <= 0 ? 0 : tt >= 1 ? 255 : Math.round(tt * 255); }
      else px[q] = Math.min(5, Math.round(d[o] / 51)) * 42 + Math.min(6, Math.round(d[o + 1] / 42.5)) * 6 + Math.min(5, Math.round(d[o + 2] / 51));
    }
    frames.push(px); k++; btn.textContent = 'Rendering ' + k + ' / ' + nF + '…'; setTimeout(one, 0);
  }
  function finish() {
    btn.textContent = 'Encoding…';
    setTimeout(function () {
      var delay = Math.max(2, Math.round(TL_BASE / TL.speed * end / 2 / nF * 100)), bytes = gifEncode(frames, S2, S2, pal, delay), blob = new Blob([bytes], { type: 'image/gif' }), name = 'rosse-merger-' + P.seed + '.gif';
      P.mTime = keepT; render(); sync(); tlUpdate(); GIFBUSY = false; btn.textContent = 'Export GIF';
      if (SAVE) { SAVE.save({ filename: name, data: blob }).catch(function () {}); }
      else if (!inViewer) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
      window.__LASTGIF = { size: bytes.length, frames: nF, px: S2, bytes: bytes };
      if (wasPlaying) tlStart();
    }, 30);
  }
  one();
};
var SAVE = null, inViewer = !!(window.claude && window.claude.use);
if (inViewer) { $('svg').hidden = true; window.claude.use('downloads').then(function (d) { SAVE = d; if (d) $('svg').hidden = false; }); }
$('svg').onclick = function () {
  var ex = exportSVG(), name = 'rosse-' + P.seed + '.svg';
  if (SAVE) { SAVE.save({ filename: name, data: new Blob([ex.svg], { type: 'image/svg+xml' }) }).catch(function (e) { if (e && e.code === 'rate_limited') $('svg').textContent = 'Try again in a moment'; }); return; }
  if (!inViewer) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ex.svg], { type: 'image/svg+xml' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
};
window.__EXPORT = function () { return exportSVG(); };
$('theme').onclick = function () { applyTheme(THEME === 'dark' ? 'light' : 'dark'); req(); };
$('reseed').onclick = function () { P.seed = 1 + Math.floor(Math.random() * 9999); sync(); req(); };
$('surprise').onclick = function () {
  clearReal(); var names = Object.keys(PRESETS), base = PRESETS[names[Math.floor(Math.random() * names.length)]], r = Math.random;
  P = Object.assign({}, DEF, base, { seed: 1 + Math.floor(r() * 9999), incl: base.incl != null ? base.incl : Math.round(r() * 85), pa: Math.round(r() * 180), winding: r() < 0.5 ? -1 : 1,
    pitch: base.pitch || Math.round(8 + r() * 30), lines: Math.round((0.3 + r() * 0.7) * 100) / 100,
    armStyle: r() < 0.3 ? 'drawn' : 'ribbons', whole: r() < 0.35 ? Math.round(r() * 60) / 100 : base.whole || 0, fgstars: Math.round(r() * 60) / 100,
    companions: base.companions || (r() < 0.2 ? 0.6 : 0), plates: base.plates || (r() < 0.2 ? (r() < 0.5 ? 'slip' : 'colour') : 'ink'),
    vary: Math.round((0.3 + 0.7 * r()) * 100) / 100, pen: Math.round((1.6 + 1.8 * r()) * 10) / 10, lines: r() < 0.8 ? 0.8 : 0, whole: r() < 0.15 ? 1 : 0, envelope: r() < 0.15 ? 1 : 0,
    arms: base.arms != null ? base.arms : Math.floor(r() * 5), bar: base.bar != null ? base.bar : (r() < 0.3 ? 0.5 + 0.5 * r() : 0), ring: base.ring != null ? base.ring : (r() < 0.12 ? 0.8 : 0),
    bulge: base.bulge != null ? base.bulge : Math.round(r() * r() * 60) / 100, flocc: base.flocc != null ? base.flocc : (r() < 0.25 ? 0.4 + 0.5 * r() : 0) });
  if (!P.merger && r() < 0.22) Object.assign(P, { merger: 1, mRatio: 0.15 + 0.85 * r(), mPeri: 0.8 + 1.6 * r(), mStage: 0.3 + 3.5 * r(), mSpin1: Math.round(r() * 90), mSpin2: Math.round(r() * 180), mFriction: r() < 0.3 ? 0.7 : 0 });
  if (P.merger) { var TYP = function () { var u = r(); return u < 0.6 ? 'spiral' : u < 0.8 ? 'lenticular' : 'elliptical'; };   /* every merger its own pair of galaxies */
    Object.assign(P, { mType1: base.mType1 || TYP(), mType2: base.mType2 || TYP(), mArms1: base.mArms1 || 1 + Math.floor(r() * 4), mArms2: base.mArms2 || 1 + Math.floor(r() * 4), mSize1: Math.round((0.75 + 0.6 * r()) * 100) / 100, mSize2: Math.round((0.7 + 0.7 * r()) * 100) / 100,
      mBar1: r() < 0.25 ? 1 : 0, mBar2: r() < 0.2 ? 1 : 0, mTilt: base.mTilt != null ? base.mTilt : Math.round(r() < 0.5 ? r() * 25 : r() * 90), mEcc: base.mEcc || Math.round((0.85 + 0.3 * r()) * 100) / 100 }); }
  var kinds = ['mixed', 'plain', 'beaded', 'spurred', 'broken', 'dotted']; P.stroke = kinds[Math.floor(r() * kinds.length)];
  if (r() < 0.14) P.ovStar = 0.4 + 0.5 * r(), P.ovStarD = 1.2 + 1.4 * r(), P.ovStarA = r() * 360; else P.ovStar = 0;
  P.ovArtefact = r() < 0.08 ? ['trail', 'ghost', 'cosmic'][Math.floor(r() * 3)] : 'none';
  if (!base.subject && r() < 0.06) Object.assign(P, { merger: 0, subject: r() < 0.65 ? 'star' : 'artefact', artefact: ['trail', 'ghost', 'cosmic'][Math.floor(r() * 3)], starBright: 0.4 + 0.55 * r(), spikes: 0.3 + 0.7 * r(), starRings: r() * 0.7, bleed: r() < 0.5 ? 0.3 + 0.5 * r() : 0 });
  sync(); req();
};
$('clearreal').onclick = function () { clearReal(); };

/* ---------- any Galaxy Zoo 2 galaxy: the full catalogue, packed column by column ---------- */
var CAT = null, CATP = null;
function loadCat() {
  if (CAT) return Promise.resolve(CAT); if (CATP) return CATP;
  $('catinfo').textContent = 'unpacking 239,695 galaxies…';
  CATP = (async function () {
    var b = atob(window.__CAT.b64), bin = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) bin[i] = b.charCodeAt(i);
    if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot unpack the catalogue');
    var buf = new Uint8Array(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    var H = window.__CAT.hdr, N = H.n, F = H.fields, off = 0, cols = {};
    F.forEach(function (f) { cols[f] = buf.subarray(off, off + N); off += N; });
    function u24(o) { var a = buf.subarray(o, o + N), b2 = buf.subarray(o + N, o + 2 * N), c = buf.subarray(o + 2 * N, o + 3 * N), out = new Float64Array(N); for (var i = 0; i < N; i++) out[i] = (a[i] << 16 | b2[i] << 8 | c[i]) / 16777215; return out; }
    var ra = u24(off); off += 3 * N; var de = u24(off); off += 3 * N;
    for (var i2 = 0; i2 < N; i2++) { ra[i2] *= 360; de[i2] = de[i2] * 180 - 90; }
    var ids = new Array(N), cur = 0n, j = 0;
    for (var k = 0; k < N; k++) { var v = 0n, sh = 0n, byte; do { byte = buf[off + j++]; v |= BigInt(byte & 127) << sh; sh += 7n; } while (byte & 128); cur += v; ids[k] = cur.toString(); }
    CAT = { N: N, cols: cols, ra: ra, de: de, ids: ids }; return CAT;
  })();
  return CATP;
}
function catVotes(i) { var v = {}; Object.keys(CAT.cols).forEach(function (f) { if (['q', 'pa', 'wind', 'nvotes', 'conc', 'r90', 'gr', 'z', 'fdev'].indexOf(f) < 0) v[f] = CAT.cols[f][i] / 15; }); return v; }
function catExtra(i) { var c = CAT.cols, o = {};
  if (c.conc[i]) o.conc = c.conc[i] / 60 + 1; if (c.r90[i]) o.r90 = c.r90[i] / 4; if (c.gr[i]) o.gr = c.gr[i] / 170 - 0.3; if (c.z[i]) o.z = c.z[i] / 800; if (c.fdev[i]) o.fdev = (c.fdev[i] - 1) / 254; return o; }
var CATSEL = null;
function showCat(i) {
  var v = catVotes(i), qb = CAT.cols.q[i], q = qb ? (qb - 1) / 254 : 0.8, pa = CAT.cols.pa[i] / 255 * 180, w = (CAT.cols.wind[i] << 24 >> 24) / 127;
  var ex = catExtra(i), res = fromVotes(v, q, pa, Math.abs(w) > 0.25 ? Math.sign(w) : 0, Number(BigInt(CAT.ids[i]) % 9973n) + 1, ex);
  clearReal(); CATSEL = i; P = res.p; sync(); req();
  var g = { votes: v, n: CAT.cols.nvotes[i], q: q, pa: pa, wind: Math.abs(w) > 0.25 ? w : 0 };
  var ra = CAT.ra[i].toFixed(5), de = CAT.de[i].toFixed(5);
  $('catinfo').innerHTML = '';
  var t = document.createElement('span'); t.textContent = 'Galaxy ' + CAT.ids[i] + ' at RA ' + ra + ', Dec ' + de + '. ' + describe(g, res).replace(' measured from the photo', ' from SDSS') + (Math.abs(w) > 0.25 ? ' (winding from Galaxy Zoo 1 votes)' : '') + (ex.gr != null ? ' Colour g−r ' + ex.gr.toFixed(2) + (ex.gr > 0.75 ? ', red and old' : ex.gr < 0.55 ? ', blue and star-forming' : '') + '.' : '') + (ex.conc ? ' Concentration ' + ex.conc.toFixed(2) + '.' : '') + (P.merger ? ' Drawn as a simulated ' + (P.mBulge > 0.5 ? 'dry ' : '') + 'merger.' : '') + ' ';
  var a = document.createElement('a'); a.href = 'https://skyserver.sdss.org/dr17/VisualTools/explore/summary?ra=' + ra + '&dec=' + de; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'See the real one on SkyServer ↗';
  $('catinfo').appendChild(t); $('catinfo').appendChild(a);
}
var TYPES = {
  'any': function () { return true; },
  'a spiral': function (i, c) { return c.spiral[i] > 10 && c.feat[i] > 9; },
  'barred': function (i, c) { return c.bar[i] > 11; },
  'edge-on': function (i, c) { return c.edge[i] > 12; },
  'smooth': function (i, c) { return c.smooth[i] > 12; },
  'merger': function (i, c) { return c.odd[i] > 9 && c.merger[i] > 9; },
  'ring': function (i, c) { return c.odd[i] > 9 && c.ring[i] > 10; },
  'irregular': function (i, c) { return c.odd[i] > 9 && c.irregular[i] > 9; },
  'many arms': function (i, c) { return c.spiral[i] > 10 && (c.amore[i] > 7 || c.a4[i] > 7); },
  'tight arms': function (i, c) { return c.spiral[i] > 10 && c.tight[i] > 10; },
  'loose arms': function (i, c) { return c.spiral[i] > 10 && c.loose[i] > 9; }
};
function randomOf(type) {
  loadCat().then(function (c) { var f = TYPES[type], tries = 0, i;
    do { i = Math.floor(Math.random() * c.N); tries++; } while (!f(i, c.cols) && tries < 400000);
    showCat(i); }).catch(function (e) { $('catinfo').textContent = e.message; });
}
function findGalaxy(text) {
  loadCat().then(function (c) {
    var t = text.trim(), m = t.match(/^(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)$/);
    if (/^\d{15,20}$/.test(t)) { var i = c.ids.indexOf(t); if (i >= 0) return showCat(i); $('catinfo').textContent = 'No Galaxy Zoo 2 galaxy with that DR7 objid.'; return; }
    if (m) { var ra = +m[1], de = +m[2], best = -1, bd = 1e9, cd = Math.cos(de * Math.PI / 180);
      for (var k = 0; k < c.N; k++) { var dx = (c.ra[k] - ra) * cd, dy = c.de[k] - de, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = k; } }
      if (Math.sqrt(bd) * 3600 < 60) return showCat(best); $('catinfo').textContent = 'No Galaxy Zoo 2 galaxy within 1 arcminute of that position.'; return; }
    $('catinfo').textContent = 'Type a DR7 objid, or RA and Dec in degrees, like 185.72, 15.82.';
  }).catch(function (e) { $('catinfo').textContent = e.message; });
}
(function () {
  var row = $('cattypes'); Object.keys(TYPES).forEach(function (k) { var b = document.createElement('button'); b.className = 'tb'; b.textContent = k === 'any' ? 'Any galaxy' : k; b.onclick = function () { randomOf(k); }; row.appendChild(b); });
  $('catgo').onclick = function () { findGalaxy($('catq').value); };
  $('catq').addEventListener('keydown', function (e) { if (e.key === 'Enter') findGalaxy($('catq').value); });
})();
buildControls();
(function orbit() {
  /* drag: orbit and tilt · two-finger pinch: zoom · two-finger twist: roll · shift- or right-drag: roll · keys: arrows, Q/E, +/−, 0 */
  var ptrs = new Map(), last2 = null, rolling = false;
  cv.style.touchAction = 'none'; cv.style.cursor = 'grab'; cv.tabIndex = 0;
  function roll(deg) { P.pa = ((P.pa + deg) % 360 + 360) % 360; }
  function angleAt(x, y) { var b = cv.getBoundingClientRect(); return Math.atan2(y - (b.top + b.height / 2), x - (b.left + b.width / 2)); }
  function two() { var a = Array.from(ptrs.values()); return { d: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), t: Math.atan2(a[1][1] - a[0][1], a[1][0] - a[0][0]) }; }
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  cv.addEventListener('pointerdown', function (e) {
    cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); cv.style.cursor = 'grabbing';
    rolling = ptrs.size === 1 && (e.shiftKey || e.button === 2); if (ptrs.size === 2) last2 = two();
  });
  cv.addEventListener('pointermove', function (e) {
    if (!ptrs.has(e.pointerId)) return; var prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) {
      if (rolling) { var da = angleAt(e.clientX, e.clientY) - angleAt(prev[0], prev[1]); da = Math.atan2(Math.sin(da), Math.cos(da)); roll(da * 180 / Math.PI); }
      else { var dx = e.clientX - prev[0], dy = e.clientY - prev[1]; P.az = ((P.az + dx * 0.45) % 360 + 360) % 360; P.incl = clamp(P.incl + dy * 0.45, 0, 180); }
      sync(); req();
    } else if (ptrs.size === 2 && last2) {
      var now = two(), dt = Math.atan2(Math.sin(now.t - last2.t), Math.cos(now.t - last2.t));
      if (last2.d) ZOOM = clamp(ZOOM * now.d / last2.d, 0.15, 12);           // pinch
      roll(dt * 180 / Math.PI);                                                // twist
      last2 = now; sync(); req();
    }
  });
  function up(e) { ptrs.delete(e.pointerId); if (ptrs.size === 2) last2 = two(); else last2 = null; if (!ptrs.size) { cv.style.cursor = 'grab'; rolling = false; } }
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  // trackpad pinch arrives as ctrl+wheel; a mouse wheel or two-finger scroll zooms gently
  cv.addEventListener('wheel', function (e) { e.preventDefault(); var k = e.ctrlKey ? 0.012 : 0.0015; ZOOM = clamp(ZOOM * Math.exp(-e.deltaY * k), 0.15, 12); req(); }, { passive: false });
  // Safari (Mac trackpad, iPhone, iPad): native pinch and twist
  var g0 = null;
  cv.addEventListener('gesturestart', function (e) { e.preventDefault(); g0 = { pa: P.pa, zoom: ZOOM }; });
  cv.addEventListener('gesturechange', function (e) { e.preventDefault(); if (!g0 || ptrs.size >= 2) return; P.pa = ((g0.pa + e.rotation) % 360 + 360) % 360; ZOOM = clamp(g0.zoom * e.scale, 0.15, 12); sync(); req(); });
  cv.addEventListener('gestureend', function (e) { e.preventDefault(); g0 = null; });
  cv.addEventListener('dblclick', function () { ZOOM = 1; req(); });
  cv.addEventListener('keydown', function (e) {
    var k = e.key, hit = true;
    if (k === 'ArrowLeft') P.az = ((P.az - 5) % 360 + 360) % 360; else if (k === 'ArrowRight') P.az = (P.az + 5) % 360;
    else if (k === 'ArrowUp') P.incl = clamp(P.incl - 4, 0, 180); else if (k === 'ArrowDown') P.incl = clamp(P.incl + 4, 0, 180);
    else if (k === 'q' || k === 'Q') roll(-5); else if (k === 'e' || k === 'E') roll(5);
    else if (k === '+' || k === '=') ZOOM = clamp(ZOOM * 1.15, 0.15, 12); else if (k === '-' || k === '_') ZOOM = clamp(ZOOM / 1.15, 0.15, 12);
    else if (k === '0') ZOOM = 1; else hit = false;
    if (hit) { e.preventDefault(); sync(); req(); }
  });
})();
window.__GEN = { zoom: function (z) { ZOOM = z; render(); }, var: function () { return { pool: VAR ? VAR.dotPool.slice(0, 400) : [] }; }, row: function (i) { return loadCat().then(function (c) { var o = { id: c.ids[i], ra: c.ra[i], de: c.de[i] }; Object.keys(c.cols).forEach(function (f) { o[f] = c.cols[f][i]; }); return o; }); }, cat: function (t) { randomOf(t || 'any'); }, find: function (t) { findGalaxy(t); }, catInfo: function () { return $('catinfo').textContent; }, P: function () { return P; }, set: function (o) { Object.assign(P, o); sync(); render(); }, stats: function () { return STATS; },
  preset: function (n) { clearReal(); P = Object.assign({}, DEF, PRESETS[n], { seed: P.seed }); sync(); render(); }, real: function (i) { showReal(i); render(); } };
})();
