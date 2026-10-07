// @ts-check
/**
 * `npm run readme:assets [-- stage ...]`: re-draws the README's pictures with the engine.
 *
 * Stages (default: all, in this order):
 *   renders  the stills of plan.mjs, drawn on WebGPU (SwiftShader): composited plates and ink
 *            alpha into .cache/readme-assets/renders/ (not committed)
 *   banner   docs/img/banner.png and banner-dark.png from poster/banner.html
 *   gallery  docs/img/gallery/*.jpg, docs/img/zoom.jpg
 *   gifs     docs/img/orbit.gif, merger.gif, surfaces.gif
 *
 * Needs: Node 22, the repository's dev dependencies (Playwright's Chromium), and `ffmpeg` and
 * ImageMagick's `convert` on the PATH (for the GIFs and for optimising the images). Nothing is
 * downloaded. See tools/readme-assets/README.md.
 */
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GALAXIES, GIFS, PLATE_CSS, STILLS } from './plan.mjs';
import { CACHE, IMG, RENDERS, Renderer, alphaPng, rgbaPng, screenshot, sh } from './lib.mjs';

const stages = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const want = (/** @type {string} */ s) => stages.length === 0 || stages.includes(s);

/** the shot of a still: the galaxy of the plan with this view */
function shotOf(/** @type {import('./plan.mjs').Still} */ s) {
  const g = GALAXIES[s.galaxy];
  if (!g) throw new Error(`no galaxy ${s.galaxy}`);
  return {
    preset: g.preset,
    seed: g.seed,
    over: g.over ?? {},
    ...(g.cam ?? {}),
    ...(s.az !== undefined ? { az: s.az } : {}),
    ...(s.incl !== undefined ? { incl: s.incl } : {}),
    ...(s.pa !== undefined ? { pa: s.pa } : {}),
    ...(s.mTime !== undefined ? { mTime: s.mTime } : {}),
    zoom: s.zoom ?? 1,
  };
}

async function renders() {
  mkdirSync(RENDERS, { recursive: true });
  const r = await Renderer.open();
  try {
    let size = '';
    for (const s of STILLS) {
      const dpr = s.dpr ?? 1;
      if (size !== `${PLATE_CSS}@${dpr}`) {
        await r.size(PLATE_CSS, dpr);
        size = `${PLATE_CSS}@${dpr}`;
      }
      const t0 = Date.now();
      const info = await r.shot(shotOf(s));
      if (!info) throw new Error('no shot');
      const w = info.width;
      for (const k of s.keep) {
        if (k === 'ink') {
          writeFileSync(join(RENDERS, `${s.id}.ink.png`), alphaPng(await r.alpha(), w));
        } else {
          const surface = k === 'plate-chalk' ? 'chalk' : 'paper';
          writeFileSync(
            join(RENDERS, `${s.id}.${surface}.png`),
            rgbaPng(await r.plate(surface), w, w),
          );
        }
      }
      console.log(`${s.id}: ${String(w)} px, ${String(Date.now() - t0)} ms`);
    }
  } finally {
    await r.close();
  }
}

if (want('renders')) await renders();
if (want('banner')) {
  mkdirSync(IMG, { recursive: true });
  const html = 'tools/readme-assets/poster/banner.html';
  for (const [theme, file] of [
    ['light', 'banner.png'],
    ['dark', 'banner-dark.png'],
  ]) {
    const tmp = join(CACHE, `banner-${theme}.png`);
    await screenshot(`${html}?theme=${theme}`, tmp, 1100, 380, 2);
    sh('convert', [
      tmp,
      '-strip',
      '-colors',
      '192',
      '-define',
      'png:compression-level=9',
      join(IMG, file),
    ]);
    console.log(`wrote docs/img/${file}`);
  }
}

if (want('gallery')) {
  const dir = join(IMG, 'gallery');
  mkdirSync(dir, { recursive: true });
  for (const s of STILLS.filter((x) => x.id.startsWith('g-'))) {
    const surface = s.keep.includes('plate-chalk') ? 'chalk' : 'paper';
    const out = join(dir, `${s.id.slice(2)}.jpg`);
    sh('convert', [
      join(RENDERS, `${s.id}.${surface}.png`),
      '-strip',
      '-quality',
      '86',
      '-sampling-factor',
      '4:4:4',
      out,
    ]);
  }
  // the zoom strip: the same plate at three zooms, side by side with hairline gutters
  sh('montage', [
    ...['z-1', 'z-2', 'z-3'].map((id) => join(RENDERS, `${id}.paper.png`)),
    '-tile',
    '3x1',
    '-geometry',
    '600x600+0+0',
    '-background',
    '#c9c2b2',
    '-strip',
    '-quality',
    '86',
    '-sampling-factor',
    '4:4:4',
    join(IMG, 'zoom.jpg'),
  ]);
  console.log('wrote docs/img/gallery and zoom.jpg');
}

if (want('gifs')) {
  const r = await Renderer.open();
  try {
    await r.size(PLATE_CSS, 1);
    for (const g of GIFS) {
      const dir = join(CACHE, 'frames', g.id);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      for (let i = 0; i < g.frames; i++) {
        const t = i / g.frames;
        const info = await r.shot(shotOf({ id: g.id, galaxy: g.galaxy, keep: [], ...g.view(t) }));
        if (!info) throw new Error('no shot');
        const w = info.width;
        let rgba;
        if (g.kind === 'wipe') {
          const [paper, chalk] = [await r.plate('paper'), await r.plate('chalk')];
          // the line sweeps right and back (eased); chalk on its left, paper on its right
          const x = Math.round(w * (0.5 - 0.5 * Math.cos(2 * Math.PI * (t + 0.25))));
          rgba = Buffer.alloc(w * w * 4);
          for (let y = 0; y < w; y++)
            for (let c = 0; c < w; c++) {
              const o = (y * w + c) * 4;
              (c < x ? chalk : paper).copy(rgba, o, o, o + 4);
              // a hairline of two pixels, cream against the chalk and ink against the paper
              if (c === x - 1) rgba.set([239, 233, 220, 255], o);
              else if (c === x) rgba.set([29, 27, 25, 255], o);
            }
        } else rgba = await r.plate(g.surface);
        writeFileSync(join(dir, `f${String(i).padStart(3, '0')}.png`), rgbaPng(rgba, w, w));
      }
      const out = join(IMG, `${g.id}.gif`);
      const filter = `scale=${String(g.size)}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${String(g.colours)}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
      sh('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-framerate',
        String(g.fps),
        '-i',
        join(dir, 'f%03d.png'),
        '-vf',
        filter,
        '-loop',
        '0',
        out,
      ]);
      console.log(
        `wrote docs/img/${g.id}.gif (${String(Math.round(statSync(out).size / 1024))} KB)`,
      );
    }
  } finally {
    await r.close();
  }
}
