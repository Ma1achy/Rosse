/**
 * The tidal map (ADR 0009, 0004 L1, 0011): compute/tide.wgsl (the bins, the 49 × 49 grids) and
 * compute/tide-apply.wgsl (a merging galaxy's marks carried by the tides, torn where stretched) on
 * the GPU against their CPU twin (src/fallback/kernels/tide.ts), on the same synthetic stars: two
 * discs of 4,000 and 3,000 stars whose plate positions are a smooth tidal distortion of their initial
 * coordinates, with a tail flung out and a few stars left alone, so that the 4-nearest search runs
 * over empty cells, full ones and ties.
 *
 * Compared word for word: the bins (exact), the grids (f32 within 1e-3 px, and how many vertices
 * differ at all), then 6,000 instances, 3,000 ribbon segments and 3,000 capsules carried by the grids.
 */
import { readBuffer } from '../../src/gpu/readback';
import {
  TIDE_GV,
  TideData,
  tideWords,
  warpCaps,
  warpInstances,
  warpRibbons,
} from '../../src/fallback/kernels/tide';
import { GpuTide, GpuTideMap } from '../../src/render/tide';
import { device, run } from './harness';
import { adapterName } from './harness';

const N0 = 4000;
const N = 7000;

/** A small deterministic generator for the stars (not the engine's RNG). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    s ^= s >>> 12;
    return (s >>> 0) / 4294967296;
  };
}

run('tidal map and carried marks (GPU = CPU twin, L1)', async () => {
  const { adapter, device: dev } = await device();
  const lines: string[] = [`adapter: ${adapterName(adapter)}`];
  const r = rng(7);
  // the initial coordinates (DX, DY, R0, 0), uniform in discs of radius up to 1, and the plate
  const ic = new Float32Array(N * 4);
  const scr = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const R = Math.sqrt(r()) * (i < N0 ? 1 : 0.8);
    const th = r() * 6.2832;
    const x = R * Math.cos(th);
    const y = R * Math.sin(th);
    ic.set([x, y, R, 0], i * 4);
    // a shear and a swirl, a tail flung out for the outer stars, and a few stars far away
    const sw = 0.6 * R * R;
    const px =
      400 + 120 * (x * Math.cos(sw) - y * Math.sin(sw)) + 40 * y + (R > 0.85 ? 90 * r() : 0);
    const py = 400 + 120 * (x * Math.sin(sw) + y * Math.cos(sw)) + (i < N0 ? 0 : 60);
    scr.set(i % 997 === 0 ? [r() * 800, r() * 800] : [px, py], i * 2);
  }
  const icBuf = dev.createBuffer({
    size: N * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(icBuf, 0, ic);

  // the CPU's map
  const cpu = new TideData(N, N0);
  cpu.setInitial(ic);
  cpu.buildBins();
  cpu.setScreen(scr);
  cpu.buildGrid();

  // the GPU's: the bins from the initial coordinates, the stars' plate positions written to its table
  const map = GpuTideMap.create(dev);
  const buf = map.load(N, N0, icBuf);
  const L = tideWords(N);
  const table = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) table.set([scr[i * 2] as number, scr[i * 2 + 1] as number], i * 4);
  // only the first two words of each star's four are the plate position: write them one by one
  for (let i = 0; i < N; i++)
    dev.queue.writeBuffer(buf, (L.starOff + i * 4) * 4, table.subarray(i * 4, i * 4 + 2));
  const enc = dev.createCommandEncoder();
  const gp = enc.beginComputePass();
  map.encodeGrid(gp);
  gp.end();
  dev.queue.submit([enc.finish()]);
  const words = new Uint32Array(await readBuffer(dev, buf, L.total * 4));
  const fl = new Float32Array(words.buffer);

  // bins: exactly the same words
  let binDiff = 0;
  for (let k = L.offOff; k < L.gridOff; k++) if (words[k] !== cpu.words[k]) binDiff++;
  // grids
  let gridMax = 0;
  let gridDiff = 0;
  const nGrid = 2 * TIDE_GV * TIDE_GV;
  for (let v = 0; v < nGrid; v++) {
    const dx = Math.hypot(
      (fl[L.gridOff + v * 2] as number) - (cpu.fl[L.gridOff + v * 2] as number),
      (fl[L.gridOff + v * 2 + 1] as number) - (cpu.fl[L.gridOff + v * 2 + 1] as number),
    );
    gridMax = Math.max(gridMax, dx);
    if (dx > 0) gridDiff++;
  }
  lines.push(
    `bins: ${String(binDiff)} words differ of ${String(L.gridOff - L.offOff)}`,
    `grids: ${String(gridDiff)} of ${String(nGrid)} vertices differ, max ${gridMax.toExponential(1)} px`,
  );

  // the passes that carry marks, on the grids
  const g = 1;
  const r2 = 520;
  const apply = GpuTide.create(dev);
  const mk = (n: number, words: number) => {
    const a = new Float32Array(new ArrayBuffer(n * words * 4));
    for (let i = 0; i < a.length; i++) a[i] = 280 + r() * 240;
    return a;
  };
  const inst = mk(6000, 8);
  const segs = mk(3000, 12);
  // ribbon segments are four corners of one stroke: a short step along it, a width across
  for (let i = 0; i < 3000; i++) {
    const x = 300 + r() * 200;
    const y = 300 + r() * 200;
    const a = r() * 6.28;
    const L2 = 2 + r() * 8;
    const w = 1 + r() * 3;
    const tx = Math.cos(a);
    const ty = Math.sin(a);
    segs.set([x - ty * w, y + tx * w, x + ty * w, y - tx * w], i * 12);
    segs.set(
      [x + tx * L2 - ty * w, y + ty * L2 + tx * w, x + tx * L2 + ty * w, y + ty * L2 - tx * w],
      i * 12 + 4,
    );
    segs[i * 12 + 11] = 1;
  }
  const caps = mk(3000, 8);
  for (let i = 0; i < 3000; i++) {
    const x = 300 + r() * 200;
    const y = 300 + r() * 200;
    const a = r() * 6.28;
    const len = 1 + r() * 20;
    caps.set([x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 1, 1, 0, 0], i * 8);
  }
  const upload = (a: Float32Array<ArrayBuffer>) => {
    const b = dev.createBuffer({
      size: a.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(b, 0, a);
    return b;
  };
  const bi = upload(inst);
  const bs = upload(segs);
  const bc = upload(caps);
  const e2 = dev.createCommandEncoder();
  const p2 = e2.beginComputePass();
  apply.encode(p2, buf, { key: 'i', entry: 'warp_instances', buffer: bi, n: 6000, g, r2 });
  apply.encode(p2, buf, { key: 's', entry: 'warp_ribbons', buffer: bs, n: 3000, g, r2 });
  apply.encode(p2, buf, { key: 'c', entry: 'warp_caps', buffer: bc, n: 3000, g, r2 });
  p2.end();
  dev.queue.submit([e2.finish()]);
  const gi = new Float32Array(await readBuffer(dev, bi, inst.byteLength));
  const gs = new Float32Array(await readBuffer(dev, bs, segs.byteLength));
  const gc = new Float32Array(await readBuffer(dev, bc, caps.byteLength));
  // the CPU twin on the same grids (the GPU's words, so only the carrying is compared)
  const same = new TideData(N, N0);
  same.words.set(words);
  warpInstances(same, g, r2, inst, 6000);
  warpRibbons(same, g, r2, segs, 3000);
  warpCaps(same, g, r2, caps, 3000);
  const worst = (a: Float32Array, b: Float32Array, skip: (k: number) => boolean) => {
    let m = 0;
    for (let k = 0; k < a.length; k++)
      if (!skip(k)) m = Math.max(m, Math.abs((a[k] as number) - (b[k] as number)));
    return m;
  };
  const posI = (k: number) => k % 8 > 1;
  const posS = (k: number) => k % 12 > 7;
  const alphaS = (k: number) => k % 12 === 11;
  const tornS = [...Array(3000).keys()].filter(
    (i) => (gs[i * 12 + 11] as number) !== (segs[i * 12 + 11] as number),
  ).length;
  const tornC = [...Array(3000).keys()].filter(
    (i) => (gc[i * 8 + 5] as number) !== (caps[i * 8 + 5] as number),
  ).length;
  const dI = worst(gi, inst, posI);
  const dS = worst(gs, segs, (k) => posS(k) || alphaS(k));
  const dC = worst(gc, caps, (k) => k % 8 > 3);
  lines.push(
    `instances: max |Δ| ${dI.toExponential(1)} px`,
    `ribbon segments: max |Δ| ${dS.toExponential(1)} px, ${String(tornS)} torn differently of 3000 (${String(segs.filter((_, k) => k % 12 === 11 && segs[k] === 0).length)} torn)`,
    `capsules: max |Δ| ${dC.toExponential(1)} px, ${String(tornC)} torn differently of 3000 (${String(caps.filter((_, k) => k % 8 === 5 && caps[k] === 0).length)} torn)`,
  );
  const ok =
    binDiff === 0 &&
    gridMax < 1e-3 &&
    dI < 1e-3 &&
    dS < 1e-3 &&
    dC < 1e-3 &&
    tornS === 0 &&
    tornC === 0;
  return { pass: ok, lines };
});
