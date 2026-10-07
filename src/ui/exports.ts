/**
 * M12's two exports, as buttons beside Export PNG (M11's `Page.addExport`): the SVG for pen
 * plotters (one layer per pen) and the GIF of the merger's timeline or a lensed quasar's flare.
 *
 * Both read the engine inside its frame queue (`ExportSource.exclusive`): the SVG copies the last
 * drawing's layers back (the WebGPU buffers, or the CPU worker's arrays), and the GIF draws each
 * moment of the timeline at the GIF's size, ink alone, with the page's `mTime` left where it is.
 * They export the key ink whatever plates the plate shows, as v21 does for its SVG.
 */
import { gifColours } from '../extras/export/gif';
import { exportSvgOf, svgFileName } from '../extras/export/engine';
import { encodeInWorker, gifFileName, recordGif } from '../extras/export/record';
import { isTimeline, timelineSource } from '../extras/export/sources';
import { SVG_LAYERS } from '../extras/export/svg';
import { downloadBlob } from './export';
import type { Page } from './page';

/** v21's GIF sizes and frame counts, and the defaults the page opens with. */
export const GIF_SIZES = [320, 480, 640] as const;
export const GIF_FRAMES = [24, 36, 60, 90] as const;

function choice(id: string, allowed: readonly number[], fallback: number): number {
  const e = document.getElementById(id);
  const v = e instanceof HTMLSelectElement ? Number(e.value) : NaN;
  return allowed.includes(v) ? v : fallback;
}

export function addExtraExports(page: Page): void {
  page.addExport({
    id: 'svg',
    label: 'Export SVG',
    async run(source, p) {
      p.say('Preparing the SVG…');
      const { svg, counts } = await source.exclusive(() => exportSvgOf(source));
      const name = svgFileName(p.state().P.seed);
      downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), name);
      const layers = SVG_LAYERS.filter((k) => counts[k] > 0);
      const total = layers.reduce((a, k) => a + counts[k], 0);
      p.say(
        `Saved ${name}: ${total.toLocaleString('en-GB')} marks in ${String(layers.length)} layers (${layers.join(', ')}).`,
      );
    },
  });

  const gif = page.addExport({
    id: 'gif',
    label: 'Export GIF',
    available: (s) => isTimeline(s.P),
    async run(source, p) {
      const { P, surface } = p.state();
      if (!isTimeline(P)) throw new Error('the GIF animates a merger or a lensed quasar');
      const size = choice('gif-size', GIF_SIZES, 320);
      const frames = choice('gif-frames', GIF_FRAMES, 36);
      const t = p.timeline();
      const bytes = await source.exclusive((x) =>
        recordGif(
          timelineSource(size, size, P, (Q) => x.ink(Q, size)),
          { frames, end: t.end, speed: t.speed, ...gifColours(surface), mode: 'ramp' },
          encodeInWorker,
          (k, n) => {
            p.say(`Rendering ${String(k)} / ${String(n)}…`);
          },
        ),
      );
      const name = gifFileName(P.seed);
      downloadBlob(new Blob([bytes as BlobPart], { type: 'image/gif' }), name);
      p.say(`Saved ${name}: ${String(frames)} frames, ${String(size)} px.`);
    },
  });
  gif.title = 'An animated GIF of the timeline, from 0 to its end, drawn at the size set below it';
}
