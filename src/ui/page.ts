/**
 * The page: the state the viewer edits (the preset, the parameters, the zoom and the surface), the
 * controls that edit it, and the buttons around the plate. `main.ts` owns the engines and draws
 * what this reports through `onChange`; this file owns no engine and draws nothing, so the page
 * works the same on the GPU and on the CPU engine.
 *
 * The DOM it binds is in index.html (ids `plate`, `seed`, `reseed`, `surprise`, `export-png`,
 * `copy-link`, `controls`, `timeline` and its parts, `status`). The state is also written to the
 * address bar, so a link shares the drawing (src/ui/urlstate.ts).
 *
 * Change kinds (what `onChange` is told):
 * - `params`: a control, the timeline or a part taken out or added;
 * - `preset`: a preset, a new seed or Surprise me: a different drawing. The overlays' home
 *   orientation (open question Q3) is set again for these only, never when a View control moves;
 * - `camera`: the plate was orbited, rolled or zoomed;
 * - `surface`: Paper or the Chalkboard.
 *
 * Integration points for M12 (docs/milestones/m11/README.md): `ExportSource` (what an export reads
 * from the engine), `Page.addExport` (a button in the actions row), `Page.timeline` (the end, the
 * speed and the loop, for the GIF), and `PageState.from` (a galaxy that is not a preset).
 */
import type { ParamKey, Params } from '../core/params';
import { PRESETS, presetFamily } from '../core/presets';
import type { SurfaceName } from '../render/surface';
import { clampZoom } from '../view/camera';
import { ControlPanel, setText } from './controls';
import { availablePresets, cardTitle, describe, FAMILY_TITLES, needs } from './describe';
import { downloadBlob, pngBlob, type ExportSource } from './export';
import { FEATURE_MILESTONE, type Features, type FeatureName, type IconSpec } from './layout';
import type { OrbitState } from './orbit';
import { surprise } from './surprise';
import { applySurface, rememberSurface } from './theme';
import {
  horizonFor,
  initialTimeline,
  parseEnd,
  phase,
  rebase,
  start,
  step,
  stop,
  type TimelineState,
} from './timeline';
import { buildQuery } from './urlstate';

export interface PageState {
  P: Params;
  /** the preset drawn, or null for a galaxy that is not one (`from` says which) */
  preset: string | null;
  /** M12: the catalogue or real galaxy drawn, as the link writes it */
  from?: string;
  zoom: number;
  surface: SurfaceName;
}

export type ChangeKind = 'params' | 'preset' | 'camera' | 'surface';

export interface PageOptions {
  initial: PageState;
  /** a preset's parameters at a seed, with the page's overrides (the golden variants) */
  makeParams(preset: string, seed: number): Params;
  /** the golden variants' overrides for a preset, laid over Surprise me's result (`?variant=`) */
  variantOverrides?(preset: string): Partial<Params>;
  onChange(state: PageState, kind: ChangeKind): void;
  /** what an export reads from the engine (the PNG, and M12's SVG and GIF) */
  source: ExportSource;
  /** what the engine draws: the page offers nothing else */
  features: Features;
  /** a card's icon, from the library's drawings */
  icon?: (spec: IconSpec) => SVGElement | null;
  /** a preset's thumbnail, by surface (src/ui/thumbs.ts) */
  thumb?: (preset: string, surface: SurfaceName) => string | undefined;
}

/** An export M12 adds: a button that runs against the engine's source. */
export interface ExportSpec {
  id: string;
  label: string;
  run(source: ExportSource, page: Page): Promise<void>;
}

export interface TimelineInfo {
  end: number;
  speed: number;
  loop: boolean;
  playing: boolean;
}

export interface Page {
  state(): PageState;
  /** the plate was orbited, rolled or zoomed */
  setCamera(c: OrbitState): void;
  /** a line for the status region (what the export did) */
  say(text: string): void;
  /** the timeline's end, speed and loop (the GIF plays what the viewer set) */
  timeline(): TimelineInfo;
  /** a button in the actions row, for an export the engine can feed (M12) */
  addExport(spec: ExportSpec): void;
}

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const e = document.getElementById(id);
  if (!(e instanceof type)) throw new Error(`#${id} is missing from the page`);
  return e;
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The seed the page may draw: 1 to 9999. */
const clampSeed = (v: number) => Math.min(9999, Math.max(1, Math.round(v) || 1));

export function mountPage(opts: PageOptions): Page {
  const features = opts.features;
  let st: PageState = opts.initial;
  const status = byId('status', HTMLElement);
  const seedInput = byId('seed', HTMLInputElement);
  const say = (text: string) => {
    setText(status, text);
  };
  const baseOf = (s: PageState) => opts.makeParams(s.preset ?? 'Grand design', s.P.seed);

  // ---- the address bar
  let urlTimer: ReturnType<typeof setTimeout> | undefined;
  let urlFailed = false;
  const writeUrl = () => {
    clearTimeout(urlTimer);
    urlTimer = undefined;
    try {
      const q = buildQuery(
        {
          preset: st.preset,
          ...(st.from !== undefined ? { from: st.from } : {}),
          base: baseOf(st),
          P: st.P,
          zoom: st.zoom,
          surface: st.surface,
        },
        new URLSearchParams(location.search),
      );
      history.replaceState(null, '', `${location.pathname}?${q.toString()}${location.hash}`);
      urlFailed = false;
    } catch (e) {
      // say it once: the page works without the link, but a link that is not kept must not look kept
      console.warn('The address could not be updated:', e);
      if (!urlFailed)
        say('The address bar could not be updated, so “Copy link” may be out of date.');
      urlFailed = true;
    }
  };
  // at most one write a quarter of a second (a timeline playing changes the state every frame)
  const scheduleUrl = () => {
    urlTimer ??= setTimeout(writeUrl, 250);
  };

  // ---- the timeline's elements and state
  const tlEls = {
    root: byId('timeline', HTMLElement),
    play: byId('tl-play', HTMLButtonElement),
    scrub: byId('tl-scrub', HTMLInputElement),
    read: byId('tl-read', HTMLElement),
    end: byId('tl-end', HTMLInputElement),
    loop: byId('tl-loop', HTMLInputElement),
    speed: byId('tl-speed', HTMLInputElement),
    speedValue: byId('tl-speed-v', HTMLElement),
  };
  let tl: TimelineState = initialTimeline(reducedMotion());
  let tlFrame = 0;

  const commit = (kind: ChangeKind, next: PageState) => {
    st = next;
    panel.sync(st.P);
    syncChrome();
    opts.onChange(st, kind);
    scheduleUrl();
  };
  const setParam = (key: ParamKey, value: number | string) => {
    commit('params', { ...st, P: { ...st.P, [key]: value } });
  };
  const nowS = () => performance.now() / 1000;

  // ---- the preset cards (the Choose tab)
  const choose = document.createElement('div');
  choose.className = 'choose';
  const printEl = document.createElement('figure');
  printEl.className = 'print';
  const printImg = document.createElement('img');
  printImg.alt = '';
  printImg.width = printImg.height = 192;
  const printCap = document.createElement('figcaption');
  const tape = document.createElement('span');
  tape.className = 'tape';
  tape.setAttribute('aria-hidden', 'true');
  printEl.append(tape, printImg, printCap);
  choose.append(printEl);
  const cards = new Map<string, HTMLButtonElement>();
  const families = new Map<string, string[]>();
  for (const name of availablePresets(features)) {
    const title = FAMILY_TITLES[presetFamily(name)];
    families.set(title, [...(families.get(title) ?? []), name]);
  }
  const thumbImg = (name: string, surface: SurfaceName) => {
    const src = opts.thumb?.(name, surface);
    if (!src) return null;
    const img = document.createElement('img');
    img.className = surface === 'chalk' ? 'th-chalk' : 'th-paper';
    img.src = src;
    img.alt = '';
    img.width = img.height = 128;
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  };
  for (const [title, names] of families) {
    const sec = document.createElement('section');
    sec.className = 'cards';
    const h = document.createElement('h3');
    h.textContent = title;
    h.id = `cards-${title.toLowerCase().replace(/\W+/g, '-')}`;
    sec.setAttribute('aria-labelledby', h.id);
    const list = document.createElement('div');
    list.className = 'card-list';
    for (const name of names) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card';
      b.dataset.preset = name;
      const th = document.createElement('span');
      th.className = 'card-th';
      for (const s of ['paper', 'chalk'] as const) {
        const img = thumbImg(name, s);
        if (img) th.append(img);
      }
      const t = document.createElement('span');
      t.className = 'card-title';
      t.textContent = cardTitle(name);
      const d = document.createElement('span');
      d.className = 'card-desc';
      d.textContent = describe(opts.makeParams(name, st.P.seed));
      b.append(th, t, d);
      b.addEventListener('click', () => {
        // a preset keeps the seed and the zoom and brings its own view
        commit('preset', { ...st, preset: name, P: opts.makeParams(name, st.P.seed) });
      });
      list.append(b);
      cards.set(name, b);
    }
    sec.append(h, list);
    choose.append(sec);
  }
  const waiting = (Object.keys(FEATURE_MILESTONE) as FeatureName[]).filter((f) => !features[f]);
  if (waiting.length) {
    const pending = Object.keys(PRESETS).filter((n) => needs(n).some((f) => waiting.includes(f)));
    const note = document.createElement('p');
    note.className = 'pending';
    note.textContent = `${String(pending.length)} more presets need what the engine does not draw yet (${waiting
      .map((f) => FEATURE_MILESTONE[f])
      .join(' and ')}). They appear when it does.`;
    choose.append(note);
  }

  const panel = new ControlPanel(byId('controls', HTMLElement), {
    host: { get: () => st.P, set: setParam },
    features,
    choose,
    ...(opts.icon ? { icon: opts.icon } : {}),
  });

  // ---- what depends on the state outside the panel
  const syncChrome = () => {
    if (document.activeElement !== seedInput) seedInput.value = String(st.P.seed);
    for (const [name, b] of cards) b.setAttribute('aria-pressed', String(name === st.preset));
    document.querySelectorAll<HTMLButtonElement>('button[data-surface]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.surface === st.surface));
    });
    const src = st.preset ? opts.thumb?.(st.preset, st.surface) : undefined;
    printEl.hidden = !src;
    if (src && printImg.getAttribute('src') !== src) printImg.src = src;
    setText(
      printCap,
      st.preset
        ? `${cardTitle(st.preset)}, seed ${String(st.P.seed)}`
        : `Seed ${String(st.P.seed)}`,
    );
    const quasar = features.lens && st.P.lensOn > 0 && st.P.lensSource === 'quasar';
    const animated = (features.merger && st.P.merger > 0) || quasar;
    tlEls.root.hidden = !animated;
    if (!animated && tl.playing) {
      tl = stop(tl);
      cancelAnimationFrame(tlFrame);
    }
    const horizon = Math.max(2, st.P.mHorizon);
    if (tlEls.scrub.max !== String(horizon)) tlEls.scrub.max = String(horizon);
    tlEls.scrub.value = String(st.P.mTime);
    setText(tlEls.read, `t = ${st.P.mTime.toFixed(2)} · ${phase(st.P.mTime, quasar)}`);
    if (document.activeElement !== tlEls.end) tlEls.end.value = tl.end.toFixed(2);
    setText(tlEls.speedValue, `${String(tl.speed)}×`);
    tlEls.play.setAttribute('aria-label', tl.playing ? 'Pause' : 'Play the merger');
    tlEls.play.dataset.playing = String(tl.playing);
    const caption = document.getElementById('platecapt');
    if (caption)
      setText(
        caption,
        `${describe(st.P).replace(/^./, (c) => c.toUpperCase())}, seed ${String(st.P.seed)}`,
      );
  };

  // ---- the surface (Paper or Chalkboard)
  document.querySelectorAll<HTMLButtonElement>('button[data-surface]').forEach((b) => {
    b.addEventListener('click', () => {
      const surface: SurfaceName = b.dataset.surface === 'chalk' ? 'chalk' : 'paper';
      applySurface(surface);
      rememberSurface(surface);
      commit('surface', { ...st, surface });
    });
  });
  applySurface(st.surface);

  // ---- the seed, "New stars", "Surprise me": a different drawing, so the kind is `preset`
  seedInput.addEventListener('change', () => {
    const seed = clampSeed(Number(seedInput.value));
    seedInput.value = String(seed);
    // a new seed keeps everything else, the camera and the edits included
    commit('preset', { ...st, P: { ...st.P, seed } });
  });
  byId('reseed', HTMLButtonElement).addEventListener('click', () => {
    commit('preset', { ...st, P: { ...st.P, seed: 1 + Math.floor(Math.random() * 9999) } });
  });
  byId('surprise', HTMLButtonElement).addEventListener('click', (e) => {
    const b = e.currentTarget as HTMLElement;
    // a post-it lifts off the pile (not under reduced motion: the stylesheet drops the animation)
    b.classList.remove('pull');
    b.getBoundingClientRect();
    b.classList.add('pull');
    const r = surprise(Math.random, availablePresets(features), features);
    const extra = opts.variantOverrides?.(r.preset) ?? {};
    commit('preset', { ...st, preset: r.preset, P: { ...r.P, ...extra } });
  });

  // ---- exports and the link
  const exportBtn = byId('export-png', HTMLButtonElement);
  exportBtn.addEventListener('click', () => {
    exportBtn.disabled = true;
    say('Preparing the PNG…');
    opts.source
      .snapshot()
      .then((px) => pngBlob(px))
      .then((blob) => {
        downloadBlob(blob, `rosse-${String(st.P.seed)}.png`);
        say(`Saved rosse-${String(st.P.seed)}.png`);
      })
      .catch((e: unknown) => {
        say(`Could not save the PNG: ${String(e)}`);
      })
      .finally(() => {
        exportBtn.disabled = false;
      });
  });
  byId('copy-link', HTMLButtonElement).addEventListener('click', () => {
    writeUrl();
    const href = location.href;
    const done = () => {
      say('Link copied');
    };
    if (typeof navigator.clipboard === 'object')
      navigator.clipboard.writeText(href).then(done, () => {
        say(`Copy this address: ${href}`);
      });
    else say(`Copy this address: ${href}`);
  });

  // ---- the timeline: it writes `mTime`, always within 0 and the end the viewer set (v21's
  // tlSetEnd) and the schema's limit
  const maxTime = () => Math.max(2, st.P.mHorizon);
  const setTime = (t: number) => {
    commit('params', { ...st, P: { ...st.P, mTime: Math.min(maxTime(), Math.max(0, t)) } });
  };
  const tick = () => {
    if (!tl.playing) return;
    const r = step(tl, nowS());
    if (!r.playing) tl = stop(tl);
    setTime(Math.min(r.t, tl.end));
    if (r.playing) tlFrame = requestAnimationFrame(tick);
  };
  const play = () => {
    if (tl.playing) {
      tl = stop(tl);
      cancelAnimationFrame(tlFrame);
      syncChrome();
    } else {
      tl = start(tl, st.P.mTime, nowS());
      syncChrome();
      tlFrame = requestAnimationFrame(tick);
    }
  };
  tlEls.play.addEventListener('click', play);
  tlEls.scrub.addEventListener('input', () => {
    tl = stop(tl);
    cancelAnimationFrame(tlFrame);
    setTime(parseFloat(tlEls.scrub.value));
  });
  tlEls.end.addEventListener('change', () => {
    const end = parseEnd(tlEls.end.value);
    if (end !== null) {
      tl = { ...tl, end };
      // as v21: simulate as far as the end asks, and keep the moment inside it
      const mTime = Math.min(st.P.mTime, end);
      tl = rebase(tl, mTime, nowS());
      commit('params', {
        ...st,
        P: { ...st.P, mHorizon: horizonFor(end, st.P.mHorizon), mTime },
      });
    }
    syncChrome();
  });
  tlEls.end.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tlEls.end.blur();
    e.stopPropagation();
  });
  tlEls.loop.checked = tl.loop;
  tlEls.loop.addEventListener('change', () => {
    tl = rebase({ ...tl, loop: tlEls.loop.checked }, st.P.mTime, nowS());
  });
  tlEls.speed.addEventListener('input', () => {
    tl = rebase({ ...tl, speed: parseFloat(tlEls.speed.value) }, st.P.mTime, nowS());
    syncChrome();
  });

  panel.sync(st.P);
  syncChrome();
  scheduleUrl();
  const page: Page = {
    state: () => st,
    setCamera(c) {
      const { az, incl, pa } = c;
      commit('camera', { ...st, P: { ...st.P, az, incl, pa }, zoom: clampZoom(c.zoom) });
    },
    say,
    timeline: () => ({ end: tl.end, speed: tl.speed, loop: tl.loop, playing: tl.playing }),
    addExport(spec) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.id = `export-${spec.id}`;
      b.textContent = spec.label;
      b.addEventListener('click', () => {
        b.disabled = true;
        spec
          .run(opts.source, page)
          .catch((e: unknown) => {
            say(`Could not export: ${String(e)}`);
          })
          .finally(() => {
            b.disabled = false;
          });
      });
      byId('export-png', HTMLButtonElement).after(b);
    },
  };
  return page;
}
