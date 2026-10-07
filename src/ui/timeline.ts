/**
 * The timeline of the merger (and of a quasar's flare): play, scrub, an end, loop and speed, as
 * v21's (app23.js:L1648–1668). Time `t` runs 0 to the end, the moment the preset chose is 1; at
 * 1× the whole story from 0 to 2 takes 12 seconds, so a unit of t is 6 seconds, whatever the end.
 *
 * The state machine is pure (a clock is passed in), so it is unit-tested; the page drives it from
 * `requestAnimationFrame`. It writes only `mTime` (a view-tier input, ADR 0010: the model is not
 * redone), and never plays by itself: playing starts on the viewer's request, and looping starts
 * off for a viewer who asked for reduced motion.
 */

export interface TimelineState {
  playing: boolean;
  /** t when playing started, and the clock then (seconds) */
  from: number;
  t0: number;
  /** the end of the loop, 0.2 to 30 */
  end: number;
  /** playback speed, 0.25 to 4 */
  speed: number;
  loop: boolean;
}

/** Seconds of playing per unit of t at 1× (v21: TL_BASE 12 s for 0 to 2). */
export const SECONDS_PER_UNIT = 6;
export const END_MIN = 0.2;
export const END_MAX = 30;

export function initialTimeline(reducedMotion: boolean): TimelineState {
  return { playing: false, from: 0, t0: 0, end: 2, speed: 1, loop: !reducedMotion };
}

/** What v21 says under the scrubber (tlPhase, L1649). */
export function phase(t: number, quasar = false): string {
  if (quasar) return 'the flare reaches the images in turn';
  return t < 0.97
    ? 'approach'
    : t <= 1.03
      ? 'the moment you chose'
      : t <= 2
        ? 'after'
        : 'long after';
}

/** The end of the loop as typed: clamped, or null for something that is not a number. */
export function parseEnd(text: string): number | null {
  const v = parseFloat(text.replace(',', '.'));
  return Number.isFinite(v) ? Math.min(END_MAX, Math.max(END_MIN, v)) : null;
}

/**
 * The horizon the simulation needs for an end: as far as the end asks, never under 2 (v21's
 * `tlSetEnd`, L1659).
 */
export function horizonFor(end: number, current: number): number {
  if (end > current) return Math.ceil(end);
  return end <= 2 ? 2 : current;
}

/** Starts playing from where t is, or from the start when it is at the end (L1651). */
export function start(s: TimelineState, t: number, now: number): TimelineState {
  return { ...s, playing: true, from: t < s.end - 0.01 ? t : 0, t0: now };
}

export function stop(s: TimelineState): TimelineState {
  return { ...s, playing: false };
}

/** Restarts the clock at the current t, after the speed or the loop changes while playing. */
export function rebase(s: TimelineState, t: number, now: number): TimelineState {
  return s.playing ? { ...s, from: t, t0: now } : s;
}

/**
 * The t at a clock reading, and whether playing goes on: looping wraps round the end; playing once
 * stops at the end.
 */
export function step(s: TimelineState, now: number): { t: number; playing: boolean } {
  const t = s.from + ((now - s.t0) * s.speed) / SECONDS_PER_UNIT;
  if (s.loop) return { t: t % s.end, playing: true };
  return t >= s.end ? { t: s.end, playing: false } : { t, playing: true };
}
