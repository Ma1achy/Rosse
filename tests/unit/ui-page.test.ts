import { describe, expect, it } from 'vitest';
import { DEF, PARAM_KEYS } from '../../src/core/params';
import { PRESETS, PRESET_NAMES, presetParams } from '../../src/core/presets';
import { SCHEMA, sanitise } from '../../src/core/schema';
import { availablePresets, needs } from '../../src/ui/describe';
import { CAPABILITIES } from '../../src/render/capabilities';
import {
  COMPONENTS,
  componentsOf,
  isBuilt,
  KEY_FEATURE,
  unplaced,
  visibleTabs,
  type Features,
} from '../../src/ui/layout';
import { surprise } from '../../src/ui/surprise';
import { horizonFor, initialTimeline, parseEnd, start, step, stop } from '../../src/ui/timeline';
import { buildQuery, parseUrlState } from '../../src/ui/urlstate';

const none: Features = { stars: false, merger: false, lens: false };
const all: Features = { stars: true, merger: true, lens: true };

describe('the layout over the schema', () => {
  it('places every parameter that has a control, once', () => {
    expect(unplaced()).toEqual([]);
    const items = COMPONENTS.flatMap((c) => [...c.main, ...(c.more ?? [])]);
    expect(new Set(items).size).toBe(items.length);
    for (const k of items) expect(SCHEMA[k].control, k).toBe(true);
  });

  it('shows everything once every feature is drawn, and hides the gated ones before', () => {
    const shown = (f: Features) =>
      (['galaxy', 'merger', 'sky', 'ink'] as const).flatMap((t) =>
        componentsOf(t, f).flatMap((c) => [
          ...c.main,
          ...(c.more ?? []),
          ...(c.on ? [c.on.key] : []),
        ]),
      );
    expect(new Set(shown(all)).size).toBe(PARAM_KEYS.filter((k) => SCHEMA[k].control).length);
    const part = shown(none);
    for (const k of part) expect(isBuilt(k, none), k).toBe(true);
    expect(part).not.toContain('mRatio');
    expect(part).not.toContain('lensR');
    expect(part).not.toContain('spikes');
    expect(visibleTabs(none)).not.toContain('merger');
    expect(visibleTabs(all)).toContain('merger');
  });

  it('gates only parameters that exist', () => {
    for (const k of Object.keys(KEY_FEATURE)) expect(PARAM_KEYS).toContain(k);
  });
});

describe('presets on the page', () => {
  it('hides the presets that need what is not drawn, and shows all when it is', () => {
    expect(availablePresets(all)).toEqual(PRESET_NAMES);
    const a = availablePresets(none);
    expect(a).toContain('Grand design');
    expect(a).not.toContain('Merger: the Mice');
    expect(a).not.toContain('Lens: Einstein ring');
    expect(needs('Layered: lensed merger')).toContain('lens');
    expect(needs('Layered: lensed merger')).toContain('merger');
  });
});

describe('the address', () => {
  it('writes only what differs from the preset and reads it back', () => {
    const base = presetParams('Barred spiral', 42);
    const P = { ...base, arms: 4, stroke: 'beaded', incl: 55.123456, pen: 3.1 };
    const q = buildQuery(
      { preset: 'Barred spiral', base, P, zoom: 2, surface: 'chalk' },
      new URLSearchParams('backend=cpu'),
    );
    expect(q.get('backend')).toBe('cpu');
    expect(q.get('arms')).toBe('4');
    expect(q.has('bulge')).toBe(false);
    const s = parseUrlState(q, all);
    expect(s.preset).toBe('Barred spiral');
    expect(s.seed).toBe(42);
    expect(s.surface).toBe('chalk');
    expect(s.view.zoom).toBe(2);
    expect(s.view.incl).toBeCloseTo(55.1235, 3);
    expect(s.overrides).toMatchObject({ arms: 4, stroke: 'beaded', pen: 3.1 });
  });

  it('always writes the surface, so Paper survives a viewer whose own choice is the Chalkboard', () => {
    const base = presetParams('Grand design', 7);
    for (const surface of ['paper', 'chalk'] as const) {
      const q = buildQuery(
        { preset: 'Grand design', base, P: base, zoom: 1, surface },
        new URLSearchParams(),
      );
      expect(q.get('surface')).toBe(surface);
      expect(parseUrlState(q, all).surface).toBe(surface);
    }
  });

  it('clamps numbers, ignores bad choices and unknown presets', () => {
    const s = parseUrlState(
      new URLSearchParams('preset=Nope&arms=99&stroke=wavy&pitch=abc&plates=slip'),
      all,
    );
    expect(s.preset).toBeUndefined();
    expect(s.overrides).toEqual({ arms: 6, plates: 'slip' });
  });

  it('rewrites the page’s keys and keeps its own; the preview flag is not kept', () => {
    const base = presetParams('Grand design', 7);
    const q = buildQuery(
      { preset: 'Grand design', base, P: base, zoom: 1, surface: 'paper' },
      new URLSearchParams('variant=vectors&arms=5&preset=old&features=merger'),
    );
    expect(q.toString()).toBe('variant=vectors&preset=Grand+design&seed=7&surface=paper');
  });

  it('drops a preset or a parameter the engine does not draw', () => {
    const q = new URLSearchParams(
      'preset=Merger%3A+the+Mice&mRatio=0.3&lensR=1.5&starMix=0.1&arms=3',
    );
    const part: Features = { stars: false, merger: false, lens: false };
    const s = parseUrlState(q, part);
    expect(s.preset).toBeUndefined();
    expect(s.overrides).toEqual({ arms: 3 });
    const withMerger = parseUrlState(q, { ...part, merger: true });
    expect(withMerger.preset).toBe('Merger: the Mice');
    expect(withMerger.overrides).toEqual({ mRatio: 0.3, arms: 3 });
  });

  it('round-trips the merger’s moment and horizon up to 30', () => {
    const base = presetParams('Merger: the Mice', 7);
    const P = { ...base, mHorizon: 13, mTime: 12.5 };
    const q = buildQuery(
      { preset: 'Merger: the Mice', base, P, zoom: 1, surface: 'paper' },
      new URLSearchParams(),
    );
    const s = parseUrlState(q, all);
    expect(s.overrides).toMatchObject({ mHorizon: 13, mTime: 12.5 });
    expect(parseUrlState(new URLSearchParams('mTime=99'), all).overrides.mTime).toBe(30);
  });

  it('writes a galaxy that is not a preset with its source, and reads it back', () => {
    const base = presetParams('Grand design', 321);
    const q = buildQuery(
      {
        preset: null,
        from: 'gz2:587722',
        base,
        P: { ...base, arms: 3 },
        zoom: 1,
        surface: 'paper',
      },
      new URLSearchParams(),
    );
    expect(q.has('preset')).toBe(false);
    const s = parseUrlState(q, all);
    expect(s.from).toBe('gz2:587722');
    expect(s.preset).toBeUndefined();
    expect(s.overrides).toMatchObject({ arms: 3 });
  });
});

describe('what the engine says it draws', () => {
  it('has a capability for every feature the page knows, and no other', () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual(['lens', 'merger', 'stars']);
  });
});

describe('the timeline', () => {
  it('runs at 6 s per unit of t, loops and stops', () => {
    let s = start(initialTimeline(false), 0, 10);
    expect(step(s, 13).t).toBeCloseTo(0.5);
    expect(step(s, 10 + 15).t).toBeCloseTo(0.5); // 2.5 wraps round the end at 2
    s = { ...start({ ...initialTimeline(false), loop: false }, 0, 0), speed: 2 };
    expect(step(s, 3).t).toBeCloseTo(1);
    expect(step(s, 100)).toEqual({ t: 2, playing: false });
    expect(stop(s).playing).toBe(false);
  });
  it('starts from the beginning when it is at the end, and does not loop for reduced motion', () => {
    expect(start(initialTimeline(false), 2, 0).from).toBe(0);
    expect(start(initialTimeline(false), 0.7, 0).from).toBe(0.7);
    expect(initialTimeline(true).loop).toBe(false);
  });
  it('clamps the end and sets the horizon as v21', () => {
    expect(parseEnd('99')).toBe(30);
    expect(parseEnd('0,05')).toBe(0.2);
    expect(parseEnd('x')).toBeNull();
    expect(horizonFor(7.2, 2)).toBe(8);
    expect(horizonFor(1.5, 8)).toBe(2);
    expect(horizonFor(5, 8)).toBe(8);
  });
});

describe('Surprise me', () => {
  /** mulberry32 */
  const seeded = (seed: number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  it('always gives valid parameters, and only what is drawn', () => {
    for (let i = 1; i <= 200; i++) {
      const { P, preset } = surprise(seeded(i), availablePresets(none), none);
      expect(() => sanitise(P)).not.toThrow();
      expect(PRESET_NAMES).toContain(preset);
      expect(P.merger).toBe(0);
      expect(P.lensOn).toBe(0);
      expect(P.subject).toBe('galaxy');
      expect(P.ovStar).toBe(DEF.ovStar);
    }
  });
  it('is a function of its random numbers', () => {
    expect(surprise(seeded(5), PRESET_NAMES, all)).toEqual(surprise(seeded(5), PRESET_NAMES, all));
  });
  it('really draws afresh: seeds, presets and looks vary, and v21’s ranges hold', () => {
    const out = Array.from({ length: 300 }, (_, i) =>
      surprise(seeded(i + 1), availablePresets(all), all),
    );
    expect(new Set(out.map((o) => o.P.seed)).size).toBeGreaterThan(250);
    expect(new Set(out.map((o) => o.preset)).size).toBeGreaterThan(20);
    expect(new Set(out.map((o) => o.P.stroke)).size).toBe(6);
    for (const { P } of out) {
      expect(P.seed).toBeGreaterThanOrEqual(1);
      expect(P.seed).toBeLessThanOrEqual(9999);
      expect([-1, 1]).toContain(P.winding);
      expect([0, 0.8]).toContain(P.lines);
      expect(P.pen).toBeGreaterThanOrEqual(1.6);
      expect(P.pen).toBeLessThanOrEqual(3.4);
      expect(P.vary).toBeGreaterThanOrEqual(0.3);
    }
    // a merger is added to about one galaxy in five, and then its pair is its own
    const added = out.filter((o) => o.P.merger && !PRESETS[o.preset]?.merger);
    expect(added.length).toBeGreaterThan(10);
    expect(new Set(added.map((o) => `${o.P.mType1}/${o.P.mType2}`)).size).toBeGreaterThan(3);
  });
  it('differs from the preset it started from', () => {
    const { P, preset } = surprise(seeded(9), ['Grand design'], none);
    expect(preset).toBe('Grand design');
    expect(P).not.toEqual(presetParams('Grand design', P.seed));
  });
});
