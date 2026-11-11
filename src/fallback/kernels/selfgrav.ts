/**
 * The stars' pull on one another (ADR 0100), on the CPU. The GPU sums directly over the sources
 * (compute/merger.wgsl `self_gravity`, one thread per star, a tile of sources in shared memory);
 * here, where that sum would cost minutes, a Barnes–Hut octree over the same sources gives the same
 * field to about a percent in the time it takes to build and walk it.
 *
 * Sources are every `stride`th star, each carrying `stride` stars' mass, so the sum is over a
 * quarter of them; every star is a target and a source never pulls on itself. Softened:
 * `a_i = Σ_j w_j (x_j − x_i) / (|x_j − x_i|² + ε²)^(3/2)`. The tree works in f64 and the result is
 * rounded to f32, the engines' one place where the CPU does not follow the GPU operation by
 * operation (an approximation either way, not a rounding).
 */

const f = Math.fround;

/** The opening angle: a cell is a point when its size over its distance is below this. */
export const THETA = 0.7;

export interface SelfGravity {
  /** stars, the first of the second galaxy, the source stride */
  n: number;
  n0: number;
  stride: number;
  /** the mass of one star of each galaxy, and the softening squared */
  ms: readonly [number, number];
  eps2: number;
}

/** The exact sum, in f32 like the GPU's (tests, and small systems). Writes 4 words per star. */
export function selfGravityDirect(xs: Float32Array, S: SelfGravity, out: Float32Array): void {
  const e2 = f(S.eps2);
  for (let i = 0; i < S.n; i++) {
    const xi = xs[i * 4] as number;
    const yi = xs[i * 4 + 1] as number;
    const zi = xs[i * 4 + 2] as number;
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (let j = 0; j < S.n; j += S.stride) {
      if (j === i) continue;
      const w = f(f(S.stride) * f(S.ms[j >= S.n0 ? 1 : 0]));
      const dx = f((xs[j * 4] as number) - xi);
      const dy = f((xs[j * 4 + 1] as number) - yi);
      const dz = f((xs[j * 4 + 2] as number) - zi);
      const d2 = f(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz)) + e2);
      const k = f(w / f(d2 * f(Math.sqrt(d2))));
      ax = f(ax + f(dx * k));
      ay = f(ay + f(dy * k));
      az = f(az + f(dz * k));
    }
    out[i * 4] = ax;
    out[i * 4 + 1] = ay;
    out[i * 4 + 2] = az;
    out[i * 4 + 3] = 0;
  }
}

/** A reusable octree over the sources. */
export class SelfTree {
  private cap = 0;
  /** per node: mass, mass-weighted position sums, half width and the centre of the cell */
  private m = new Float64Array(0);
  private cx = new Float64Array(0);
  private cy = new Float64Array(0);
  private cz = new Float64Array(0);
  private h = new Float64Array(0);
  private ox = new Float64Array(0);
  private oy = new Float64Array(0);
  private oz = new Float64Array(0);
  /** the eight children of a node (0 = none) and, for a leaf, its source (−1 = none) */
  private kid = new Int32Array(0);
  private leaf = new Int32Array(0);
  private count = 0;
  private readonly stack = new Int32Array(1024);
  private pk = new Float64Array(0);
  /** per node the second moments Σ w x_a x_b about the origin: xx yy zz xy xz yz */
  private q2 = new Float64Array(0);
  /** the weight of source j, by star index */
  private w = new Float64Array(0);

  private grow(n: number): void {
    if (n <= this.cap) return;
    const cap = Math.max(n, this.cap * 2, 1024);
    const g64 = (a: Float64Array) => {
      const b = new Float64Array(cap);
      b.set(a);
      return b;
    };
    this.m = g64(this.m);
    this.cx = g64(this.cx);
    this.cy = g64(this.cy);
    this.cz = g64(this.cz);
    this.h = g64(this.h);
    this.ox = g64(this.ox);
    this.oy = g64(this.oy);
    this.oz = g64(this.oz);
    const k = new Int32Array(cap * 8);
    k.set(this.kid);
    this.kid = k;
    const l = new Int32Array(cap);
    l.set(this.leaf);
    this.leaf = l;
    const q = new Float64Array(cap * 6);
    q.set(this.q2);
    this.q2 = q;
    this.cap = cap;
  }

  private node(ox: number, oy: number, oz: number, h: number): number {
    const i = this.count++;
    this.grow(this.count);
    this.m[i] = 0;
    this.cx[i] = 0;
    this.cy[i] = 0;
    this.cz[i] = 0;
    this.h[i] = h;
    this.ox[i] = ox;
    this.oy[i] = oy;
    this.oz[i] = oz;
    this.leaf[i] = -1;
    this.q2.fill(0, i * 6, i * 6 + 6);
    this.kid.fill(0, i * 8, i * 8 + 8);
    return i;
  }

  private child(nd: number, x: number, y: number, z: number): number {
    const o =
      (x > (this.ox[nd] as number) ? 1 : 0) +
      (y > (this.oy[nd] as number) ? 2 : 0) +
      (z > (this.oz[nd] as number) ? 4 : 0);
    let k = this.kid[nd * 8 + o] as number;
    if (!k) {
      const hh = (this.h[nd] as number) / 2;
      k = this.node(
        (this.ox[nd] as number) + (o & 1 ? hh : -hh),
        (this.oy[nd] as number) + (o & 2 ? hh : -hh),
        (this.oz[nd] as number) + (o & 4 ? hh : -hh),
        hh,
      );
      this.kid[nd * 8 + o] = k;
    }
    return k;
  }

  private put(nd: number, xs: Float32Array, j: number): void {
    const w = this.w[j] as number;
    this.m[nd] = w;
    this.cx[nd] = w * (xs[j * 4] as number);
    this.cy[nd] = w * (xs[j * 4 + 1] as number);
    this.cz[nd] = w * (xs[j * 4 + 2] as number);
    this.leaf[nd] = j;
    this.addQ(nd, w, xs[j * 4] as number, xs[j * 4 + 1] as number, xs[j * 4 + 2] as number);
  }

  private addQ(nd: number, w: number, x: number, y: number, z: number): void {
    const o = nd * 6;
    const q = this.q2;
    q[o] = (q[o] as number) + w * x * x;
    q[o + 1] = (q[o + 1] as number) + w * y * y;
    q[o + 2] = (q[o + 2] as number) + w * z * z;
    q[o + 3] = (q[o + 3] as number) + w * x * y;
    q[o + 4] = (q[o + 4] as number) + w * x * z;
    q[o + 5] = (q[o + 5] as number) + w * y * z;
  }

  private insert(xs: Float32Array, j: number): void {
    const x = xs[j * 4] as number;
    const y = xs[j * 4 + 1] as number;
    const z = xs[j * 4 + 2] as number;
    const w = this.w[j] as number;
    let nd = 0;
    for (let depth = 0; ; depth++) {
      if ((this.m[nd] as number) === 0 && (this.leaf[nd] as number) < 0) {
        this.put(nd, xs, j);
        return;
      }
      const lf = this.leaf[nd] as number;
      if (lf >= 0) {
        if (depth >= 40) {
          // coincident sources share a cell
          this.m[nd] = (this.m[nd] as number) + w;
          this.cx[nd] = (this.cx[nd] as number) + w * x;
          this.cy[nd] = (this.cy[nd] as number) + w * y;
          this.cz[nd] = (this.cz[nd] as number) + w * z;
          this.addQ(nd, w, x, y, z);
          return;
        }
        // split the leaf: its source moves into the child it belongs to
        this.leaf[nd] = -1;
        this.put(
          this.child(nd, xs[lf * 4] as number, xs[lf * 4 + 1] as number, xs[lf * 4 + 2] as number),
          xs,
          lf,
        );
      }
      this.m[nd] = (this.m[nd] as number) + w;
      this.cx[nd] = (this.cx[nd] as number) + w * x;
      this.cy[nd] = (this.cy[nd] as number) + w * y;
      this.cz[nd] = (this.cz[nd] as number) + w * z;
      this.addQ(nd, w, x, y, z);
      nd = this.child(nd, x, y, z);
    }
  }

  /** Builds the tree over the sources of `xs` and writes the field at every star into `out`. */
  field(xs: Float32Array, S: SelfGravity, out: Float32Array): void {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    if (this.w.length < S.n) this.w = new Float64Array(S.n);
    for (let j = 0; j < S.n; j += S.stride) {
      this.w[j] = S.stride * S.ms[j >= S.n0 ? 1 : 0];
      for (let d = 0; d < 3; d++) {
        const v = xs[j * 4 + d] as number;
        if (v < (lo[d] as number)) lo[d] = v;
        if (v > (hi[d] as number)) hi[d] = v;
      }
    }
    if (!Number.isFinite(lo[0])) {
      out.fill(0);
      return;
    }
    let half = 1e-6;
    const mid = [0, 1, 2].map((d) => ((hi[d] as number) + (lo[d] as number)) / 2);
    for (let d = 0; d < 3; d++) half = Math.max(half, ((hi[d] as number) - (lo[d] as number)) / 2);
    half *= 1.0001;
    this.count = 0;
    this.node(mid[0] as number, mid[1] as number, mid[2] as number, half);
    for (let j = 0; j < S.n; j += S.stride) this.insert(xs, j);
    // the walk's data packed per node: centre of mass, mass, the squared cell width over θ² (−1
    // for a leaf, which is always a point), then the second moments about the centre of mass
    const W = 15;
    const cnt = this.count;
    if (this.pk.length < cnt * W) this.pk = new Float64Array(cnt * W * 2);
    const pk = this.pk;
    const th2 = THETA * THETA;
    for (let nd = 0; nd < cnt; nd++) {
      const mm = this.m[nd] as number;
      const inv = mm > 0 ? 1 / mm : 0;
      const o = nd * W;
      const cx = (this.cx[nd] as number) * inv;
      const cy = (this.cy[nd] as number) * inv;
      const cz = (this.cz[nd] as number) * inv;
      pk[o] = cx;
      pk[o + 1] = cy;
      pk[o + 2] = cz;
      pk[o + 3] = mm;
      pk[o + 4] = (this.leaf[nd] as number) >= 0 ? -1 : (4 * (this.h[nd] as number) ** 2) / th2;
      const q = nd * 6;
      pk[o + 5] = (this.q2[q] as number) - mm * cx * cx;
      pk[o + 6] = (this.q2[q + 1] as number) - mm * cy * cy;
      pk[o + 7] = (this.q2[q + 2] as number) - mm * cz * cz;
      pk[o + 8] = (this.q2[q + 3] as number) - mm * cx * cy;
      pk[o + 9] = (this.q2[q + 4] as number) - mm * cx * cz;
      pk[o + 10] = (this.q2[q + 5] as number) - mm * cy * cz;
      // the cell's box, for the test that a node holding the target is always opened
      pk[o + 11] = this.ox[nd] as number;
      pk[o + 12] = this.oy[nd] as number;
      pk[o + 13] = this.oz[nd] as number;
      pk[o + 14] = this.h[nd] as number;
    }
    const kid = this.kid;
    const leaf = this.leaf;
    const stack = this.stack;
    const e2 = S.eps2;
    for (let i = 0; i < S.n; i++) {
      const xi = xs[i * 4] as number;
      const yi = xs[i * 4 + 1] as number;
      const zi = xs[i * 4 + 2] as number;
      const self = i % S.stride === 0 ? i : -2;
      let ax = 0;
      let ay = 0;
      let az = 0;
      let sp = 0;
      stack[sp++] = 0;
      while (sp > 0) {
        const nd = stack[--sp] as number;
        const o = nd * W;
        const mm = pk[o + 3] as number;
        if (mm === 0) continue;
        const dx = (pk[o] as number) - xi;
        const dy = (pk[o + 1] as number) - yi;
        const dz = (pk[o + 2] as number) - zi;
        const d2 = dx * dx + dy * dy + dz * dz;
        const open = pk[o + 4] as number;
        let quad = false;
        if (open >= 0) {
          const hb = pk[o + 14] as number;
          if (
            open >= d2 ||
            (Math.abs(xi - (pk[o + 11] as number)) <= hb &&
              Math.abs(yi - (pk[o + 12] as number)) <= hb &&
              Math.abs(zi - (pk[o + 13] as number)) <= hb)
          ) {
            const k8 = nd * 8;
            for (let c = 0; c < 8; c++) {
              const k = kid[k8 + c] as number;
              if (k) stack[sp++] = k;
            }
            continue;
          }
          quad = true;
        } else if ((leaf[nd] as number) === self) continue;
        const q = d2 + e2;
        const k = mm / (q * Math.sqrt(q));
        ax += dx * k;
        ay += dy * k;
        az += dz * k;
        if (quad) {
          // the quadrupole: a = (3 I r − tr(I) r) / D^5/2 − 5/2 (3 rIr − tr(I) D) r / D^7/2, r = x − c
          const ixx = pk[o + 5] as number;
          const iyy = pk[o + 6] as number;
          const izz = pk[o + 7] as number;
          const ixy = pk[o + 8] as number;
          const ixz = pk[o + 9] as number;
          const iyz = pk[o + 10] as number;
          const rx = -dx;
          const ry = -dy;
          const rz = -dz;
          const ux = ixx * rx + ixy * ry + ixz * rz;
          const uy = ixy * rx + iyy * ry + iyz * rz;
          const uz = ixz * rx + iyz * ry + izz * rz;
          const tr = ixx + iyy + izz;
          const rIr = rx * ux + ry * uy + rz * uz;
          // softened like the monopole: the quadrupole of a cell much smaller than ε must not blow up
          const i5 = 1 / (q * q * Math.sqrt(q));
          const c1 = 3 * i5;
          const c2 = (2.5 * (3 * rIr - tr * q) * i5) / q;
          ax += c1 * ux - (tr * i5 + c2) * rx;
          ay += c1 * uy - (tr * i5 + c2) * ry;
          az += c1 * uz - (tr * i5 + c2) * rz;
        }
      }
      out[i * 4] = f(ax);
      out[i * 4 + 1] = f(ay);
      out[i * 4 + 2] = f(az);
      out[i * 4 + 3] = 0;
    }
  }
}
