/**
 * Sine and cosine in f32 from + − × only, the twins of `sin_f` and `cos_f` in
 * src/shaders/common/math.wgsl (ADR 0004, L1).
 *
 * WGSL allows its built-in `sin` and `cos` an absolute error of 2⁻¹¹ (ADR 0004): at the 20 or so
 * galaxy units the stipple reaches, that is up to a plate pixel. These are Cephes' `sinf` and
 * `cosf` (Moshier): reduction by π/4 in three parts, then minimax polynomials, accurate to about
 * 1 ULP for |x| < 8192. Built from correctly rounded additions and multiplications only, they
 * give the same bits on the GPU and on the CPU (fused multiply-add aside).
 */
import { randF32 } from './rng';

const f = Math.fround;
const TWO_PI = f(2 * Math.PI);

const FOPI = f(1.27323954473516);
const DP1 = f(0.78515625);
const DP2 = f(2.4187564849853516e-4);
const DP3 = f(3.774894977445941e-8);

const S1 = f(-1.9515295891e-4);
const S2 = f(8.3321608736e-3);
const S3 = f(-1.6666654611e-1);
const C1 = f(2.443315711809948e-5);
const C2 = f(-1.388731625493765e-3);
const C3 = f(4.166664568298827e-2);

function sinPoly(x: number, z: number): number {
  return f(f(f(f(f(f(f(f(S1 * z) + S2) * z) + S3) * z) * x) + x));
}

function cosPoly(z: number): number {
  return f(f(f(f(f(f(f(f(C1 * z) + C2) * z) + C3) * z) * z) - f(f(0.5) * z)) + 1);
}

/** Octant and reduced argument of |x|. */
function reduce(ax: number): [number, number] {
  let j = Math.trunc(f(FOPI * ax));
  let y = f(j);
  if (j & 1) {
    j += 1;
    y = f(y + 1);
  }
  const r = f(f(f(ax - f(y * DP1)) - f(y * DP2)) - f(y * DP3));
  return [j & 7, r];
}

export function sinF(x: number): number {
  let sign = x < 0 ? -1 : 1;
  const [j0, r] = reduce(Math.abs(x));
  let j = j0;
  if (j > 3) {
    sign = -sign;
    j -= 4;
  }
  const z = f(r * r);
  const y = j === 1 || j === 2 ? cosPoly(z) : sinPoly(r, z);
  return sign < 0 ? -y : y;
}

export function cosF(x: number): number {
  let sign = 1;
  const [j0, r] = reduce(Math.abs(x));
  let j = j0;
  if (j > 3) {
    j -= 4;
    sign = -sign;
  }
  if (j > 1) sign = -sign;
  const z = f(r * r);
  const y = j === 1 || j === 2 ? sinPoly(r, z) : cosPoly(z);
  return sign < 0 ? -y : y;
}

/** tan as sin / cos (only used for pitch angles, 4–70°). */
export function tanF(x: number): number {
  return f(sinF(x) / cosF(x));
}

/**
 * A standard normal from draws `draw` and `draw + 1`, as `randGauss` in ./rng.ts but with `cosF`:
 * the twin of `rand_gauss_f` in src/shaders/common/math.wgsl.
 */
export function randGaussF(seed: number, stream: number, index: number, draw: number): number {
  const u1 = randF32(seed, stream, index, draw);
  const u2 = randF32(seed, stream, index, (draw + 1) >>> 0);
  const r = f(Math.sqrt(f(f(-2) * f(Math.log(f(1 - u1))))));
  return f(r * cosF(f(TWO_PI * u2)));
}
