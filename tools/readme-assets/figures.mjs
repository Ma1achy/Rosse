// @ts-check
/**
 * The poster grid of the README's stills, as HTML that Chromium screenshots (lib.mjs `figures`):
 * the banner's language (design-language/DESIGN-LANGUAGE.md): cream Paper, one ink, hairline grid,
 * Heros for titles and IBM Plex Mono for captions. No red or magenta: colour is the engine's own,
 * inside the plates, and nowhere else. Every function returns one self-contained HTML string; image
 * paths are root-absolute (the static server's root is the repository).
 */

const esc = (/** @type {string} */ s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const WIDTH = 1100;

const CSS = `
@font-face{font-family:'Heros';src:url('/assets/fonts/Heros-700.otf') format('opentype');font-weight:700}
@font-face{font-family:'Heros';src:url('/assets/fonts/Heros-400.otf') format('opentype');font-weight:400}
@font-face{font-family:'Plex Mono';src:url('/assets/fonts/ibm-plex-mono/IBMPlexMono-400.woff2') format('woff2');font-weight:400}
@font-face{font-family:'Plex Mono';src:url('/assets/fonts/ibm-plex-mono/IBMPlexMono-600.woff2') format('woff2');font-weight:600}
:root{--ground:#efe9dc;--ink:#1d1b19;--ink2:#6f6a5f;--hair:#c9c2b2;--field:#e6dece;--chalk:#262b28;--on-chalk:#efe9dc}
*{box-sizing:border-box;margin:0}
html,body{width:${WIDTH}px;background:var(--ground)}
body{font-family:'Heros','Helvetica Neue',Arial,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;padding:26px 28px 22px}
.mono{font-family:'Plex Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;line-height:1.55;font-weight:400}
.mono b{font-weight:600}
.dim{color:var(--ink2)}
header{display:flex;align-items:flex-end;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--ink)}
header .n{font-family:'Plex Mono',monospace;font-weight:600;font-size:11px;letter-spacing:.3em;text-transform:uppercase}
header h1{font-weight:700;font-size:34px;letter-spacing:-.045em;line-height:1;margin-left:18px;flex:1}
.grid{display:grid;gap:1px;background:var(--hair);border-bottom:1px solid var(--hair);border-left:1px solid var(--hair);border-right:1px solid var(--hair)}
.cell{background:var(--ground);padding:12px 12px 10px}
.cell .pl{position:relative;aspect-ratio:1/1;overflow:hidden;background:var(--field)}
.cell .pl img{position:absolute;inset:0;width:100%;height:100%;display:block}
.cell .cap{display:flex;gap:10px;margin-top:9px}
.cell .cap .k{min-width:30px}
footer{display:flex;justify-content:space-between;padding-top:9px}
.bar{height:5px;background:var(--hair);margin:3px 0 8px;position:relative}
.bar i{position:absolute;left:0;top:0;bottom:0;background:var(--ink)}
.row{display:flex;justify-content:space-between}
.note{margin-top:10px}
`;

/** The page shell. */
function page(
  /** @type {string} */ fig,
  /** @type {string} */ title,
  /** @type {string} */ body,
  /** @type {string} */ foot,
) {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>
<header><span class="n">Fig. ${esc(fig)}</span><h1>${esc(title)}</h1><span class="mono dim">Rosse &middot; drawn by the engine</span></header>
${body}
<footer><span class="mono dim">${foot}</span><span class="mono dim">Paper &middot; ink on cream</span></footer>
</body></html>`;
}

/**
 * A strip: `cols` columns of plates with captions.
 * @param {{fig: string, title: string, cols: number, note?: string,
 *   cells: Array<{img: string, label: string, sub?: string, surface?: string}>}} f
 */
export function strip(f) {
  const cells = f.cells
    .map(
      (c, i) =>
        `<div class="cell"><div class="pl" ${c.surface === 'chalk' ? 'style="background:var(--chalk)"' : ''}><img src="${esc(c.img)}" alt=""></div>
<div class="cap mono"><span class="k"><b>${esc(f.fig)}.${String(i + 1)}</b></span><span><b>${esc(c.label)}</b>${c.sub ? `<br><span class="dim">${esc(c.sub)}</span>` : ''}</span></div></div>`,
    )
    .join('\n');
  // fill the last row so the grid has no ragged hairlines
  const empty = (f.cols - (f.cells.length % f.cols)) % f.cols;
  const fill = Array.from({ length: empty }, () => '<div class="cell"></div>').join('');
  const body = `<div class="grid" style="grid-template-columns:repeat(${String(f.cols)},1fr)">${cells}${fill}</div>${
    f.note ? `<p class="mono dim note">${esc(f.note)}</p>` : ''
  }`;
  return page(f.fig, f.title, body, 'Parameters and seeds: tools/readme-assets/plan.mjs');
}

/**
 * The contact sheet of every preset.
 * @param {{fig: string, title: string, cols: number,
 *   cells: Array<{img: string, label: string, sub?: string}>}} f
 */
export function sheet(f) {
  const cells = f.cells
    .map(
      (c, i) =>
        `<div class="cell" style="padding:8px 8px 7px"><div class="pl"><img src="${esc(c.img)}" alt=""></div>
<div class="cap mono" style="margin-top:6px;font-size:8.5px;letter-spacing:.08em"><span class="k" style="min-width:20px"><b>${String(i + 1).padStart(2, '0')}</b></span><span>${esc(c.label)}</span></div></div>`,
    )
    .join('\n');
  const empty = (f.cols - (f.cells.length % f.cols)) % f.cols;
  const fill = Array.from({ length: empty }, () => '<div class="cell"></div>').join('');
  return page(
    f.fig,
    f.title,
    `<div class="grid" style="grid-template-columns:repeat(${String(f.cols)},1fr)">${cells}${fill}</div>`,
    'Every preset of src/core/presets.ts, seed 7, as the page draws it',
  );
}

/**
 * A plate beside its data. Left: the photograph, if there is one; middle: Rosse's drawing; right:
 * the votes and what is known of the galaxy.
 * @param {{fig: string, title: string, photo?: string, photoNote?: string, drawing: string,
 *   lines: Array<[string, string]>, bars?: Array<[string, number]>, caption: string, credit: string}} f
 */
export function pair(f) {
  const cols = f.photo ? '1fr 1fr 250px' : '1.6fr 250px';
  const photo = f.photo
    ? `<div class="cell"><div class="pl"><img src="${esc(f.photo)}" alt="" style="image-rendering:auto"></div><div class="cap mono"><span><b>Photograph</b><br><span class="dim">${esc(f.photoNote ?? '')}</span></span></div></div>`
    : '';
  const lines = f.lines
    .map(
      ([k, v]) =>
        `<div class="row mono"><span class="dim">${esc(k)}</span><span>${esc(v)}</span></div>`,
    )
    .join('');
  const bars = (f.bars ?? [])
    .map(
      ([k, v]) =>
        `<div class="row mono"><span>${esc(k)}</span><span>${v.toFixed(2)}</span></div><div class="bar"><i style="width:${String(Math.round(Math.min(1, v) * 100))}%"></i></div>`,
    )
    .join('');
  const body = `<div class="grid" style="grid-template-columns:${cols}">
${photo}
<div class="cell"><div class="pl"><img src="${esc(f.drawing)}" alt=""></div><div class="cap mono"><span><b>Rosse</b><br><span class="dim">${esc(f.caption)}</span></span></div></div>
<div class="cell" style="padding:14px 16px">${lines}<div style="height:12px"></div>${bars}</div>
</div><p class="mono dim note">${esc(f.credit)}</p>`;
  return page(f.fig, f.title, body, 'Votes: Galaxy Zoo 2, CC BY 4.0');
}
