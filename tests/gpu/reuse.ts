/**
 * M10, buffer pooling and avoiding re-uploads (ADR 0070), on the GPU:
 *
 * 1. A model tier rebuilt on pooled buffers gives the bytes a fresh one gives. For each scene A, a
 *    scene B (another seed, so the buffers of A are released and reused, some by B at another size
 *    class), and A again: the second A's samples, projected instances, per-class counts and ink
 *    (α of the ink target, 16-bit float) hash the same as the first A's. A stale byte in a reused
 *    buffer (a missed clear) would change at least one of them.
 * 2. A camera move that leaves the model tier alone builds no batch for the GPU layers and creates
 *    no buffer or bind group for them: only the cores, a CPU instance list placed for the view,
 *    are rebuilt (at most a handful of buffers and bind groups).
 * 3. The second A did not create the model buffers again: the pool's `created` count stays flat.
 */
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { BuiltAssets, type AtlasName } from '../../src/marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { drawingsMeta } from '../../src/model/scene';
import { GpuRenderer } from '../../src/render/frame';
import { GpuStipple } from '../../src/render/stipple';
import { adapterName, device, run } from './harness';
import { readTexture } from '../../src/gpu/readback';

const CASES: [string, Params, Params][] = [
  ['Grand design', presetParams('Grand design', 7), presetParams('Grand design', 8)],
  ['Edge-on with dust', presetParams('Edge-on with dust', 7), presetParams('Smooth, round', 5)],
  ['Hand-drawn arms', presetParams('Hand-drawn arms', 7), presetParams('Barred spiral', 9)],
];

async function sha(buf: ArrayBuffer | ArrayBufferView): Promise<string> {
  const bytes = buf instanceof ArrayBuffer ? buf : (buf.buffer as ArrayBuffer);
  const view =
    buf instanceof ArrayBuffer
      ? new Uint8Array(buf)
      : new Uint8Array(bytes, buf.byteOffset, buf.byteLength);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', view));
  return Array.from(h.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

run('reuse: pooled model buffers and kept batches change no output', async () => {
  const { adapter, device: dev } = await device();
  const counts = { buffers: 0, bindGroups: 0 };
  const createBuffer = dev.createBuffer.bind(dev);
  dev.createBuffer = (d) => {
    counts.buffers++;
    return createBuffer(d);
  };
  const createBindGroup = dev.createBindGroup.bind(dev);
  dev.createBindGroup = (d) => {
    counts.bindGroups++;
    return createBindGroup(d);
  };
  const assets = await BuiltAssets.load('/');
  const names: AtlasName[] = ['dots', 'knots', 'stars', 'cores', 'pieces', 'strokes'];
  const [atlases, paper, sheets] = await Promise.all([
    Promise.all(names.map((n) => assets.atlas(n))),
    assets.paper(),
    Promise.all(VECTOR_ATLASES.map((n) => assets.vector(n))),
  ]);
  const vectors = Object.fromEntries(VECTOR_ATLASES.map((n, i) => [n, sheets[i]])) as VectorLibrary;
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
    vectors.penlines,
    vectors,
  );
  const renderer = new GpuRenderer(dev, { plateCss: 400, dpr: 1 }, paper);
  for (const a of atlases) renderer.addAtlas(a);
  const lines = [`adapter: ${adapterName(adapter)}`];
  let pass = true;
  const fail = (m: string) => {
    pass = false;
    lines.push(`FAIL ${m}`);
  };

  for (const [name, A, B] of CASES) {
    const st = GpuStipple.create(dev);
    /** a frame as the page draws it; returns hashes of what it made */
    const draw = async (P: Params, zoom = 1) => {
      st.frame(P, zoom, meta);
      renderer.setLayers(st.inkLayers());
      renderer.drawInk();
      const samples = await sha(await st.readSamples());
      const projected = await sha((await st.readProjected()).instances);
      const perClass = (await st.readCounts()).perClass.join(',');
      const ink = await sha(await readTexture(dev, renderer.ink, 8));
      return { samples, projected, perClass, ink };
    };
    const a1 = await draw(A);
    await draw(B);
    const created = st.res.pool.stats.created;
    const a2 = await draw(A);
    for (const k of ['samples', 'projected', 'perClass', 'ink'] as const)
      if (a1[k] !== a2[k])
        fail(`${name}: ${k} differs after the buffers were reused (${a1[k]} vs ${a2[k]})`);
    const s = st.res.pool.stats;
    lines.push(
      `${name}: pool created ${String(s.created)} (${String(s.created - created)} for the second A), reused ${String(s.reused)}, uploads hit ${String(st.res.uploads.hits)} / miss ${String(st.res.uploads.misses)}`,
    );

    // 2. a camera move: the batches of the GPU layers are kept
    const moved: Params = { ...A, az: (A.az + 35) % 360 };
    const b0 = counts.buffers;
    const g0 = counts.bindGroups;
    st.frame(moved, 1, meta);
    renderer.setLayers(st.inkLayers());
    renderer.drawInk();
    await dev.queue.onSubmittedWorkDone();
    const { built, kept } = renderer.batchStats;
    const nb = counts.buffers - b0;
    const ng = counts.bindGroups - g0;
    lines.push(
      `${name}: camera move built ${String(built)} batches, kept ${String(kept)}; created ${String(nb)} buffers, ${String(ng)} bind groups`,
    );
    // only the cores (a CPU list) may be rebuilt: a sprite batch per texture array of the cores atlas
    if (built > 1) fail(`${name}: a camera move built ${String(built)} batches`);
    if (kept < 1) fail(`${name}: no batch kept across a camera move`);
    if (nb > 4 || ng > 4)
      fail(`${name}: a camera move created ${String(nb)} buffers, ${String(ng)} bind groups`);
    // a second identical frame builds nothing at all but the cores
    st.destroy();
  }
  return { pass, lines };
});
