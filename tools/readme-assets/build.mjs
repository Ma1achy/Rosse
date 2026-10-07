// @ts-check
/**
 * `npm run readme:assets [-- stage ...] [--only=id,id] [--fresh]`: re-draws the README's pictures
 * with the engine. Each stage re-draws only its own outputs.
 *
 * Stages (default and `all`: every one, in this order):
 *   banner     docs/img/banner.png, banner-dark.png (poster/banner.html, with the banner's plates)
 *   renders    every plate the stills need, drawn on WebGPU (SwiftShader) into .cache/readme-assets/
 *   gallery    docs/img/figures/*.jpg: the poster-grid stills (plan.mjs FIGURES), the preset contact
 *              sheet, the pen-weight figure
 *   anatomy    docs/img/figures/anatomy.jpg (the marks by layers) and docs/img/gifs/anatomy.gif
 *   gz2        docs/img/gz2/*.jpg (the Galaxy Zoo 2 category plates) and docs/img/real/*.jpg
 *              (photograph and drawing for the real galaxies)
 *   gifs       docs/img/gifs/*.gif (the films; `--only=merger-mice,lens-ring` for some)
 *   fetch-gz2  NOT in `all`: downloads the SDSS cutout of each GZ2 pick into docs/img/gz2/cutouts/
 *              (needs the network; run once, commit the files; gz2 then draws the pairs)
 *
 * Needs: Node 22, the repository's dev dependencies (Playwright's Chromium), `ffmpeg` and
 * ImageMagick (`convert`, `montage`) on the PATH. Only `fetch-gz2` uses the network (through `curl`
 * and the configured proxy). Plates are cached in .cache/readme-assets/ by a hash of the shot and
 * the engine's source tree; `--fresh` ignores the cache. See tools/readme-assets/README.md.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { viewAt } from './camera.mjs';
import { strip, sheet, pair, WIDTH } from './figures.mjs';
import {
  ANATOMY,
  BANNER,
  FIGURES,
  GALAXIES,
  GIFS,
  GZ2_BARS,
  GZ2_CUTOUTS,
  GZ2_RULES,
  GZ2_VIEW,
  PLATE_CSS,
  REAL_PAIRS,
  REAL_VIEW,
  SDSS_CUTOUT,
  SHEET,
  ZOOM_FIG,
} from './plan.mjs';
import { CACHE, IMG, ROOT, Renderer, alphaPng, figures, rgbaPng, screenshot, sh } from './lib.mjs';

const args = process.argv.slice(2);
const stages = args.filter((a) => !a.startsWith('-'));
const flag = (/** @type {string} */ n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const FRESH = args.includes('--fresh');
const ONLY = flag('only')?.split(',');
const want = (/** @type {string} */ s) =>
  stages.length === 0
    ? s !== 'fetch-gz2'
    : stages.includes('all')
      ? s !== 'fetch-gz2'
      : stages.includes(s);

const PLATES = join(CACHE, 'plates');
const FIGS = join(CACHE, 'figs');
const OUT = {
  figures: join(IMG, 'figures'),
  gz2: join(IMG, 'gz2'),
  real: join(IMG, 'real'),
  gifs: join(IMG, 'gifs'),
};
for (const d of [PLATES, FIGS, ...Object.values(OUT)]) mkdirSync(d, { recursive: true });

const sha = (/** @type {string} */ s) => createHash('sha1').update(s).digest('hex').slice(0, 14);
const kb = (/** @type {string} */ f) => Math.round(statSync(f).size / 1024);
const rel = (/** @type {string} */ f) => relative(ROOT, f);
const url = (/** @type {string} */ f) => `/${rel(f)}`;

/** The engine's source tree as committed: a plate cached for another engine is not reused. */
function engineStamp() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD:src'], { cwd: ROOT }).toString().trim();
  } catch {
    return 'nogit';
  }
}
const ENGINE = engineStamp();

// ---- the manifest: what each picture resolved to --------------------------------------------
const MANIFEST = join(IMG, 'manifest.json');
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
manifest.figures ??= {};
manifest.gifs ??= {};
manifest.gz2 ??= {};
manifest.real ??= {};
function saveManifest() {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}

// ---- the renderer, opened when first needed --------------------------------------------------
/** @type {Renderer | null} */
let R = null;
let curSize = '';
async function renderer() {
  R ??= await Renderer.open();
  return R;
}
async function setSize(/** @type {number} */ css, /** @type {number} */ dpr) {
  const r = await renderer();
  if (curSize !== `${String(css)}@${String(dpr)}`) {
    await r.size(css, dpr);
    curSize = `${String(css)}@${String(dpr)}`;
  }
  return r;
}

/** the arguments the render page takes, from a shot (with `over` merged from a view) */
function pageShot(/** @type {any} */ s, /** @type {any} */ view = {}) {
  const { over, ...v } = view;
  return {
    preset: s.preset,
    seed: s.seed,
    over: { ...(s.over ?? {}), ...(over ?? {}) },
    ...(s.params ? { params: s.params } : {}),
    ...(s.only ? { only: s.only } : {}),
    ...(s.plates ? { plates: s.plates } : {}),
    zoom: s.zoom ?? 1,
    ...(s.az !== undefined ? { az: s.az } : {}),
    ...(s.incl !== undefined ? { incl: s.incl } : {}),
    ...(s.pa !== undefined ? { pa: s.pa } : {}),
    ...(s.mTime !== undefined ? { mTime: s.mTime } : {}),
    ...v,
  };
}

/**
 * The composited plate (PNG file) of a shot at a plate size, on a surface; drawn if it is not in
 * the cache. Returns the path.
 */
async function plate(
  /** @type {any} */ shot,
  /** @type {number} */ css,
  /** @type {'paper' | 'chalk'} */ surface = 'paper',
) {
  const arg = pageShot(shot);
  const key = sha(JSON.stringify([arg, css, ENGINE]));
  const file = join(PLATES, `${key}.${surface}.png`);
  if (!FRESH && existsSync(file)) return file;
  const r = await setSize(css, 1);
  const t0 = Date.now();
  const info = await r.shot(arg);
  if (!info) throw new Error('no shot');
  console.log(
    `plate ${key} ${arg.preset || 'params'} ${String(css)} px ${String(Date.now() - t0)} ms`,
  );
  for (const s of /** @type {const} */ (['paper', 'chalk'])) {
    const f = join(PLATES, `${key}.${s}.png`);
    if (s === surface || !existsSync(f))
      writeFileSync(f, rgbaPng(await r.plate(s), info.width, info.width));
  }
  return file;
}

function jpeg(/** @type {string} */ src, /** @type {string} */ out, quality = 84) {
  sh('convert', [src, '-strip', '-quality', String(quality), '-sampling-factor', '4:2:0', out]);
}

/** HTML to a JPEG figure. */
async function figureJobs(/** @type {Array<{id: string, html: string, dir: string}>} */ jobs) {
  const todo = [];
  for (const j of jobs) {
    const page = join(FIGS, `${j.id.replace(/\//g, '-')}.html`);
    writeFileSync(page, j.html);
    todo.push({ html: rel(page), out: join(FIGS, `${j.id.replace(/\//g, '-')}.png`), j });
  }
  await figures(
    todo.map((t) => ({ html: t.html, out: t.out })),
    WIDTH,
    1.5,
  );
  for (const t of todo) {
    const out = join(t.j.dir, `${t.j.id.split('/').pop()}.jpg`);
    jpeg(t.out, out, 80);
    console.log(`wrote ${rel(out)} (${String(kb(out))} KB)`);
  }
}

// ---- banner ----------------------------------------------------------------------------------
async function banner() {
  const dir = join(CACHE, 'renders');
  mkdirSync(dir, { recursive: true });
  const r = await renderer();
  for (const b of BANNER) {
    await setSize(800, b.dpr);
    const info = await r.shot(pageShot(b.shot));
    if (!info) throw new Error('no shot');
    for (const k of b.keep) {
      if (k === 'ink')
        writeFileSync(join(dir, `${b.id}.ink.png`), alphaPng(await r.alpha(), info.width));
      else {
        const s = k === 'plate-chalk' ? 'chalk' : 'paper';
        writeFileSync(
          join(dir, `${b.id}.${s}.png`),
          rgbaPng(await r.plate(s), info.width, info.width),
        );
      }
    }
    console.log(`${b.id}: ${String(info.width)} px`);
  }
  for (const [theme, file] of [
    ['light', 'banner.png'],
    ['dark', 'banner-dark.png'],
  ]) {
    const tmp = join(CACHE, `banner-${theme}.png`);
    await screenshot(`tools/readme-assets/poster/banner.html?theme=${theme}`, tmp, 1100, 380, 2);
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

// ---- gallery: the stills ---------------------------------------------------------------------
async function gallery() {
  const jobs = [];
  for (const f of FIGURES) {
    const cells = [];
    for (const c of f.cells) {
      const { label, sub, surface, ...shot } = c;
      const css = f.cols === 1 ? 1100 : PLATE_CSS;
      cells.push({ img: url(await plate(shot, css, surface ?? 'paper')), label, sub, surface });
    }
    jobs.push({
      id: f.id,
      dir: OUT.figures,
      html: strip({ fig: f.fig, title: f.title, cols: f.cols, cells, note: f.note }),
    });
  }
  // the pen-weight figure: one plate at three zooms
  {
    const cells = [];
    for (const z of ZOOM_FIG.zooms)
      cells.push({
        img: url(await plate({ ...ZOOM_FIG.shot, zoom: z }, PLATE_CSS)),
        label: `x${String(z)}`,
        sub:
          z === 1.5
            ? 'the whole galaxy'
            : z === 4
              ? 'strokes keep their weight'
              : 'the core drawings resolve',
      });
    jobs.push({
      id: 'pen',
      dir: OUT.figures,
      html: strip({ fig: ZOOM_FIG.fig, title: 'The pen up close', cols: 3, cells }),
    });
  }
  // the contact sheet of every preset
  {
    const r = await renderer();
    /** @type {string[]} */
    const names = /** @type {any} */ (await r.op('presetNames'));
    manifest.presets = names;
    const cells = [];
    for (const n of names)
      cells.push({
        img: url(
          await plate({ preset: n, seed: SHEET.seed, over: {}, zoom: SHEET.zoom }, SHEET.plate),
        ),
        label: n,
      });
    jobs.push({
      id: 'presets',
      dir: OUT.figures,
      html: sheet({ fig: SHEET.fig, title: 'Every preset', cols: SHEET.cols, cells }),
    });
  }
  await figureJobs(jobs);
  for (const j of jobs) {
    const f = join(OUT.figures, `${j.id}.jpg`);
    manifest.figures[j.id] = { file: rel(f), bytes: statSync(f).size };
  }
  saveManifest();
}

// ---- anatomy ---------------------------------------------------------------------------------
async function anatomyFigure() {
  const cells = [];
  for (const st of ANATOMY.stages) {
    const shot = { ...ANATOMY.shot, ...(st.only ? { only: st.only } : {}) };
    cells.push({ img: url(await plate(shot, PLATE_CSS)), label: st.label, sub: st.sub });
  }
  await figureJobs([
    {
      id: 'anatomy',
      dir: OUT.figures,
      html: strip({ fig: ANATOMY.fig, title: 'The same galaxy, by layers', cols: 3, cells }),
    },
  ]);
  const f = join(OUT.figures, 'anatomy.jpg');
  manifest.figures.anatomy = { file: rel(f), bytes: statSync(f).size };
  saveManifest();
}

// ---- Galaxy Zoo 2 ----------------------------------------------------------------------------
const PICKS = join(import.meta.dirname, 'gz2-picks.json');

async function gz2Picks() {
  const r = await renderer();
  const picks = /** @type {any[]} */ (
    await r.op(
      'gz2',
      '/assets/data/rosse/gz2-catalogue.json',
      GZ2_RULES.map(({ id, type, fields }) => ({ id, type, fields })),
    )
  );
  writeFileSync(PICKS, JSON.stringify(picks, null, 1) + '\n');
  return picks;
}

const pct = (/** @type {number} */ v) => String(Math.round(Math.min(1, v) * 100)) + '%';

async function gz2() {
  const picks = await gz2Picks();
  const jobs = [];
  const overview = [];
  for (const p of picks) {
    const rule = GZ2_RULES.find((x) => x.id === p.id);
    if (!rule) continue;
    const c = p.card;
    const shot = { preset: '', seed: c.seed, params: p.params, zoom: GZ2_VIEW.zoom };
    const drawing = url(await plate(shot, GZ2_VIEW.plate));
    const cut = join(ROOT, GZ2_CUTOUTS, `${c.objid}.jpg`);
    const photo = existsSync(cut) ? url(cut) : undefined;
    jobs.push({
      id: `gz2/${p.id}`,
      dir: OUT.gz2,
      html: pair({
        fig: `01.${String(picks.indexOf(p) + 1)}`,
        title: rule.label,
        ...(photo ? { photo, photoNote: 'SDSS cutout' } : {}),
        drawing,
        caption: `drawn from the votes: ${c.caption}`,
        lines: [
          ['category', rule.label],
          ['question', rule.q],
          ['vote fraction', pct(p.score)],
          ['volunteers', String(c.n)],
          ['objid', c.objid],
          ['ra, dec', `${c.ra.toFixed(4)}, ${c.dec.toFixed(4)}`],
          ['seed', String(c.seed)],
        ],
        bars: GZ2_BARS.map(
          (k) => /** @type {[string, number]} */ ([k === 'feat' ? 'features' : k, c.votes[k] ?? 0]),
        ),
        credit: `Highest ${rule.label.toLowerCase()} vote fraction of ${String(p.matches)} galaxies of the type. Galaxy Zoo 2 votes (Willett et al. 2013), CC BY 4.0${photo ? '; photograph: SDSS' : ''}.`,
      }),
    });
    overview.push({ img: drawing, label: rule.label, sub: `${pct(p.score)} · ${c.objid}` });
    manifest.gz2[p.id] = {
      objid: c.objid,
      ra: c.ra,
      dec: c.dec,
      score: p.score,
      seed: c.seed,
      matches: p.matches,
      cutout: photo ? rel(cut) : null,
    };
  }
  jobs.push({
    id: 'gz2/overview',
    dir: OUT.gz2,
    html: strip({
      fig: '01',
      title: 'Galaxy Zoo 2: the clearest of each kind',
      cols: 5,
      cells: overview,
      note: 'The galaxy with the highest vote fraction in each category; Rosse draws it from the votes alone.',
    }),
  });
  // the real galaxies: photograph | drawing
  const reals = /** @type {any[]} */ (await (await renderer()).op('reals'));
  for (const [n, rp] of REAL_PAIRS.entries()) {
    const g = reals[rp.i];
    const shot = { preset: '', seed: g.params.seed, params: g.params, zoom: REAL_VIEW.zoom };
    const drawing = url(await plate(shot, REAL_VIEW.plate));
    jobs.push({
      id: `real/${String(rp.i).padStart(2, '0')}`,
      dir: OUT.real,
      html: pair({
        fig: `02.${String(n + 1)}`,
        title: `${rp.cat[0].toUpperCase()}${rp.cat.slice(1)}: galaxy ${g.id}`,
        photo: url(join(ROOT, 'assets/data/rosse/real-galaxies', g.photo)),
        photoNote: 'SDSS, 160 px',
        drawing,
        caption: g.caption,
        lines: [
          ['category', rp.cat],
          ['objid', g.id],
          ['ra, dec', `${g.ra.toFixed(4)}, ${g.dec.toFixed(4)}`],
          ['seed', String(g.params.seed)],
        ],
        bars: GZ2_BARS.map(
          (k) => /** @type {[string, number]} */ ([k === 'feat' ? 'features' : k, g.votes[k] ?? 0]),
        ),
        credit:
          "Photograph: SDSS. Votes: Galaxy Zoo 2 (Willett et al. 2013), CC BY 4.0. The drawing is Rosse's.",
      }),
    });
    manifest.real[String(rp.i)] = { objid: g.id, category: rp.cat, seed: g.params.seed };
  }
  await figureJobs(jobs);
  for (const j of jobs) {
    const f = join(j.dir, `${j.id.split('/').pop()}.jpg`);
    const key = j.id.split('/')[0] === 'gz2' ? 'gz2' : 'real';
    const id = j.id.split('/').pop() ?? '';
    const base = key === 'gz2' ? 'gz2' : 'real';
    manifest[base][id === 'overview' ? 'overview' : id] = {
      ...(manifest[base][id] ?? {}),
      file: rel(f),
      bytes: statSync(f).size,
    };
  }
  saveManifest();
}

/** `fetch-gz2`: the SDSS cutout of each GZ2 pick, once, into the repository. Needs the network. */
function fetchGz2() {
  if (!existsSync(PICKS))
    throw new Error('run `npm run readme:assets -- gz2` first: it writes gz2-picks.json');
  const picks = JSON.parse(readFileSync(PICKS, 'utf8'));
  const dir = join(ROOT, GZ2_CUTOUTS);
  mkdirSync(dir, { recursive: true });
  const mf = join(dir, 'manifest.json');
  /** @type {any[]} */
  const rows = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : [];
  let failed = 0;
  for (const p of picks) {
    const c = p.card;
    const file = join(dir, `${c.objid}.jpg`);
    if (existsSync(file) && !FRESH) {
      console.log(`have ${c.objid}`);
      continue;
    }
    const u = SDSS_CUTOUT(c.ra, c.dec);
    const tmp = join(CACHE, `cutout-${c.objid}.jpg`);
    // curl honours HTTPS_PROXY and the CA bundle; TLS verification stays on
    const res = spawnSync(
      'curl',
      ['-sS', '--fail', '-m', '90', '-o', tmp, '-w', '%{http_code}', u],
      { encoding: 'utf8' },
    );
    const head = existsSync(tmp) ? readFileSync(tmp).subarray(0, 3) : Buffer.alloc(0);
    const isJpeg = head[0] === 0xff && head[1] === 0xd8;
    if (res.status !== 0 || !isJpeg) {
      failed++;
      console.error(`FAILED ${c.objid} (${p.id}): ${res.stderr.trim() || 'not a JPEG'}`);
      continue;
    }
    sh('convert', [tmp, '-strip', '-quality', '86', file]);
    const bytes = readFileSync(file);
    rows.push({
      objid: c.objid,
      category: p.id,
      ra: c.ra,
      dec: c.dec,
      url: u,
      retrieved: new Date().toISOString().slice(0, 10),
      bytes: bytes.length,
      sha1: createHash('sha1').update(bytes).digest('hex'),
    });
    console.log(`fetched ${c.objid} (${p.id}), ${String(Math.round(bytes.length / 1024))} KB`);
  }
  writeFileSync(mf, JSON.stringify(rows, null, 2) + '\n');
  if (failed) {
    console.error(
      `${String(failed)} cutouts could not be fetched. Is the network blocked? (read /root/.ccr/README.md or your proxy's policy)`,
    );
    process.exitCode = 1;
  } else console.log('done: commit docs/img/gz2/cutouts/, then run `npm run readme:assets -- gz2`');
}

// ---- GIFs ------------------------------------------------------------------------------------
const FILM_PLATE = 520;

/** blend two RGBA buffers: a*(1-w) + b*w */
function mix(/** @type {Buffer} */ a, /** @type {Buffer} */ b, /** @type {number} */ w) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round((a[i] ?? 0) * (1 - w) + (b[i] ?? 0) * w);
  return out;
}

const smooth = (/** @type {number} */ x) => x * x * (3 - 2 * x);

/** the frame RGBA for film `g` at frame i of n, and the page's shot arguments */
async function frameOf(/** @type {any} */ g, /** @type {number} */ i, /** @type {number} */ n) {
  const r = await setSize(FILM_PLATE, 1);
  const closed = !!g.path?.closed;
  const t = closed || g.kind === 'wipe' || g.kind === 'breathe' ? i / n : n > 1 ? i / (n - 1) : 0;
  const view = g.path ? viewAt(g.path, t) : {};
  const draw = async (/** @type {any} */ extra = {}) => {
    const info = await r.shot(pageShot({ ...g.shot, ...extra }, view));
    if (!info) throw new Error('no shot');
    return info.width;
  };
  if (g.kind === 'plate') {
    const w = await draw();
    return { w, rgba: await r.plate(g.surface) };
  }
  if (g.kind === 'wipe') {
    const w = await draw();
    const [paper, chalk] = [await r.plate('paper'), await r.plate('chalk')];
    const x = Math.round(w * (0.5 - 0.5 * Math.cos(2 * Math.PI * (t + 0.25))));
    const rgba = Buffer.alloc(w * w * 4);
    for (let y = 0; y < w; y++)
      for (let c = 0; c < w; c++) {
        const o = (y * w + c) * 4;
        (c < x ? chalk : paper).copy(rgba, o, o, o + 4);
        if (c === x - 1) rgba.set([239, 233, 220, 255], o);
        else if (c === x) rgba.set([29, 27, 25, 255], o);
      }
    return { w, rgba };
  }
  if (g.kind === 'breathe') {
    const k = g.states.length;
    const seg = t * k;
    const a = Math.floor(seg) % k;
    const b = (a + 1) % k;
    // rest on a state for the first half of its segment, then fade to the next
    const u = Math.min(1, Math.max(0, (seg - Math.floor(seg) - 0.45) / 0.55));
    const w = await draw(g.states[a]);
    const pa = await r.plate(g.surface);
    if (u === 0) return { w, rgba: pa };
    await draw(g.states[b]);
    const pb = await r.plate(g.surface);
    return { w, rgba: mix(pa, pb, smooth(u)) };
  }
  if (g.kind === 'anatomy') {
    const k = ANATOMY.stages.length;
    const seg = t * k;
    const s = Math.min(k - 1, Math.floor(seg));
    // draw in over the first 85% of a stage's time; the rest is a rest
    const u = Math.min(1, (seg - s) / 0.85);
    const only = (/** @type {number} */ j) => (j < 0 ? [] : ANATOMY.stages[j]?.only);
    const w = await draw({ only: only(s) });
    const cur = await r.plate(g.surface);
    if (u >= 1) return { w, rgba: cur };
    await draw({ only: only(s - 1) });
    const prev = await r.plate(g.surface);
    const rgba = Buffer.alloc(cur.length);
    const R = u * w * 0.78;
    const feather = 0.09 * w;
    for (let y = 0; y < w; y++)
      for (let c = 0; c < w; c++) {
        const d = Math.hypot(c - w / 2, y - w / 2);
        const m = 1 - smooth(Math.min(1, Math.max(0, (d - (R - feather)) / (2 * feather))));
        const o = (y * w + c) * 4;
        for (let q = 0; q < 4; q++)
          rgba[o + q] = Math.round((prev[o + q] ?? 0) * (1 - m) + (cur[o + q] ?? 0) * m);
      }
    return { w, rgba };
  }
  throw new Error(`unknown film kind ${g.kind}`);
}

function encode(/** @type {any} */ g, /** @type {string} */ dir, /** @type {string} */ out) {
  const budget = (g.budgetMB ?? 2.5) * 1024 * 1024 * 0.97;
  // attempts, from the best to the leanest: [size, colours, frame step, dither]
  const attempts = [
    [g.size, g.colours, 1, 'bayer:bayer_scale=5'],
    [g.size, Math.min(g.colours, 24), 1, 'bayer:bayer_scale=5'],
    [Math.round(g.size * 0.9), 24, 1, 'bayer:bayer_scale=5'],
    [Math.round(g.size * 0.85), 16, 1, 'bayer:bayer_scale=4'],
    [Math.round(g.size * 0.75), 16, 1, 'bayer:bayer_scale=4'],
    [Math.round(g.size * 0.68), 16, 1, 'bayer:bayer_scale=3'],
    [Math.round(g.size * 0.6), 12, 1, 'bayer:bayer_scale=3'],
  ];
  let used = '';
  for (const [size, colours, step, dither] of attempts) {
    const sel = step === 1 ? '' : `select='not(mod(n\\,${String(step)}))',setpts=N/FRAME_RATE/TB,`;
    const filter = `${sel}scale=${String(size)}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${String(colours)}:stats_mode=diff[p];[b][p]paletteuse=dither=${String(dither)}:diff_mode=rectangle`;
    sh('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      String(g.fps),
      '-i',
      join(dir, 'f%04d.png'),
      '-vf',
      filter,
      '-loop',
      '0',
      out,
    ]);
    used = `${String(size)} px, ${String(colours)} colours${step > 1 ? ', every 2nd frame' : ''}`;
    if (statSync(out).size <= budget) break;
    console.log(
      `  ${String(Math.round(statSync(out).size / 1024))} KB is over the budget at ${used}; trying leaner`,
    );
  }
  return used;
}

async function gifs(/** @type {(g: any) => boolean} */ pick) {
  for (const g of GIFS) {
    if (!pick(g)) continue;
    if (ONLY && !ONLY.includes(g.id)) continue;
    const dir = join(CACHE, 'frames', g.id);
    const redo = args.includes('--reencode') && existsSync(dir);
    if (!redo) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const n = redo ? 0 : Math.round(g.seconds * g.fps);
    const t0 = Date.now();
    let k = 0;
    const [h0, h1] = g.hold ?? [0, 0];
    let first = '';
    for (let i = 0; i < n; i++) {
      const { w, rgba } = await frameOf(g, i, n);
      const png = rgbaPng(rgba, w, w);
      const name = (/** @type {number} */ j) => join(dir, `f${String(j).padStart(4, '0')}.png`);
      if (i === 0) {
        first = name(k);
        for (let j = 0; j < h0; j++) writeFileSync(name(k++), png);
      }
      writeFileSync(name(k++), png);
      if (i === n - 1) for (let j = 0; j < h1; j++) writeFileSync(name(k++), png);
    }
    void first;
    if (redo) k = readdirSync(dir).length;
    const out = join(OUT.gifs, `${g.id}.gif`);
    const used = encode(g, dir, out);
    // `--mp4`: a full-size H.264 MP4 beside the GIF (not committed by default: it is as big again)
    const mp4 = args.includes('--mp4') ? join(OUT.gifs, `${g.id}.mp4`) : null;
    if (mp4)
      sh('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-framerate',
        String(g.fps),
        '-i',
        join(dir, 'f%04d.png'),
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v',
        'libx264',
        '-crf',
        '28',
        '-preset',
        'slow',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        mp4,
      ]);
    if (!args.includes('--keep')) rmSync(dir, { recursive: true, force: true });
    console.log(
      `wrote ${rel(out)} (${String(kb(out))} KB; ${String(k)} frames, ${used}; ${String(Math.round((Date.now() - t0) / 1000))} s)`,
    );
    manifest.gifs[g.id] = {
      file: rel(out),
      bytes: statSync(out).size,
      ...(mp4 ? { mp4: rel(mp4), mp4Bytes: statSync(mp4).size } : {}),
      frames: k,
      fps: g.fps,
      encoded: used,
    };
    saveManifest();
  }
}

// ---- run -------------------------------------------------------------------------------------
try {
  if (want('banner')) await banner();
  if (want('renders')) {
    // warm the plate cache for every figure (gallery draws the same plates)
    for (const f of FIGURES)
      for (const c of f.cells) {
        const { label, sub, surface, ...shot } = c;
        void label;
        void sub;
        await plate(shot, f.cols === 1 ? 1100 : PLATE_CSS, surface ?? 'paper');
      }
    void GALAXIES;
    console.log('plates are in .cache/readme-assets/plates');
  }
  if (want('gallery')) await gallery();
  if (want('anatomy')) {
    await anatomyFigure();
    await gifs((g) => g.kind === 'anatomy');
  }
  if (want('gz2')) await gz2();
  if (stages.includes('fetch-gz2')) fetchGz2();
  if (want('gifs')) await gifs((g) => g.kind !== 'anatomy');
  void readdirSync;
  void copyFileSync;
} finally {
  if (R) await R.close();
}
