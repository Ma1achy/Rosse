import { describe, expect, it } from 'vitest';
import { DEF, PARAM_KEYS } from '../../src/core/params';
import { PRESET_NAMES, presetParams } from '../../src/core/presets';
import { SCHEMA, sanitise } from '../../src/core/schema';
import { availablePresets, needs } from '../../src/ui/describe';
import {
  GROUPS,
  groupsOf,
  isBuilt,
  KEY_FEATURE,
  unplaced,
  visibleTabs,
  type FeatureName,
} from '../../src/ui/layout';
import { surprise } from '../../src/ui/surprise';
import { horizonFor, initialTimeline, parseEnd, start, step, stop } from '../../src/ui/timeline';
import { buildQuery, parseUrlState } from '../../src/ui/urlstate';

const none: Record<FeatureName, boolean> = { stars: false, merger: false, lens: false };
const all: Record<FeatureName, boolean> = { stars: true, merger: true, lens: true };

describe('the layout over the schema', () => {
  it('places every parameter that has a control, once', () => {
    expect(unplaced()).toEqual([]);
    const items = GROUPS.flatMap((g) => g.items);
    expect(new Set(items).size).toBe(items.length);
    for (const k of items) expect(SCHEMA[k].control, k).toBe(true);
  });

  it('shows everything once every feature is drawn, and hides the gated ones before', () => {
    const shown = (f: Record<FeatureName, boolean>) =>
      (['galaxy', 'merger', 'sky', 'ink'] as const).flatMap((t) =>
        groupsOf(t, f).flatMap((g) => g.items),
      );
    expect(shown(all).length).toBe(PARAM_KEYS.filter((k) => SCHEMA[k].control).length);
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
    const s = parseUrlState(q);
    expect(s.preset).toBe('Barred spiral');
    expect(s.seed).toBe(42);
    expect(s.surface).toBe('chalk');
    expect(s.view.zoom).toBe(2);
    expect(s.view.incl).toBeCloseTo(55.1235, 3);
    expect(s.overrides).toMatchObject({ arms: 4, stroke: 'beaded', pen: 3.1 });
  });

  it('clamps numbers, ignores bad choices and unknown presets', () => {
    const s = parseUrlState(
      new URLSearchParams('preset=Nope&arms=99&stroke=wavy&pitch=abc&plates=slip'),
    );
    expect(s.preset).toBeUndefined();
    expect(s.overrides).toEqual({ arms: 6, plates: 'slip' });
  });

  it('rewrites the page’s keys and keeps its own', () => {
    const base = presetParams('Grand design', 7);
    const q = buildQuery(
      { preset: 'Grand design', base, P: base, zoom: 1, surface: 'paper' },
      new URLSearchParams('variant=vectors&arms=5&preset=old'),
    );
    expect(q.toString()).toBe('variant=vectors&preset=Grand+design&seed=7');
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
  const seeded = (seed: number) => {
    let x = seed;
    return () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296;
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
});
