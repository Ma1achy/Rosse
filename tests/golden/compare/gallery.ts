/**
 * The review gallery (`npm run golden -- --gallery`): for every case, one image of v21's ink, the
 * WebGPU ink, the CPU engine's ink and the signed difference (WebGPU − v21), and an index sorted
 * worst-first. Written to tests/golden/actual/gallery (not committed). The ink is shown over the
 * plate's field colour so a case reads as the plate does.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type { Grey } from './metrics';

const PAPER: readonly [number, number, number] = [0xe6, 0xde, 0xce];
const INK: readonly [number, number, number] = [0.114 * 255, 0.106 * 255, 0.098 * 255];
/** The side of a block for the local error: finer than the golden runner's coarse density map. */
const BLOCK = 16;

/** The mean of each 2 × 2 block: the panels are half size. */
function half(a: Grey): Grey {
  const w = a.width >> 1;
  const h = a.height >> 1;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = 2 * y * a.width + 2 * x;
      out[y * w + x] =
        ((a.data[i] ?? 0) +
          (a.data[i + 1] ?? 0) +
          (a.data[i + a.width] ?? 0) +
          (a.data[i + a.width + 1] ?? 0)) /
        4;
    }
  return { width: w, height: h, data: out };
}

/**
 * How far the two inks are apart, block by block: the sum over BLOCK × BLOCK blocks of |Σα − Σα'|,
 * as a fraction of the reference's total ink. 0 is the same density everywhere, 2 is no overlap.
 * The golden runner's coarse SSIM is blind below its 16 px smoothing; this is not.
 */
export function localError(ref: Grey, render: Grey): number {
  const bw = Math.ceil(ref.width / BLOCK);
  const bh = Math.ceil(ref.height / BLOCK);
  const a = new Float64Array(bw * bh);
  const b = new Float64Array(bw * bh);
  for (let y = 0; y < ref.height; y++)
    for (let x = 0; x < ref.width; x++) {
      const k = (y >> 4) * bw + (x >> 4);
      a[k] = (a[k] ?? 0) + (ref.data[y * ref.width + x] ?? 0);
      b[k] = (b[k] ?? 0) + (render.data[y * ref.width + x] ?? 0);
    }
  let diff = 0;
  let total = 0;
  for (let k = 0; k < a.length; k++) {
    diff += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
    total += a[k] ?? 0;
  }
  return total > 0 ? diff / total : 0;
}

function plate(a: Grey, set: (i: number, r: number, g: number, b: number) => void, ox: number) {
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const v = Math.min(1, a.data[y * a.width + x] ?? 0);
      set(
        y * (4 * a.width) + ox + x,
        PAPER[0] * (1 - v) + INK[0] * v,
        PAPER[1] * (1 - v) + INK[1] * v,
        PAPER[2] * (1 - v) + INK[2] * v,
      );
    }
}

/** Writes `<name>.png`: v21 | WebGPU | CPU | difference, each at half size. */
export function writeGalleryImage(
  dir: string,
  name: string,
  ref: Grey,
  gpu: Grey | undefined,
  cpu: Grey,
): string {
  mkdirSync(dir, { recursive: true });
  const r = half(ref);
  const g = half(gpu ?? cpu);
  const c = half(cpu);
  const w = r.width;
  const h = r.height;
  const png = new PNG({ width: 4 * w, height: h });
  const set = (i: number, R: number, G: number, B: number) => {
    png.data[i * 4] = Math.round(R);
    png.data[i * 4 + 1] = Math.round(G);
    png.data[i * 4 + 2] = Math.round(B);
    png.data[i * 4 + 3] = 255;
  };
  plate(r, set, 0);
  plate(g, set, w);
  plate(c, set, 2 * w);
  // difference: red where the render has more ink than v21, blue where it has less
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = Math.max(
        -1,
        Math.min(1, 2 * ((g.data[y * w + x] ?? 0) - (r.data[y * w + x] ?? 0))),
      );
      const k = 255 * (1 - Math.abs(t));
      set(y * 4 * w + 3 * w + x, t >= 0 ? 255 : k, k, t >= 0 ? k : 255);
    }
  const file = `${name}.png`;
  writeFileSync(join(dir, file), PNG.sync.write(png));
  return file;
}

export interface GalleryRow {
  name: string;
  image: string;
  /** v21 against the WebGPU draw, one draw each */
  ink: number;
  ssimCoarse: number;
  local: number;
  /** WebGPU against the CPU engine */
  cpuLocal: number;
  pass: boolean;
}

/** Writes index.html: every case with its numbers, sortable, worst local error first. */
export function writeGalleryIndex(dir: string, rows: GalleryRow[]): string {
  mkdirSync(dir, { recursive: true });
  const sorted = [...rows].sort((a, b) => b.local - a.local);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = sorted
    .map(
      (r) =>
        `<section data-local="${r.local.toFixed(4)}" data-ssim="${r.ssimCoarse.toFixed(4)}" data-ink="${Math.abs(r.ink).toFixed(4)}" data-cpu="${r.cpuLocal.toFixed(4)}" data-name="${esc(r.name)}">` +
        `<h2>${esc(r.name)} <small class="${r.pass ? 'p' : 'f'}">${r.pass ? 'pass' : 'FAIL'}</small></h2>` +
        `<p>local error ${r.local.toFixed(3)} · coarse SSIM ${r.ssimCoarse.toFixed(3)} · ink ${(100 * r.ink).toFixed(1)}% · CPU vs GPU ${r.cpuLocal.toFixed(4)}</p>` +
        `<img loading="lazy" src="${esc(r.image)}" alt="${esc(r.name)}: v21, WebGPU, CPU, difference"></section>`,
    )
    .join('\n');
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Rosse gallery</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;background:#fff;color:#222}
section{margin:0 0 18px}h2{font-size:15px;margin:0}small.p{color:#070}small.f{color:#b00}
p{margin:2px 0 6px}img{max-width:100%;border:1px solid #ccc}
nav{position:sticky;top:0;background:#fff;padding:6px 0;border-bottom:1px solid #ccc}</style></head><body>
<nav>v21 | WebGPU | CPU | difference (red: more ink than v21, blue: less). Sort by:
<button data-k="local">local error</button> <button data-k="ssim">coarse SSIM</button>
<button data-k="ink">ink</button> <button data-k="cpu">CPU vs GPU</button> <button data-k="name">name</button>
 <input id="q" placeholder="filter by name"></nav>
<main>${body}</main>
<script>
const main=document.querySelector('main');
const secs=()=>[...main.children];
document.querySelectorAll('button').forEach(b=>b.onclick=()=>{
  const k=b.dataset.k;
  secs().sort((a,c)=>k==='name'?a.dataset.name.localeCompare(c.dataset.name):k==='ssim'?a.dataset.ssim-c.dataset.ssim:c.dataset[k]-a.dataset[k]).forEach(s=>main.append(s));
});
document.getElementById('q').oninput=e=>secs().forEach(s=>s.hidden=!s.dataset.name.includes(e.target.value));
</script></body></html>
`;
  const file = join(dir, 'index.html');
  writeFileSync(file, html);
  return file;
}
