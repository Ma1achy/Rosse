/**
 * A small GIF decoder for tests: an independent reading of the format (header, global palette,
 * extensions, image blocks, variable-width LZW), not the encoder's inverse by construction. Cross-
 * checked once against Pillow (docs/milestones/m12/README.md).
 */
export interface DecodedGif {
  width: number;
  height: number;
  palette: [number, number, number][];
  /** the NETSCAPE loop count (0 = forever), or null */
  loops: number | null;
  frames: { delayCs: number; pixels: Uint8Array }[];
}

export function decodeGif(bytes: Uint8Array): DecodedGif {
  let p = 0;
  const u8 = () => bytes[p++] as number;
  const u16 = () => u8() | (u8() << 8);
  const text = (n: number) => String.fromCharCode(...Array.from(bytes.subarray(p, (p += n))));
  if (text(6) !== 'GIF89a') throw new Error('not a GIF89a');
  const width = u16();
  const height = u16();
  const flags = u8();
  u8(); // background
  u8(); // aspect
  const palette: [number, number, number][] = [];
  if (flags & 0x80) {
    const n = 2 << (flags & 7);
    for (let i = 0; i < n; i++) palette.push([u8(), u8(), u8()]);
  }
  let loops: number | null = null;
  let delayCs = 0;
  const frames: DecodedGif['frames'] = [];
  const blocks = (): number[] => {
    const out: number[] = [];
    for (let n = u8(); n; n = u8()) for (let i = 0; i < n; i++) out.push(u8());
    return out;
  };
  for (;;) {
    const id = u8();
    if (id === 0x3b) break;
    if (id === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        u8(); // block size 4
        u8(); // packed
        delayCs = u16();
        u8(); // transparent index
        u8(); // terminator
      } else if (label === 0xff) {
        const n = u8();
        const app = text(n);
        const data = blocks();
        if (app === 'NETSCAPE2.0' && data[0] === 1) loops = (data[1] ?? 0) | ((data[2] ?? 0) << 8);
      } else blocks();
    } else if (id === 0x2c) {
      u16();
      u16();
      const w = u16();
      const h = u16();
      const local = u8();
      if (local & 0x80) throw new Error('local palettes are not used');
      const min = u8();
      const data = blocks();
      frames.push({ delayCs, pixels: lzw(data, min, w * h) });
    } else throw new Error(`unknown block ${id.toString(16)}`);
  }
  return { width, height, palette, loops, frames };
}

function lzw(data: number[], min: number, count: number): Uint8Array {
  const clear = 1 << min;
  const eoi = clear + 1;
  let cs = min + 1;
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < clear; i++) table.push([i]);
    table.push([], []);
    cs = min + 1;
  };
  reset();
  const out = new Uint8Array(count);
  let n = 0;
  let acc = 0;
  let nb = 0;
  let at = 0;
  let prev: number[] | null = null;
  for (;;) {
    while (nb < cs) {
      if (at >= data.length) return out.subarray(0, n);
      acc |= (data[at++] as number) << nb;
      nb += 8;
    }
    const code = acc & ((1 << cs) - 1);
    acc >>>= cs;
    nb -= cs;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (prev === null) entry = table[code] as number[];
    else if (code < table.length) entry = table[code] as number[];
    else if (code === table.length) entry = [...prev, prev[0] as number];
    else throw new Error('bad LZW code');
    for (const v of entry) if (n < count) out[n++] = v;
    if (prev !== null && table.length < 4096) {
      table.push([...prev, entry[0] as number]);
      if (table.length === 1 << cs && cs < 12) cs++;
    }
    prev = entry;
  }
  return out.subarray(0, n);
}
