/**
 * The one-mark render test (roadmap M1): the same instance list drawn by the GPU (sprite.wgsl
 * into the rgba16float ink target, then composite.wgsl) and by the CPU rasteriser
 * (src/fallback/raster.ts) must agree within 1/255 per channel on every pixel:
 *
 * - the ink target, read back and decoded from half floats, against the CPU's f32 ink buffer;
 * - the composited RGBA8 image, on Paper and on Chalkboard, against the CPU composite.
 *
 * Cases: the single dot at the centre and the page's sample scene, at DPR 1 and 2; and a
 * synthetic L-shaped cell, upright and turned, checked pixel by pixel (tests/vectors/l-shape.ts).
 */
import { BuiltAssets, type AtlasName } from '../../src/marks/atlas';
import { CpuRenderer } from '../../src/fallback';
import { GpuRenderer } from '../../src/render/frame';
import { oneMark, sampleScene } from '../../src/render/sample-scene';
import { SURFACES, type SurfaceName } from '../../src/render/surface';
import { L_INKED, L_INSTANCES, L_PROBES, lAtlas } from '../vectors/l-shape';
import { adapterName, device, halfToFloat, readTexture, run } from './harness';

const TOL = 1 / 255;

run('one mark (CPU raster = GPU raster)', async () => {
  const { adapter, device: dev } = await device();
  const assets = await BuiltAssets.load('/');
  const names: AtlasName[] = ['dots', 'knots', 'stars', 'cores', 'pieces'];
  const atlases = await Promise.all(names.map((n) => assets.atlas(n)));
  const paper = await assets.paper();
  const dotSizes = (atlases[0]?.meta.size ?? []) as number[];
  const counts = Object.fromEntries(atlases.map((a) => [a.name, a.layers])) as Record<
    'dots' | 'knots' | 'stars' | 'cores' | 'pieces',
    number
  >;
  const pieceLayers = sampleScene(dotSizes, counts)
    .filter((l) => l.atlas === 'pieces')
    .flatMap((l) => l.instances.map((s) => s.layer));

  const scenes = { 'one dot': oneMark(dotSizes), 'sample scene': sampleScene(dotSizes, counts) };
  const lines = [
    `adapter: ${adapterName(adapter)}`,
    `limits: maxTextureArrayLayers ${String(dev.limits.maxTextureArrayLayers)}; pieces layers drawn: ${pieceLayers.join(' ')}`,
  ];
  let pass = true;
  let worstInk = 0;
  let worstRgb = 0;
  const data: Record<string, unknown> = {};

  for (const [sceneName, layers] of Object.entries(scenes)) {
    for (const dpr of [1, 2]) {
      const size = { plateCss: 800, dpr };
      const gpu = new GpuRenderer(dev, size, paper);
      const cpu = new CpuRenderer(size, paper);
      for (const a of atlases) {
        gpu.addAtlas(a);
        cpu.addAtlas(a);
      }
      gpu.setLayers(layers);
      cpu.setLayers(layers);
      gpu.drawInk();
      cpu.drawInk();

      // ink target: half floats against f32
      const half = new Uint16Array((await readTexture(dev, gpu.ink, 8)).buffer);
      let inkMax = 0;
      let inkSum = 0;
      let inkPixels = 0;
      const worst: string[] = [];
      for (let i = 0; i < half.length; i++) {
        const g = halfToFloat(half[i] ?? 0);
        const c = cpu.ink.data[i] ?? 0;
        inkMax = Math.max(inkMax, Math.abs(g - c));
        if (Math.abs(g - c) > TOL && worst.length < 8) {
          const p = i >> 2;
          worst.push(
            `    pixel (${String(p % gpu.width)}, ${String(Math.floor(p / gpu.width))}) channel ${String(i % 4)}: GPU ${g.toFixed(4)}, CPU ${c.toFixed(4)}`,
          );
        }
        if (i % 4 === 3) {
          inkSum += c;
          if (c > 0) inkPixels++;
        }
      }
      worstInk = Math.max(worstInk, inkMax);
      const label = `${sceneName}, DPR ${String(dpr)} (${String(gpu.width)}²)`;
      lines.push(
        `${label}: ink max |GPU − CPU| = ${inkMax.toExponential(3)} (${(inkMax * 255).toFixed(4)}/255) over ${String(inkPixels)} inked pixels, total ink ${inkSum.toFixed(2)}`,
      );
      lines.push(...worst);
      if (!(inkMax <= TOL) || inkSum <= 0) pass = false;

      for (const s of ['paper', 'chalk'] as SurfaceName[]) {
        const out = dev.createTexture({
          size: [gpu.width, gpu.height],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        gpu.present(out.createView(), 'rgba8unorm', SURFACES[s]);
        const g = await readTexture(dev, out, 4);
        const c = cpu.present(SURFACES[s]);
        let max = 0;
        let differing = 0;
        for (let i = 0; i < g.length; i++) {
          const d = Math.abs((g[i] ?? 0) - (c[i] ?? 0));
          if (d) differing++;
          max = Math.max(max, d);
        }
        out.destroy();
        worstRgb = Math.max(worstRgb, max);
        lines.push(
          `  composite on ${s}: max ${String(max)}/255, ${String(differing)} channel values differ`,
        );
        if (max > 1) pass = false;
        data[`${label} ${s}`] = { max, differing };
      }
      data[label] = { inkMax, inkSum, inkPixels };
      gpu.destroy();
    }
  }
  // orientation and cell mapping: the synthetic L, upright and turned, on the GPU
  {
    const size = { plateCss: 800, dpr: 1 };
    const gpu = new GpuRenderer(dev, size, paper);
    gpu.addAtlas(lAtlas());
    gpu.setLayers([{ kind: 'sprites', atlas: 'dots', gain: 1, instances: L_INSTANCES }]);
    gpu.drawInk();
    const half = new Uint16Array((await readTexture(dev, gpu.ink, 8)).buffer);
    const wrong = L_PROBES.filter(([x, y, inked]) => {
      const a = halfToFloat(half[(y * gpu.width + x) * 4 + 3] ?? 0);
      return inked ? !(a > L_INKED) : a !== 0;
    });
    lines.push(
      `L shape, upright and turned: ${String(L_PROBES.length - wrong.length)}/${String(L_PROBES.length)} probe pixels right`,
    );
    if (wrong.length) {
      pass = false;
      lines.push(`  wrong: ${wrong.map(([x, y]) => `(${String(x)}, ${String(y)})`).join(' ')}`);
    }
    gpu.destroy();
  }
  lines.push(
    `worst: ink ${(worstInk * 255).toFixed(4)}/255, composite ${String(worstRgb)}/255 (tolerance 1/255)`,
  );
  return { pass, lines, data: { ...data, worstInk, worstRgb } };
});
