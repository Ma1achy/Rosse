import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ORBIT,
  attachOrbit,
  dragStep,
  keyStep,
  pinchStep,
  twoFingers,
  wheelStep,
  type OrbitState,
} from '../../src/ui/orbit';

/**
 * The orbit controls against v21's own: the `orbit()` block of app23.js (L1833–1876) is cut out
 * and run as it is on a stand-in canvas, and the same events are sent to it and to attachOrbit.
 * After every event the camera (az, incl, pa, zoom) must be identical.
 */
const SRC = readFileSync(
  resolve(import.meta.dirname, '../../assets/reference/rosse-source/app23.js'),
  'utf8',
);
const start = SRC.indexOf('(function orbit() {');
const end = SRC.indexOf('})();', start) + '})();'.length;
const ORBIT_SRC = SRC.slice(start, end);

class FakeCanvas extends EventTarget {
  style: Record<string, string> = {};
  tabIndex = -1;
  captured: number[] = [];
  getBoundingClientRect() {
    return { left: 100, top: 50, width: 800, height: 800 } as DOMRect;
  }
  setPointerCapture(id: number) {
    this.captured.push(id);
  }
  attrs = new Map<string, string>();
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
}

type Init = Record<string, number | boolean | string>;
function event(type: string, init: Init = {}): Event {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { shiftKey: false, ctrlKey: false, button: 0, ...init });
  return e;
}

interface V21 {
  P: { az: number; incl: number; pa: number };
  zoom(): number;
}

function v21(cv: FakeCanvas, s: OrbitState): V21 {
  const P = { az: s.az, incl: s.incl, pa: s.pa };
  const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
  // v21's own code, run as it is: the point of the test
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const make = new Function(
    'cv',
    'P',
    'clamp',
    'sync',
    'req',
    `var ZOOM = ${String(s.zoom)};\n${ORBIT_SRC}\nreturn { zoom: function () { return ZOOM; } };`,
  ) as (...a: unknown[]) => { zoom: () => number };
  const h = make(
    cv,
    P,
    clamp,
    () => undefined,
    () => undefined,
  );
  return { P, zoom: () => h.zoom() };
}

function pair(s0: OrbitState) {
  const refCv = new FakeCanvas();
  const ref = v21(refCv, s0);
  const ourCv = new FakeCanvas();
  let ours = { ...s0 };
  let sets = 0;
  attachOrbit(ourCv as unknown as HTMLCanvasElement, {
    get: () => ours,
    set: (s) => {
      ours = s;
      sets++;
    },
  });
  const send = (type: string, init: Init = {}) => {
    const a = event(type, init);
    const b = event(type, init);
    refCv.dispatchEvent(a);
    ourCv.dispatchEvent(b);
    expect(b.defaultPrevented, `${type} preventDefault`).toBe(a.defaultPrevented);
    expect(ours, `after ${type} ${JSON.stringify(init)}`).toEqual({
      az: ref.P.az,
      incl: ref.P.incl,
      pa: ref.P.pa,
      zoom: ref.zoom(),
    });
    expect(ourCv.style).toEqual(refCv.style);
  };
  return { send, ourCv, refCv, sets: () => sets };
}

const S0: OrbitState = { az: 20, incl: 30, pa: 0, zoom: 1 };

describe("orbit controls, event for event against v21's own handlers", () => {
  it('sets up the canvas as v21 does', () => {
    const { ourCv, refCv } = pair(S0);
    expect(ourCv.style).toEqual({ touchAction: 'none', cursor: 'grab' });
    expect(ourCv.style).toEqual(refCv.style);
    expect(ourCv.tabIndex).toBe(0);
    // an accessible name with the key hints (v21 has none; an addition)
    expect(ourCv.getAttribute('aria-label')).toMatch(/drag to orbit.*arrows.*zoom/);
  });

  it('drag: orbit and tilt, clamped at 0 and 180°, wrapping at 360°', () => {
    const { send } = pair({ az: 350, incl: 170, pa: 10, zoom: 1 });
    send('pointerdown', { pointerId: 1, clientX: 400, clientY: 300 });
    for (let k = 1; k <= 30; k++)
      send('pointermove', { pointerId: 1, clientX: 400 + 7 * k, clientY: 300 + (k % 7) * 3 });
    send('pointermove', { pointerId: 1, clientX: 100, clientY: -500 });
    send('pointermove', { pointerId: 1, clientX: 90, clientY: -900 });
    send('pointerup', { pointerId: 1 });
    // a move after the pointer is up does nothing
    send('pointermove', { pointerId: 1, clientX: 0, clientY: 0 });
  });

  it('shift-drag and right-drag roll about the plate centre', () => {
    for (const init of [{ shiftKey: true }, { button: 2 }]) {
      const { send } = pair(S0);
      send('pointerdown', { pointerId: 3, clientX: 800, clientY: 450, ...init });
      for (let k = 1; k <= 40; k++) {
        const a = k * 0.2;
        send('pointermove', {
          pointerId: 3,
          clientX: 500 + 300 * Math.cos(a),
          clientY: 450 + 300 * Math.sin(a),
        });
      }
      send('pointerup', { pointerId: 3 });
    }
  });

  it('two fingers: pinch zoom and twist roll, clamped to 0.15–12', () => {
    const { send } = pair(S0);
    send('pointerdown', { pointerId: 1, clientX: 400, clientY: 400 });
    send('pointerdown', { pointerId: 2, clientX: 500, clientY: 400 });
    for (let k = 1; k <= 20; k++)
      send('pointermove', { pointerId: 2, clientX: 400 + 100 * 1.3 ** k, clientY: 400 + 9 * k });
    for (let k = 1; k <= 30; k++)
      send('pointermove', { pointerId: 1, clientX: 400 + 30 * k, clientY: 400 - 5 * k });
    send('pointerup', { pointerId: 2 });
    send('pointermove', { pointerId: 1, clientX: 300, clientY: 300 });
    send('pointerup', { pointerId: 1 });
  });

  it('wheel (and ctrl-wheel), Safari gestures, double-click', () => {
    const { send } = pair(S0);
    for (const d of [100, -40, 3, -700, -700, -700, 2000, 2000])
      send('wheel', { deltaY: d, ctrlKey: false });
    for (const d of [10, -25, -300, 900]) send('wheel', { deltaY: d, ctrlKey: true });
    send('gesturestart', {});
    const gestures: [number, number][] = [
      [5, 1.1],
      [40, 2],
      [-100, 0.5],
      [200, 40],
    ];
    for (const [rotation, scale] of gestures) send('gesturechange', { rotation, scale });
    send('gestureend', {});
    send('gesturechange', { rotation: 10, scale: 3 });
    send('dblclick', {});
    send('contextmenu', {});
  });

  it('keys: arrows, Q/E, +/=, −/_, 0, and others ignored', () => {
    const { send } = pair({ az: 2, incl: 3, pa: 2, zoom: 1 });
    const keys = [
      'ArrowLeft',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'ArrowDown',
      'q',
      'Q',
      'e',
      'E',
      '+',
      '=',
      '-',
      '_',
      'x',
      '0',
    ];
    for (const key of keys) send('keydown', { key });
    for (let k = 0; k < 30; k++) send('keydown', { key: '+' });
    for (let k = 0; k < 60; k++) send('keydown', { key: '-' });
    for (let k = 0; k < 50; k++) send('keydown', { key: 'ArrowDown' });
  });
});

describe('the orbit formulas', () => {
  it('drag: az += 0.45 dx, incl = clamp(incl + 0.45 dy, 0, 180)', () => {
    expect(ORBIT.drag).toBe(0.45);
    expect(dragStep(S0, 10, 20)).toEqual({ az: 24.5, incl: 39, pa: 0, zoom: 1 });
    expect(dragStep(S0, -100, -100).incl).toBe(0);
    expect(dragStep(S0, -100, 0).az).toBeCloseTo(335, 12);
  });

  it('wheel: zoom × exp(−deltaY k), k = 0.0015 or 0.012 with ctrl', () => {
    expect(wheelStep(S0, 100, false).zoom).toBe(Math.exp(-0.15));
    expect(wheelStep(S0, 100, true).zoom).toBe(Math.exp(-1.2));
    expect(wheelStep(S0, -1e6, false).zoom).toBe(12);
    expect(wheelStep(S0, 1e6, true).zoom).toBe(0.15);
  });

  it('pinch and twist', () => {
    const a = twoFingers([0, 0], [100, 0]);
    const b = twoFingers([0, 0], [0, 200]);
    const s = pinchStep(S0, a, b);
    expect(s.zoom).toBe(2);
    expect(s.pa).toBeCloseTo(90, 12);
  });

  it('keys', () => {
    expect(keyStep(S0, 'ArrowUp')?.incl).toBe(26);
    expect(keyStep(S0, 'ArrowLeft')?.az).toBe(15);
    expect(keyStep(S0, 'Q')?.pa).toBe(355);
    expect(keyStep(S0, '=')?.zoom).toBe(1.15);
    expect(keyStep(S0, 'a')).toBeNull();
  });
});
