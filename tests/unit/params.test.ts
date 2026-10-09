import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEF, PARAM_KEYS, defaults, withDefaults } from '../../src/core/params';
import { PRESETS, PRESET_NAMES, presetFamily, presetParams } from '../../src/core/presets';
import {
  SCHEMA,
  dirtyTier,
  incE,
  inclBucket,
  sanitise,
  tierOf,
  type NumberSpec,
} from '../../src/core/schema';

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../../assets/reference/rosse-source/app23.js'),
  'utf8',
);

/** A literal from the reference's source, evaluated. */
function literal(name: string, close: string): unknown {
  const m = new RegExp(`var ${name} = ([\\[{][\\s\\S]*?${close})`).exec(SOURCE);
  if (!m?.[1]) throw new Error(`${name} not found`);
  // the reference is our own checked-in source, so evaluating its literals is safe
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  return new Function(`return ${m[1]};`)() as unknown;
}

/**
 * The keys the port adds to v21's `DEF`, after v21's own, each with a default that leaves v21's
 * behaviour as it is. `dustAuto`: the natural dust of disc galaxies, on only on the page (ADR 0075).
 */
const EXTRA_KEYS = {
  dustAuto: 0,
  bulgeAuto: 0,
  starsAuto: 0,
  cosmicAuto: 0,
  lineWorld: 0,
  strokesAuto: 0,
  thinAuto: 0,
};

describe('DEF', () => {
  it('has every key of the reference, with the same defaults, in order, then the extra keys', () => {
    const ref = literal('DEF', '\\};') as Record<string, unknown>;
    expect(Object.keys(DEF)).toEqual([...Object.keys(ref), ...Object.keys(EXTRA_KEYS)]);
    expect({ ...DEF }).toEqual({ ...ref, ...EXTRA_KEYS });
    expect(PARAM_KEYS.length).toBe(109 + Object.keys(EXTRA_KEYS).length);
  });

  it('withDefaults rejects unknown keys', () => {
    expect(() => withDefaults({ nope: 1 } as never)).toThrow(/unknown/);
    expect(withDefaults({ arms: 3 }).arms).toBe(3);
    expect(defaults()).not.toBe(defaults());
  });
});

describe('PRESETS', () => {
  const ref = literal('PRESETS', '\\n\\};') as Record<string, Record<string, unknown>>;

  it('are the reference presets, verbatim, with identical names and order', () => {
    expect(PRESET_NAMES).toEqual(Object.keys(ref));
    expect(PRESET_NAMES.length).toBe(45);
    for (const n of PRESET_NAMES) expect(PRESETS[n]).toEqual(ref[n]);
  });

  it('only use keys of DEF, with values the schema accepts', () => {
    for (const n of PRESET_NAMES) {
      for (const k of Object.keys(PRESETS[n] ?? {})) expect(DEF).toHaveProperty(k);
      expect(() => sanitise(presetParams(n, 4242))).not.toThrow();
    }
  });

  it('keep the seed, as the reference does', () => {
    const p = presetParams('Smooth, round', 4242);
    expect(p.seed).toBe(4242);
    expect(p.bulge).toBe(1);
    expect(p.stars).toBe(DEF.stars);
    expect(presetParams('Grand design')).toEqual({ ...DEF });
  });

  it('fall into the families of the reference notes', () => {
    const count = (f: string) => PRESET_NAMES.filter((n) => presetFamily(n) === f).length;
    expect(count('galaxy')).toBe(11);
    expect(count('lens')).toBe(7);
    expect(count('merger')).toBe(9);
    expect(count('layered')).toBe(5);
    expect(count('star') + count('artefact')).toBe(5);
    expect(count('creative')).toBe(8);
  });
});

describe('schema', () => {
  it('covers every key, and ranges contain the defaults', () => {
    expect(Object.keys(SCHEMA).sort()).toEqual([...PARAM_KEYS].sort());
    for (const k of PARAM_KEYS) {
      const s = SCHEMA[k];
      const d = DEF[k];
      if (s.kind === 'number') {
        expect(typeof d, k).toBe('number');
        expect(d as number, k).toBeGreaterThanOrEqual(s.min);
        expect(d as number, k).toBeLessThanOrEqual(s.max);
      } else expect(s.options, k).toContain(d);
    }
  });

  it('takes ranges from the reference controls', () => {
    const groups = literal('GROUPS', '\\n\\];') as unknown[][];
    let checked = 0;
    for (const g of groups)
      for (const c of g[1] as [string, string, number, number, number][]) {
        const s = SCHEMA[c[0] as keyof typeof SCHEMA] as NumberSpec;
        // One deliberate difference from the reference (owner decision of 2026-10-07): the moment
        // in the merger runs to the timeline's horizon, which v21's own timeline lets reach 30
        // (`tlSetEnd`, app23.js:L1659), so `mTime`'s maximum is 30 rather than the slider's 2.
        const want = c[0] === 'mTime' ? [c[2], 30, c[4]] : [c[2], c[3], c[4]];
        expect([s.min, s.max, s.step], c[0]).toEqual(want);
        expect(s.control).toBe(true);
        checked++;
      }
    expect(checked).toBeGreaterThan(70);
  });

  it('puts the camera in the view tier and plates in the present tier', () => {
    for (const k of ['incl', 'az', 'pa', 'winding', 'mTime'] as const)
      expect(tierOf(k)).toBe('view');
    expect(tierOf('plates')).toBe('present');
    for (const k of ['seed', 'stars', 'bulge', 'arms', 'pen', 'dust', 'vary'] as const)
      expect(tierOf(k)).toBe('model');
  });

  it('marks the highest dirty tier, with incE thresholds dirtying the model', () => {
    const a = defaults();
    expect(dirtyTier(a, { ...a })).toBeNull();
    expect(dirtyTier(a, { ...a, az: 40 })).toBe('view');
    expect(dirtyTier(a, { ...a, plates: 'slip' })).toBe('present');
    expect(dirtyTier(a, { ...a, plates: 'slip', az: 3 })).toBe('view');
    expect(dirtyTier(a, { ...a, az: 3, arms: 4 })).toBe('model');
    expect(dirtyTier({ ...a, incl: 60 }, { ...a, incl: 65 })).toBe('view');
    expect(dirtyTier({ ...a, incl: 69 }, { ...a, incl: 71 })).toBe('model');
    expect(incE(100)).toBe(80);
    expect(incE(-30)).toBe(30);
    expect(inclBucket(88)).toBe(6);
    expect(inclBucket(108)).toBe(1);
  });

  it('sanitise clamps numbers and rejects bad choices', () => {
    expect(sanitise({ ...defaults(), bulge: 3 }).bulge).toBe(1);
    expect(() => sanitise({ ...defaults(), stroke: 'nope' })).toThrow();
  });
});
