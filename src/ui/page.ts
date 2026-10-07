/**
 * The page: the state the viewer edits (the preset, the parameters, the zoom and the surface), the
 * controls that edit it, and the buttons around the plate. `main.ts` owns the engines and draws
 * what this reports through `onChange`; this file owns no engine and draws nothing, so the page
 * works the same on the GPU and on the CPU engine.
 *
 * The DOM it binds is in index.html (ids `plate`, `seed`, `reseed`, `surprise`, `export-png`,
 * `copy-link`, `controls`, `timeline` and its parts, `status`). The state is also written to the
 * address bar, so a link shares the drawing (src/ui/urlstate.ts).
 */
import type { ParamKey, Params } from '../core/params';
import { PRESETS, presetFamily } from '../core/presets';
import type { SurfaceName } from '../render/surface';
import { clampZoom } from '../view/camera';
import { ControlPanel } from './controls';
import { availablePresets, cardTitle, describe, FAMILY_TITLES, needs } from './describe';
import { FEATURES, FEATURE_MILESTONE, type FeatureName, type TabId } from './layout';
import type { OrbitState } from './orbit';
import { surprise } from './surprise';
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
import { applySurface, rememberSurface } from './theme';
import { buildQuery } from './urlstate';
import { downloadBlob, pngBlob, type Pixels } from './export';

export interface PageState {
  P: Params;
  preset: string;
  zoom: number;
  surface: SurfaceName;
}

export type ChangeKind = 'params' | 'camera' | 'surface';

export interface PageOptions {
  initial: PageState;
  /** a preset's parameters at a seed, with the page's overrides (the golden variants) */
  makeParams(preset: string, seed: number): Params;
  onChange(state: PageState, kind: ChangeKind): void;
  /** the plate as it is shown, as pixels (the PNG export) */
  snapshot(): Promise<Pixels>;
  features?: Record<FeatureName, boolean>;
}

export interface Page {
  state(): PageState;
  /** the plate was orbited, rolled or zoomed */
  setCamera(c: OrbitState): void;
  /** a line for the status region (what the export did) */
  say(text: string): void;
}

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const e = document.getElementById(id);
  if (!(e instanceof type)) throw new Error(`#${id} is missing from the page`);
  return e;
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountPage(opts: PageOptions): Page {
  const features = opts.features ?? FEATURES;
  let st: PageState = opts.initial;
  const initialTab: TabId = 'choose';
  const status = byId('status', HTMLElement);
  const seedInput = byId('seed', HTMLInputElement);
  const say = (text: string) => {
    status.textContent = text;
  };

  // ---- the address bar
  let urlTimer: ReturnType<typeof setTimeout> | undefined;
  const writeUrl = () => {
    clearTimeout(urlTimer);
    urlTimer = undefined;
    try {
      const q = buildQuery(
        {
          preset: st.preset,
          base: opts.makeParams(st.preset, st.P.seed),
          P: st.P,
          zoom: st.zoom,
          surface: st.surface,
        },
        new URLSearchParams(location.search),
      );
      history.replaceState(null, '', `${location.pathname}?${q.toString()}${location.hash}`);
    } catch {
      // a sandboxed frame may refuse; the page works without the link
    }
  };
  const scheduleUrl = () => {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(writeUrl, 250);
  };

  // ---- the controls
  const timelineEls = {
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

  // ---- the preset cards (the Choose tab)
  const choose = document.createElement('div');
  choose.className = 'choose';
  const cards = new Map<string, HTMLButtonElement>();
  const available = availablePresets(features);
  const families = new Map<string, string[]>();
  for (const name of available) {
    const title = FAMILY_TITLES[presetFamily(name)];
    families.set(title, [...(families.get(title) ?? []), name]);
  }
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
      const t = document.createElement('span');
      t.className = 'card-title';
      t.textContent = cardTitle(name);
      const d = document.createElement('span');
      d.className = 'card-desc';
      d.textContent = describe(opts.makeParams(name, st.P.seed));
      b.append(t, d);
      b.addEventListener('click', () => {
        // a preset keeps the seed and the zoom and brings its own view
        commit('params', { ...st, preset: name, P: opts.makeParams(name, st.P.seed) });
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
    note.textContent = `${String(pending.length)} presets are not here yet: they need ${waiting
      .map((f) => FEATURE_MILESTONE[f])
      .join(', ')}, which the engine does not draw yet. They appear when it does.`;
    choose.append(note);
  }

  const panel = new ControlPanel(
    byId('controls', HTMLElement),
    { get: () => st.P, set: setParam },
    choose,
    features,
    initialTab,
  );

  // ---- what depends on the state outside the panel
  const syncChrome = () => {
    if (document.activeElement !== seedInput) seedInput.value = String(st.P.seed);
    for (const [name, b] of cards) b.setAttribute('aria-pressed', String(name === st.preset));
    document.querySelectorAll<HTMLButtonElement>('button[data-surface]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.surface === st.surface));
    });
    const quasar = features.lens && st.P.lensOn > 0 && st.P.lensSource === 'quasar';
    const animated = (features.merger && st.P.merger > 0) || quasar;
    timelineEls.root.hidden = !animated;
    if (!animated && tl.playing) {
      tl = stop(tl);
      cancelAnimationFrame(tlFrame);
    }
    const horizon = Math.max(2, st.P.mHorizon);
    timelineEls.scrub.max = String(horizon);
    timelineEls.scrub.value = String(st.P.mTime);
    timelineEls.read.textContent = `t = ${st.P.mTime.toFixed(2)} · ${phase(st.P.mTime, quasar)}`;
    if (document.activeElement !== timelineEls.end) timelineEls.end.value = tl.end.toFixed(2);
    timelineEls.speedValue.textContent = `${String(tl.speed)}×`;
    timelineEls.play.setAttribute('aria-label', tl.playing ? 'Pause' : 'Play the merger');
    timelineEls.play.dataset.playing = String(tl.playing);
    const caption = document.getElementById('platecapt');
    if (caption)
      caption.textContent = `${describe(st.P).replace(/^./, (c) => c.toUpperCase())}, seed ${String(st.P.seed)}`;
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

  // ---- the seed, "New stars", "Surprise me"
  seedInput.addEventListener('change', () => {
    const seed = Math.min(9999, Math.max(1, Math.round(Number(seedInput.value)) || 1));
    seedInput.value = String(seed);
    // a new seed keeps everything else, the camera and the edits included
    commit('params', { ...st, P: { ...st.P, seed } });
  });
  byId('reseed', HTMLButtonElement).addEventListener('click', () => {
    const seed = 1 + Math.floor(Math.random() * 9999);
    commit('params', { ...st, P: { ...st.P, seed } });
  });
  byId('surprise', HTMLButtonElement).addEventListener('click', () => {
    const r = surprise(Math.random, availablePresets(features), features);
    commit('params', { ...st, preset: r.preset, P: r.P });
  });

  // ---- PNG and the link
  const exportBtn = byId('export-png', HTMLButtonElement);
  exportBtn.addEventListener('click', () => {
    exportBtn.disabled = true;
    say('Preparing the PNG…');
    opts
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

  // ---- the timeline
  const setTime = (t: number) => {
    commit('params', { ...st, P: { ...st.P, mTime: t } });
  };
  const tick = () => {
    if (!tl.playing) return;
    const r = step(tl, performance.now() / 1000);
    if (!r.playing) tl = stop(tl);
    setTime(r.t);
    if (r.playing) tlFrame = requestAnimationFrame(tick);
  };
  const play = () => {
    if (tl.playing) {
      tl = stop(tl);
      cancelAnimationFrame(tlFrame);
      syncChrome();
    } else {
      tl = start(tl, st.P.mTime, performance.now() / 1000);
      syncChrome();
      tlFrame = requestAnimationFrame(tick);
    }
  };
  timelineEls.play.addEventListener('click', play);
  timelineEls.scrub.addEventListener('input', () => {
    tl = stop(tl);
    cancelAnimationFrame(tlFrame);
    setTime(parseFloat(timelineEls.scrub.value));
  });
  timelineEls.end.addEventListener('change', () => {
    const end = parseEnd(timelineEls.end.value);
    if (end !== null) {
      tl = { ...tl, end };
      commit('params', {
        ...st,
        P: { ...st.P, mHorizon: horizonFor(end, st.P.mHorizon) },
      });
    }
    syncChrome();
  });
  timelineEls.end.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') timelineEls.end.blur();
    e.stopPropagation();
  });
  timelineEls.loop.checked = tl.loop;
  timelineEls.loop.addEventListener('change', () => {
    tl = rebase({ ...tl, loop: timelineEls.loop.checked }, st.P.mTime, performance.now() / 1000);
  });
  timelineEls.speed.addEventListener('input', () => {
    tl = rebase(
      { ...tl, speed: parseFloat(timelineEls.speed.value) },
      st.P.mTime,
      performance.now() / 1000,
    );
    syncChrome();
  });

  panel.sync(st.P);
  syncChrome();
  scheduleUrl();
  return {
    state: () => st,
    setCamera(c) {
      const { az, incl, pa } = c;
      commit('camera', { ...st, P: { ...st.P, az, incl, pa }, zoom: clampZoom(c.zoom) });
    },
    say,
  };
}
