/**
 * Orbit, roll and zoom on the plate, as v21's controls (app23.js:L1833–1876):
 *
 * - drag: orbit and tilt, `az += 0.45·dx`, `incl = clamp(incl + 0.45·dy, 0, 180)`;
 * - shift- or right-drag: roll by the pointer's angle about the plate's centre;
 * - two fingers: pinch zooms, twist rolls;
 * - wheel: zoom by `exp(−deltaY·k)`, k = 0.0015, or 0.012 with ctrl (a trackpad pinch);
 * - Safari's gesturestart/gesturechange/gestureend: pinch and twist from the gesture's start;
 * - double-click: zoom 1;
 * - keys: arrows orbit ±5° and tilt ∓4°, Q/E roll ∓5°, + or = and − or _ zoom ×/÷ 1.15, 0 zoom 1.
 *
 * Zoom is clamped to 0.15–12, angles wrap into [0, 360). The canvas gets `touch-action: none`,
 * the grab cursor, a tab stop, an accessible name with the key hints (unless the page gave it
 * one), and no context menu.
 *
 * v21's quirks, reproduced on purpose so the plate behaves as v21's does (tests/unit/orbit.test.ts
 * runs v21's own handlers beside these):
 * - there is no `lostpointercapture` handler: a pointer whose capture is lost without a
 *   `pointerup` or `pointercancel` stays in the pointer map until it next goes up;
 * - the key handler ignores modifiers, so Ctrl and + or − zoom the plate and are swallowed
 *   (`preventDefault`), never reaching the browser's own page zoom while the plate has focus;
 * - the wheel ignores `deltaMode`: a line- or page-mode delta is taken as pixels, so a mouse
 *   that reports lines zooms more gently than in pixels.
 *
 * The maths is in pure functions (unit-tested against v21's formulas); `attachOrbit` wires them
 * to the canvas. It only reports new camera states; the page decides when to draw (one frame per
 * animation frame at most).
 */
import { clamp, clampZoom, wrapDeg } from '../view/camera';

export interface OrbitState {
  az: number;
  incl: number;
  pa: number;
  zoom: number;
}

/** v21's constants (app23.js:L1849, L1861, L1870–1873). */
export const ORBIT = {
  drag: 0.45,
  wheel: 0.0015,
  ctrlWheel: 0.012,
  keyAz: 5,
  keyIncl: 4,
  keyRoll: 5,
  keyZoom: 1.15,
} as const;

/** One pointer move of a plain drag (app23.js:L1849). */
export function dragStep(s: OrbitState, dx: number, dy: number): OrbitState {
  return {
    ...s,
    az: wrapDeg(s.az + dx * ORBIT.drag),
    incl: clamp(s.incl + dy * ORBIT.drag, 0, 180),
  };
}

/** `roll(deg)` (app23.js:L1837). */
export function rollBy(s: OrbitState, deg: number): OrbitState {
  return { ...s, pa: wrapDeg(s.pa + deg) };
}

/**
 * One pointer move of a roll drag (app23.js:L1848): the change of the pointer's angle about the
 * plate's centre, wrapped into (−π, π].
 */
export function rollStep(
  s: OrbitState,
  prev: readonly [number, number],
  now: readonly [number, number],
  centre: readonly [number, number],
): OrbitState {
  const angle = (p: readonly [number, number]) => Math.atan2(p[1] - centre[1], p[0] - centre[0]);
  let da = angle(now) - angle(prev);
  da = Math.atan2(Math.sin(da), Math.cos(da));
  return rollBy(s, (da * 180) / Math.PI);
}

/** Two pointers: their distance and the angle of the line between them (app23.js:L1839). */
export interface TwoFingers {
  d: number;
  t: number;
}

export function twoFingers(a: readonly [number, number], b: readonly [number, number]): TwoFingers {
  return { d: Math.hypot(a[0] - b[0], a[1] - b[1]), t: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

/** Pinch zoom and twist roll (app23.js:L1851–1855). */
export function pinchStep(s: OrbitState, last: TwoFingers, now: TwoFingers): OrbitState {
  const dt = Math.atan2(Math.sin(now.t - last.t), Math.cos(now.t - last.t));
  const zoom = last.d ? clampZoom((s.zoom * now.d) / last.d) : s.zoom;
  return rollBy({ ...s, zoom }, (dt * 180) / Math.PI);
}

/** The wheel (app23.js:L1861). */
export function wheelStep(s: OrbitState, deltaY: number, ctrl: boolean): OrbitState {
  const k = ctrl ? ORBIT.ctrlWheel : ORBIT.wheel;
  return { ...s, zoom: clampZoom(s.zoom * Math.exp(-deltaY * k)) };
}

/** Safari's gesturechange, from the state at gesturestart (app23.js:L1865). */
export function gestureStep(
  s: OrbitState,
  g0: { pa: number; zoom: number },
  rotation: number,
  scale: number,
): OrbitState {
  return { ...s, pa: wrapDeg(g0.pa + rotation), zoom: clampZoom(g0.zoom * scale) };
}

/** A key (app23.js:L1868–1874); null when the key does nothing. */
export function keyStep(s: OrbitState, key: string): OrbitState | null {
  switch (key) {
    case 'ArrowLeft':
      return { ...s, az: wrapDeg(s.az - ORBIT.keyAz) };
    case 'ArrowRight':
      return { ...s, az: (s.az + ORBIT.keyAz) % 360 };
    case 'ArrowUp':
      return { ...s, incl: clamp(s.incl - ORBIT.keyIncl, 0, 180) };
    case 'ArrowDown':
      return { ...s, incl: clamp(s.incl + ORBIT.keyIncl, 0, 180) };
    case 'q':
    case 'Q':
      return rollBy(s, -ORBIT.keyRoll);
    case 'e':
    case 'E':
      return rollBy(s, ORBIT.keyRoll);
    case '+':
    case '=':
      return { ...s, zoom: clampZoom(s.zoom * ORBIT.keyZoom) };
    case '-':
    case '_':
      return { ...s, zoom: clampZoom(s.zoom / ORBIT.keyZoom) };
    case '0':
      return { ...s, zoom: 1 };
    default:
      return null;
  }
}

/** Safari's GestureEvent (not in the DOM typings). */
interface GestureEvent extends UIEvent {
  rotation: number;
  scale: number;
}

export interface OrbitTarget {
  /** the camera now */
  get(): OrbitState;
  /** a new camera; the page draws it on the next animation frame */
  set(s: OrbitState): void;
}

/**
 * Wires v21's orbit controls to `canvas`. Returns a function that removes them. The canvas may be
 * replaced by the page (a new engine needs a new canvas): attach again to the new one.
 */
export function attachOrbit(canvas: HTMLCanvasElement, target: OrbitTarget): () => void {
  const ptrs = new Map<number, [number, number]>();
  let last2: TwoFingers | null = null;
  let rolling = false;
  let g0: { pa: number; zoom: number } | null = null;
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  canvas.tabIndex = 0;
  if (!canvas.getAttribute('aria-label'))
    canvas.setAttribute(
      'aria-label',
      'Galaxy plate: drag to orbit, shift-drag to roll, arrows to turn, Q and E to roll, + and − to zoom, 0 to reset the zoom',
    );
  const two = () => {
    const [a, b] = [...ptrs.values()];
    return twoFingers(a ?? [0, 0], b ?? [0, 0]);
  };
  const centre = (): [number, number] => {
    const b = canvas.getBoundingClientRect();
    return [b.left + b.width / 2, b.top + b.height / 2];
  };
  const off: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ) => {
    canvas.addEventListener(type, fn, opts);
    off.push(() => {
      canvas.removeEventListener(type, fn, opts);
    });
  };
  const onGesture = (type: string, fn: (e: GestureEvent) => void) => {
    const h = (e: Event) => {
      fn(e as GestureEvent);
    };
    canvas.addEventListener(type, h);
    off.push(() => {
      canvas.removeEventListener(type, h);
    });
  };

  on('contextmenu', (e) => {
    e.preventDefault();
  });
  on('pointerdown', (e) => {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer cannot be captured; the drag still works inside the canvas */
    }
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    canvas.style.cursor = 'grabbing';
    rolling = ptrs.size === 1 && (e.shiftKey || e.button === 2);
    if (ptrs.size === 2) last2 = two();
  });
  on('pointermove', (e) => {
    const prev = ptrs.get(e.pointerId);
    if (!prev) return;
    const now: [number, number] = [e.clientX, e.clientY];
    ptrs.set(e.pointerId, now);
    if (ptrs.size === 1) {
      const s = target.get();
      target.set(
        rolling
          ? rollStep(s, prev, now, centre())
          : dragStep(s, now[0] - prev[0], now[1] - prev[1]),
      );
    } else if (ptrs.size === 2 && last2) {
      const t = two();
      target.set(pinchStep(target.get(), last2, t));
      last2 = t;
    }
  });
  const up = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
    last2 = ptrs.size === 2 ? two() : null;
    if (!ptrs.size) {
      canvas.style.cursor = 'grab';
      rolling = false;
    }
  };
  on('pointerup', up);
  on('pointercancel', up);
  on(
    'wheel',
    (e) => {
      e.preventDefault();
      target.set(wheelStep(target.get(), e.deltaY, e.ctrlKey));
    },
    { passive: false },
  );
  onGesture('gesturestart', (e) => {
    e.preventDefault();
    const s = target.get();
    g0 = { pa: s.pa, zoom: s.zoom };
  });
  onGesture('gesturechange', (e) => {
    e.preventDefault();
    if (!g0 || ptrs.size >= 2) return;
    target.set(gestureStep(target.get(), g0, e.rotation, e.scale));
  });
  onGesture('gestureend', (e) => {
    e.preventDefault();
    g0 = null;
  });
  on('dblclick', () => {
    target.set({ ...target.get(), zoom: 1 });
  });
  on('keydown', (e) => {
    const s = keyStep(target.get(), e.key);
    if (!s) return;
    e.preventDefault();
    target.set(s);
  });
  return () => {
    off.forEach((f) => {
      f();
    });
  };
}
