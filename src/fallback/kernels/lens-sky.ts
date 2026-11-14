/**
 * The deep field's lens as the CPU reads it (ADR 0097, 0101): the primary image of a plate point.
 * Twin of `lens_image` and `lens_pos` in common/lens-sky.wgsl; its own file so the vector kernel
 * (a lensed drawing's every vertex) and the sky kernel (the dots and rows) share it.
 */
import { PLATE } from '../../view/camera';
import { lensDepthK, type SkyLens } from '../../sim/lens';
import { deflectF } from './lens';

const f = Math.fround;
const sqrt = (x: number) => f(Math.sqrt(x));
type M2 = [number, number, number, number];

/** The Newton steps and the floor on |det A| of `lensImage`; sky.wgsl `lens_image` carries the same. */
export const LENS_STEPS = 5;
export const LENS_DET_MIN = 0.15;
const LENS_STEP_MAX = 0.4;
const LENS_H = 0.01;

/** A counter-image is accepted when its lens equation holds to this (lens units) ... */
export const LENS_CONV = 0.005;
/** ... and it lies at least this far (lens units) from the primary image. */
export const LENS_SEP = 0.05;

interface Solved {
  /** the image θ, the source β, in lens units */
  t: [number, number];
  b: [number, number];
  defl: (x: number, y: number) => [number, number];
  jac: (
    x: number,
    y: number,
  ) => { a: [number, number]; A11: number; A12: number; A21: number; A22: number };
}

/** The lens equation at the plate point (px, py), for a source at depth factor `kz`. */
function lensSetup(L: SkyLens, px: number, py: number, kz: number) {
  const d = L.desc;
  // the deflection, scaled for the object's depth (`lensDepthK`); twin of `sky_deflect`'s `* kz`
  const defl = (x: number, y: number): [number, number] => {
    const a = deflectF(d, x, y);
    return kz === 1 ? a : [f(a[0] * kz), f(a[1] * kz)];
  };
  const cw = L.cos;
  const sw = L.sin;
  const dx = f(f(px - PLATE / 2) / L.scale);
  const dy = f(f(py - PLATE / 2) / L.scale);
  const b: [number, number] = [f(f(dx * cw) + f(dy * sw)), f(f(f(-dx) * sw) + f(dy * cw))];
  const jac = (x: number, y: number) => {
    const a = defl(x, y);
    const ax = defl(f(x + LENS_H), y);
    const ay = defl(x, f(y + LENS_H));
    return {
      a,
      A11: f(1 - f(f(ax[0] - a[0]) / LENS_H)),
      A12: f(-f(f(ay[0] - a[0]) / LENS_H)),
      A21: f(-f(f(ax[1] - a[1]) / LENS_H)),
      A22: f(1 - f(f(ay[1] - a[1]) / LENS_H)),
    };
  };
  return { b, defl, jac };
}

/** Damped Newton steps on θ − α(θ) = β from `start` (twin of `lens_newton`). */
function newton(S: Pick<Solved, 'b' | 'jac'>, start: [number, number]): [number, number] {
  let tx = start[0];
  let ty = start[1];
  for (let i = 0; i < LENS_STEPS; i++) {
    const J = S.jac(tx, ty);
    const rx = f(f(tx - J.a[0]) - S.b[0]);
    const ry = f(f(ty - J.a[1]) - S.b[1]);
    let det = f(f(J.A11 * J.A22) - f(J.A12 * J.A21));
    if (Math.abs(det) < LENS_DET_MIN) det = det < 0 ? -LENS_DET_MIN : LENS_DET_MIN;
    let sx = f(f(f(J.A22 * rx) - f(J.A12 * ry)) / det);
    let sy = f(f(f(-f(J.A21 * rx)) + f(J.A11 * ry)) / det);
    const sl = sqrt(f(f(sx * sx) + f(sy * sy)));
    if (sl > LENS_STEP_MAX) {
      const k = f(LENS_STEP_MAX / sl);
      sx = f(sx * k);
      sy = f(sy * k);
    }
    tx = f(tx - sx);
    ty = f(ty - sy);
  }
  return [tx, ty];
}

/** The image at θ = `t` as the plate place and the plate-space map A⁻¹ (column-major). */
function imageAt(
  L: SkyLens,
  S: Pick<Solved, 'jac'>,
  t: [number, number],
  withMap: boolean,
): { x: number; y: number; m: M2 } {
  const cw = L.cos;
  const sw = L.sin;
  const at: [number, number] = [
    f(PLATE / 2 + f(L.scale * f(f(t[0] * cw) - f(t[1] * sw)))),
    f(PLATE / 2 + f(L.scale * f(f(t[0] * sw) + f(t[1] * cw)))),
  ];
  if (!withMap) return { x: at[0], y: at[1], m: [1, 0, 0, 1] };
  const J = S.jac(t[0], t[1]);
  let det = f(f(J.A11 * J.A22) - f(J.A12 * J.A21));
  if (Math.abs(det) < LENS_DET_MIN) det = det < 0 ? -LENS_DET_MIN : LENS_DET_MIN;
  const M11 = f(J.A22 / det);
  const M12 = f(-J.A12 / det);
  const M21 = f(-J.A21 / det);
  const M22 = f(J.A11 / det);
  const S11 = f(f(cw * f(f(M11 * cw) - f(M12 * sw))) - f(sw * f(f(M21 * cw) - f(M22 * sw))));
  const S12 = f(f(cw * f(f(M11 * sw) + f(M12 * cw))) - f(sw * f(f(M21 * sw) + f(M22 * cw))));
  const S21 = f(f(sw * f(f(M11 * cw) - f(M12 * sw))) + f(cw * f(f(M21 * cw) - f(M22 * sw))));
  const S22 = f(f(sw * f(f(M11 * sw) + f(M12 * cw))) + f(cw * f(f(M21 * sw) + f(M22 * cw))));
  return { x: at[0], y: at[1], m: [S11, S21, S12, S22] };
}

/**
 * The primary image of the plate point (px, py) seen through the lens (ADR 0097): the point is
 * a source β, its image θ solves θ − α(θ) = β by damped Newton steps from θ = β + α(β), and a
 * shape at the source is stretched by A⁻¹ there. `m` is the plate-space map (column-major) taking
 * a shape at the source to its image; the position is where the image sits. `kz` is the object's
 * share of the lens (`lensDepthK`, ADR 0102).
 */
export function lensImage(
  L: SkyLens,
  px: number,
  py: number,
  withMap = true,
  kz = 1,
): { x: number; y: number; m: M2 } {
  const S = lensSetup(L, px, py, kz);
  const a0 = S.defl(S.b[0], S.b[1]);
  const t = newton(S, [f(S.b[0] + a0[0]), f(S.b[1] + a0[1])]);
  return imageAt(L, S, t, withMap);
}

/**
 * The counter-image of the plate point (ADR 0103): the second root of the lens equation, on the
 * far side of the lens, which a source inside the caustic has (for a lens whose deflection has a
 * constant size, θ = β − α(β) is it exactly). Found by the same Newton steps from θ = β − α(β);
 * null when they do not reach a root (the lens equation to `LENS_CONV`) or reach the primary
 * image (within `LENS_SEP`): the source has no counter-image. Its map A⁻¹ has a negative
 * determinant, so a drawing there is mirrored, as it is.
 */
export function lensCounter(
  L: SkyLens,
  px: number,
  py: number,
  withMap = true,
  kz = 1,
): { x: number; y: number; m: M2 } | null {
  const S = lensSetup(L, px, py, kz);
  const a0 = S.defl(S.b[0], S.b[1]);
  const prim = newton(S, [f(S.b[0] + a0[0]), f(S.b[1] + a0[1])]);
  const t = newton(S, [f(S.b[0] - a0[0]), f(S.b[1] - a0[1])]);
  const a = S.defl(t[0], t[1]);
  const res = sqrt(f(f(f(t[0] - a[0] - S.b[0]) ** 2) + f(f(t[1] - a[1] - S.b[1]) ** 2)));
  const sep = sqrt(f(f(f(t[0] - prim[0]) ** 2) + f(f(t[1] - prim[1]) ** 2)));
  if (!(res < LENS_CONV) || !(sep > LENS_SEP)) return null;
  return imageAt(L, S, t, withMap);
}

export { lensDepthK };
