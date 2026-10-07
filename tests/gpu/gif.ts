/**
 * The GIF export on the WebGPU engine (milestone M12, src/extras/export/):
 * - frames of the ink target, read back, against the CPU engine's (within 2/255 on all but 0.1%
 *   of the pixels: the GPU's f16 ink target against the CPU's f32);
 * - a recording encoded in the real GIF worker decodes (an independent decoder) with the right
 *   frame count, delay and loop, and each frame is the single render at its moment, quantised,
 *   index for index.
 * The timeline's source here is the orbit swept through t (the merger's and the quasar's are M8
 * and M9, which supply `frame(t)` the same way).
 */
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { CpuRenderer } from '../../src/fallback';
import { CpuMerger } from '../../src/fallback/merger';
import { CpuStipple } from '../../src/fallback/stipple';
import { gifDelayCs, quantiseFrame, type Rgb } from '../../src/extras/export/gif';
import { cpuInkFrame, gpuInkFrame } from '../../src/extras/export/gif-frames';
import { encodeInWorker, frameTimes, recordGif } from '../../src/extras/export/record';
import { timelineSource } from '../../src/extras/export/sources';
import { BuiltAssets, type AtlasName } from '../../src/marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { buildScene, drawingsMeta } from '../../src/model/scene';
import { GpuRenderer } from '../../src/render/frame';
import { GpuMerger } from '../../src/render/merger';
import { GpuStipple } from '../../src/render/stipple';
import { cameraOf } from '../../src/view/camera';
import { decodeGif } from '../unit/support/gif-decode';
import { coarseDensityMap, grey, ssim, type Grey } from '../golden/compare/metrics';
import thresholds from '../golden/thresholds.json';
import { adapterName, device, run } from './harness';

const S = 160;
const PAPER: Rgb = [226, 217, 198];
const INK: Rgb = [29, 27, 25];

run('GIF export (WebGPU frames, the GIF worker)', async () => {
  const { adapter, device: dev } = await device();
  const assets = await BuiltAssets.load('/');
  const names: AtlasName[] = ['dots', 'knots', 'stars', 'cores', 'pieces', 'strokes'];
  const [atlases, paper, sheets] = await Promise.all([
    Promise.all(names.map((n) => assets.atlas(n))),
    assets.paper(),
    Promise.all(VECTOR_ATLASES.map((n) => assets.vector(n))),
  ]);
  const lib = Object.fromEntries(VECTOR_ATLASES.map((n, i) => [n, sheets[i]])) as VectorLibrary;
  const by = (n: string) => {
    const a = atlases.find((x) => x.name === n);
    if (!a) throw new Error(`atlas ${n} missing`);
    return a;
  };
  const meta = drawingsMeta(
    {
      dots: by('dots'),
      knots: by('knots'),
      stars: by('stars'),
      cores: by('cores'),
      strokes: by('strokes'),
    },
    lib.penlines,
    lib,
  );
  const size = { plateCss: S, dpr: 1 };
  const gpuR = new GpuRenderer(dev, size, paper);
  const cpuR = new CpuRenderer(size, paper);
  for (const a of atlases) {
    gpuR.addAtlas(a);
    cpuR.addAtlas(a);
  }
  const st = GpuStipple.create(dev);
  const params = (t: number) => ({
    ...presetParams('Grand design', 7, { starMix: 0, field: 0, fgstars: 0 }),
    az: t * 90,
  });
  const gpuFrame = async (t: number) => {
    const P = params(t);
    st.setScene(buildScene(P, meta));
    st.setView(cameraOf(P, 1));
    gpuR.setLayers(st.inkLayers());
    gpuR.drawInk();
    return gpuInkFrame(dev, gpuR.ink);
  };
  const cpuFrame = (t: number) => {
    const P = params(t);
    const view = new CpuStipple(buildScene(P, meta)).view(cameraOf(P, 1));
    cpuR.setLayers(view.layers);
    cpuR.drawInk();
    return cpuInkFrame(cpuR.ink);
  };
  const lines = [`adapter: ${adapterName(adapter)}`];
  let pass = true;
  const fail = (s: string) => {
    pass = false;
    lines.push(`FAIL ${s}`);
  };

  // GPU frames against the CPU engine's
  for (const t of [0, 0.7, 1.4]) {
    const g = await gpuFrame(t);
    const c = cpuFrame(t);
    let off = 0;
    let worst = 0;
    for (let i = 3; i < g.length; i += 4) {
      const d = Math.abs((g[i] as number) - (c[i] as number));
      worst = Math.max(worst, d);
      if (d > 2) off++;
    }
    lines.push(
      `t ${String(t)}: ${String(off)} of ${String(S * S)} pixels differ by more than 2/255 (worst ${String(worst)})`,
    );
    if (off > S * S * 0.001) fail(`t ${String(t)}: the GPU frame is not the CPU's`);
  }

  // a recording through the worker
  const n = 4;
  const end = 2;
  const bytes = await recordGif(
    { width: S, height: S, frame: gpuFrame },
    { frames: n, end, speed: 2, paper: PAPER, ink: INK, mode: 'ramp' },
    encodeInWorker,
  );
  const gif = decodeGif(bytes);
  if (gif.frames.length !== n) fail(`${String(gif.frames.length)} frames, not ${String(n)}`);
  if (gif.loops !== 0) fail('the GIF does not loop forever');
  if (gif.width !== S || gif.height !== S) fail('wrong size');
  const times = frameTimes(n, end);
  for (let k = 0; k < gif.frames.length; k++) {
    const f = gif.frames[k];
    if (!f) continue;
    if (f.delayCs !== gifDelayCs(2, end, n)) fail(`frame ${String(k)} delay ${String(f.delayCs)}`);
    const single = quantiseFrame(await gpuFrame(times[k] as number), {
      width: S,
      height: S,
      paper: PAPER,
      ink: INK,
      mode: 'ramp',
    });
    const same = f.pixels.every((v, i) => v === single[i]);
    if (!same) fail(`frame ${String(k)} is not the single render at t = ${String(times[k])}`);
  }
  lines.push(
    `GIF of ${String(n)} frames, ${String(Math.round(bytes.length / 1024))} KB, delay ${String(gifDelayCs(2, end, n))} cs, decodes, frames equal single renders`,
  );

  // the merger timeline (M8): one simulation, `mTime` re-blended per frame, through the worker;
  // each frame is a fresh build at that moment, and the CPU engine's frame within the strict band
  {
    const Pm = presetParams('Merger: the Mice', 7, { starMix: 0, field: 0, fgstars: 0 });
    const merger = GpuMerger.create(dev);
    await merger.build(Pm, meta, {});
    const gpuMergerFrame = async (P: Params): Promise<Uint8ClampedArray> => {
      merger.view(1, P.mTime);
      gpuR.setLayers(merger.inkLayers());
      gpuR.drawInk();
      return gpuInkFrame(dev, gpuR.ink);
    };
    const cpuMergerFrame = (t: number): Uint8ClampedArray => {
      const view = new CpuMerger({ ...Pm, mTime: t }, meta).view(1);
      cpuR.setLayers(view.layers);
      cpuR.drawInk();
      return cpuInkFrame(cpuR.ink);
    };
    const mn = 4;
    const mend = 2;
    const mbytes = await recordGif(
      timelineSource(S, S, Pm, gpuMergerFrame),
      { frames: mn, end: mend, speed: 1, paper: PAPER, ink: INK, mode: 'ramp' },
      encodeInWorker,
    );
    const mgif = decodeGif(mbytes);
    if (mgif.frames.length !== mn) fail(`merger GIF: ${String(mgif.frames.length)} frames`);
    const mt = frameTimes(mn, mend);
    const alphaOf = (rgba: Uint8ClampedArray): Grey => {
      const g = grey(S, S);
      for (let i = 0; i < S * S; i++) g.data[i] = (rgba[i * 4 + 3] as number) / 255;
      return g;
    };
    const ssims: string[] = [];
    for (let k = 0; k < mgif.frames.length; k++) {
      const f = mgif.frames[k];
      if (!f) continue;
      const rgba = await gpuMergerFrame({ ...Pm, mTime: mt[k] as number });
      const single = quantiseFrame(rgba, {
        width: S,
        height: S,
        paper: PAPER,
        ink: INK,
        mode: 'ramp',
      });
      if (!f.pixels.every((v, i) => v === single[i]))
        fail(`merger frame ${String(k)} is not the single render at t = ${String(mt[k])}`);
      const cpu = cpuMergerFrame(mt[k] as number);
      const s = ssim(coarseDensityMap(alphaOf(rgba)), coarseDensityMap(alphaOf(cpu)));
      ssims.push(s.toFixed(3));
      if (!(s >= thresholds.strict.ssimCoarse))
        fail(
          `merger frame ${String(k)}: WebGPU against the CPU engine, coarse SSIM ${s.toFixed(3)}`,
        );
      if (k > 0) {
        const prev = mgif.frames[k - 1]?.pixels;
        if (prev && prev.every((v, i) => v === f.pixels[i]))
          fail(`merger frames ${String(k - 1)} and ${String(k)} are equal`);
      }
    }
    lines.push(
      `merger GIF (the Mice, mTime 0 to ${String(mend)}): ${String(mn)} frames, ${String(Math.round(mbytes.length / 1024))} KB; frames equal single renders; WebGPU against CPU coarse SSIM ${ssims.join(', ')} (strict band ${String(thresholds.strict.ssimCoarse)})`,
    );
    merger.destroy();
  }
  st.destroy();
  return { pass, lines };
});
