/**
 * IEEE half-precision floats, round to nearest even: the CPU twin of WGSL's `pack2x16float` and
 * `unpack2x16float`, for the merger's f16 timeline snapshots (ADR 0009, 0011).
 */
const view = new DataView(new ArrayBuffer(4));

/** An f32 (or any number, rounded to f32 first) as the 16 bits of an f16, rounded to nearest even. */
export function toHalf(x: number): number {
  view.setFloat32(0, x);
  const b = view.getUint32(0);
  const sign = (b >>> 16) & 0x8000;
  const e8 = (b >>> 23) & 0xff;
  let m = b & 0x7fffff;
  if (e8 === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0);
  const e = e8 - 127 + 15;
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    // a subnormal half: shift the implicit one into the mantissa
    m |= 0x800000;
    const shift = 14 - e;
    const half = m >>> shift;
    const rem = m & ((1 << shift) - 1);
    const mid = 1 << (shift - 1);
    return sign | (rem > mid || (rem === mid && half & 1) ? half + 1 : half);
  }
  const h = sign | (e << 10) | (m >>> 13);
  const rem = m & 0x1fff;
  return rem > 0x1000 || (rem === 0x1000 && h & 1) ? h + 1 : h;
}

/** The value of 16 half-precision bits. */
export function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

/** `pack2x16float(vec2(a, b))`: a in the low half, b in the high half. */
export function packHalf2(a: number, b: number): number {
  return ((toHalf(b) << 16) | toHalf(a)) >>> 0;
}

/** `unpack2x16float(u)`. */
export function unpackHalf2(u: number): [number, number] {
  return [fromHalf(u & 0xffff), fromHalf(u >>> 16)];
}
