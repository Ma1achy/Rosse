/**
 * The deep field's lens as the CPU reads it (ADR 0097, 0101): the primary image of a plate point.
 * Twin of `lens_image` and `lens_pos` in common/lens-sky.wgsl; its own file so the vector kernel
 * (a lensed drawing's every vertex) and the sky kernel (the dots and rows) share it.
 */
import { PLATE } from '../../view/camera';
import type { SkyLens } from '../../sim/lens';
import { deflectF } from './lens';

const f = Math.fround;
const sqrt = (x: number) => f(Math.sqrt(x));
type M2 = [number, number, number, number];

/** The Newton steps and the floor on |det A| of `lensImage`; sky.wgsl `lens_image` carries the same. */
export const LENS_STEPS = 5;
export const LENS_DET_MIN = 0.15;
const LENS_STEP_MAX = 0.4;
const LENS_H = 0.01;

/**
 * The primary image of the plate point (px, py) seen through the lens (ADR 0097): the point is
 * a source β, its image θ solves θ − α(θ) = β by damped Newton steps from θ = β + α(β), and a
 * shape at the source is stretched by A⁻¹ there. `m` is the plate-space map (column-major) taking
 * a shape at the source to its image; the position is where the image sits.
 */
export function lensImage(
  L: SkyLens,
  px: number,
  py: number,
  withMap = true,
): { x: number; y: number; m: M2 } {
  const d = L.desc;
  const cw = L.cos;
  const sw = L.sin;
  const dx = f(f(px - PLATE / 2) / L.scale);
  const dy = f(f(py - PLATE / 2) / L.scale);
  const bx = f(f(dx * cw) + f(dy * sw));
  const by = f(f(f(-dx) * sw) + f(dy * cw));
  const a0 = deflectF(d, bx, by);
  let tx = f(bx + a0[0]);
  let ty = f(by + a0[1]);
  const jac = (x: number, y: number) => {
    const a = deflectF(d, x, y);
    const ax = deflectF(d, f(x + LENS_H), y);
    const ay = deflectF(d, x, f(y + LENS_H));
    return {
      a,
      A11: f(1 - f(f(ax[0] - a[0]) / LENS_H)),
      A12: f(-f(f(ay[0] - a[0]) / LENS_H)),
      A21: f(-f(f(ax[1] - a[1]) / LENS_H)),
      A22: f(1 - f(f(ay[1] - a[1]) / LENS_H)),
    };
  };
  for (let i = 0; i < LENS_STEPS; i++) {
    const J = jac(tx, ty);
    const rx = f(f(tx - J.a[0]) - bx);
    const ry = f(f(ty - J.a[1]) - by);
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
  const at: [number, number] = [
    f(PLATE / 2 + f(L.scale * f(f(tx * cw) - f(ty * sw)))),
    f(PLATE / 2 + f(L.scale * f(f(tx * sw) + f(ty * cw)))),
  ];
  if (!withMap) return { x: at[0], y: at[1], m: [1, 0, 0, 1] };
  const J = jac(tx, ty);
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
