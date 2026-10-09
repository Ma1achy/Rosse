/**
 * M12's panels, in the Choose tab: the 42 real galaxies, each a print with its SDSS photograph and,
 * once drawn, the photograph beside Rosse's drawing of it; and the Galaxy Zoo 2 catalogue, 239,695
 * galaxies to search, filter and draw. A galaxy that is not a preset is drawn through
 * `Page.setGalaxy` and written in the link as `?from=real:<n>` or `?from=gz2:<DR7 object id>`.
 *
 * The attribution the data needs (docs/open-questions.md Q1) is in the cards themselves: each
 * real-galaxy print carries it as its title and the open card prints it in full, as does a
 * catalogue galaxy's card. The catalogue (7 MB, 16 MiB decoded) is fetched when the viewer opens
 * it, never at page start, in a worker, and the worker is closed when the viewer closes it.
 */
import { ATTRIBUTION, type Attribution } from '../extras/attribution';
import type { CatalogueClient } from '../extras/catalogue/client';
import type { GalaxyCard } from '../extras/catalogue/service';
import { GALAXY_TYPE_NAMES, type GalaxyType } from '../extras/catalogue/tools';
import { realCard, realCards, type RealCard } from '../extras/real/real-galaxies';
import type { ExportSource } from './export';
import { setText } from './controls';
import type { GalaxyChoice, Page } from './page';

const catalogueFiles = import.meta.glob<string>('../../assets/data/rosse/gz2-catalogue.json', {
  eager: true,
  query: '?url',
  import: 'default',
});
const CATALOGUE_URL = Object.values(catalogueFiles)[0] ?? '';

let client: Promise<CatalogueClient> | null = null;

/** The catalogue's worker, made on first use. */
async function catalogue(): Promise<CatalogueClient> {
  client ??= import('../extras/catalogue/client').then(async (m) => {
    const c = new m.CatalogueClient();
    try {
      await c.load(CATALOGUE_URL);
    } catch (e) {
      c.close();
      client = null;
      throw e;
    }
    return c;
  });
  return client;
}

/** Frees the catalogue (the worker holds 16 MiB). */
function closeCatalogue(): void {
  const c = client;
  client = null;
  void c?.then((x) => {
    x.close();
  });
}

/** The page draws a disc galaxy with its natural dust (`dustAuto`, ADR 0075), as it does a preset. */
const PAGE_DUST = { dustAuto: 1, bulgeAuto: 1 } as const;

/** What a catalogue galaxy is drawn as, from its card. */
function choiceOfCard(card: GalaxyCard): GalaxyChoice {
  return {
    from: `gz2:${card.galaxy.objid}`,
    P: { ...card.mapping.p, ...PAGE_DUST },
    label: `${card.caption.shortType}, ${card.galaxy.objid}`,
  };
}

function choiceOfReal(card: RealCard): GalaxyChoice {
  return {
    from: `real:${String(card.index)}`,
    P: { ...card.params, ...PAGE_DUST },
    label: card.caption,
    thumb: card.photoUrl,
  };
}

/**
 * The galaxy a link's `from` names, ready to draw: `real:<n>` at once, `gz2:<objid>` after the
 * catalogue has loaded. Null for anything else, or a galaxy that is not there.
 */
export async function resolveGalaxy(from: string): Promise<GalaxyChoice | null> {
  const real = /^real:(\d+)$/.exec(from);
  if (real) {
    const i = Number(real[1]);
    return i < 42 ? choiceOfReal(realCard(i)) : null;
  }
  const gz = /^gz2:(\d{15,20})$/.exec(from);
  if (!gz) return null;
  const c = await catalogue();
  const found = await c.find(gz[1] as string);
  return found.kind === 'galaxy' ? choiceOfCard(await c.card(found.index)) : null;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** The credit, licence, changes and SDSS lines of an attribution, as one block. */
function creditBlock(a: Attribution): HTMLElement {
  const p = el('p', 'credit');
  const lic = el('a', undefined, a.licence.name);
  lic.href = a.licence.url;
  lic.rel = 'noreferrer';
  p.append(`${a.credit} Licence: `, lic, `. ${a.changes} ${a.sdss}`);
  return p;
}

/** A link that opens SkyServer's page for the galaxy. */
function skyServerLink(url: string, text: string): HTMLAnchorElement {
  const a = el('a', 'ext', text);
  a.href = url;
  a.rel = 'noreferrer';
  a.target = '_blank';
  return a;
}

/** The middle three quarters of the plate's pixels as a small canvas (as the preset thumbnails). */
function drawingCanvas(px: { px: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }) {
  const full = el('canvas');
  full.width = px.width;
  full.height = px.height;
  full.getContext('2d')?.putImageData(new ImageData(px.px, px.width, px.height), 0, 0);
  const out = el('canvas', 'drawing');
  out.width = out.height = 160;
  const margin = px.width * 0.125;
  const side = px.width * 0.75;
  out.getContext('2d')?.drawImage(full, margin, margin, side, side, 0, 0, 160, 160);
  out.setAttribute('role', 'img');
  return out;
}

export interface GalaxyPanels {
  /** the page has drawn a galaxy from a link: show its card (the photograph, or the caption) */
  show(from: string): void;
}

/** Builds the two panels into the Choose tab. */
export function mountGalaxyPanels(page: Page, source: ExportSource): GalaxyPanels {
  const real = el('section', 'cards galaxies');
  real.setAttribute('aria-labelledby', 'gal-real-h');
  const rh = el('h3', undefined, 'Real galaxies');
  rh.id = 'gal-real-h';
  const rhint = el(
    'p',
    'pane-hint',
    'Forty-two galaxies photographed by the Sloan Digital Sky Survey. Pick a print and Rosse draws what Galaxy Zoo’s volunteers saw in it.',
  );
  const open = el('div', 'galaxy-card');
  open.id = 'real-open';
  open.hidden = true;
  const grid = el('div', 'card-list prints');
  const prints = new Map<number, HTMLButtonElement>();
  const cards = realCards();
  for (const c of cards) {
    const b = el('button', 'card print-card');
    b.type = 'button';
    b.dataset.real = String(c.index);
    b.title = c.attribution.text;
    b.style.setProperty('--tilt', `${String(c.rotationDeg)}deg`);
    const th = el('span', 'card-th');
    const img = el('img');
    img.src = c.photoUrl;
    img.alt = '';
    img.width = img.height = 160;
    img.loading = 'lazy';
    img.decoding = 'async';
    th.append(img);
    const t = el('span', 'card-title', c.caption);
    const d = el('span', 'card-desc', `Galaxy ${String(c.index + 1)} of 42`);
    b.append(th, t, d);
    b.addEventListener('click', () => {
      page.setGalaxy(choiceOfReal(c));
      void showReal(c);
    });
    grid.append(b);
    prints.set(c.index, b);
  }
  real.append(
    rh,
    rhint,
    open,
    grid,
    el('p', 'credit', cards[0]?.attribution.text ?? ATTRIBUTION.text),
  );

  /** the open card: the photograph beside the drawing, and what each says */
  const showReal = async (c: RealCard) => {
    for (const [i, b] of prints) b.setAttribute('aria-pressed', String(i === c.index));
    open.hidden = false;
    open.replaceChildren();
    const figs = el('div', 'compare');
    const photo = el('figure');
    const pimg = el('img');
    pimg.src = c.photoUrl;
    pimg.alt = `The SDSS photograph of galaxy ${String(c.index + 1)}`;
    pimg.width = pimg.height = 160;
    photo.append(pimg, el('figcaption', undefined, 'The photograph'));
    const drawn = el('figure');
    const holder = el('div', 'drawing-holder');
    drawn.append(holder, el('figcaption', undefined, 'Rosse’s drawing'));
    figs.append(photo, drawn);
    const words = el('p', 'compare-words');
    words.textContent =
      `The photograph shows an axis ratio of ${c.photoQ.toFixed(2)} at ${c.photoPa.toFixed(0)}°; ` +
      `Rosse draws it tilted ${c.drawnIncl.toFixed(0)}° with its long side at ${c.drawnPa.toFixed(0)}°. ${c.description}`;
    const links = el('p', 'galaxy-links');
    links.append(skyServerLink(c.skyServerUrl, 'See the real one on SkyServer'));
    open.append(figs, words, links, creditBlock(c.attribution));
    try {
      // queued after the frame this click asked for: the pixels of the new drawing
      const px = await source.snapshot();
      if (page.state().from === `real:${String(c.index)}`) holder.append(drawingCanvas(px));
    } catch (e) {
      holder.textContent = `The drawing could not be copied: ${String(e)}`;
    }
  };

  // ---- the catalogue
  const cat = el('section', 'cards galaxies');
  cat.setAttribute('aria-labelledby', 'gal-cat-h');
  const ch = el('h3', undefined, 'Galaxy Zoo 2');
  ch.id = 'gal-cat-h';
  const chint = el(
    'p',
    'pane-hint',
    'Any of 239,695 galaxies classified by Galaxy Zoo’s volunteers. The catalogue is 7 MB: it is fetched when you open it.',
  );
  const openCat = el('button', 'btn', 'Open the catalogue');
  openCat.type = 'button';
  openCat.id = 'cat-open';
  const body = el('div', 'cat-body');
  body.hidden = true;
  const state = el('p', 'cat-state');
  state.setAttribute('role', 'status');

  const typeSel = el('select');
  typeSel.id = 'cat-type';
  for (const t of GALAXY_TYPE_NAMES) typeSel.append(new Option(t, t));
  const typeLab = el('label', 'cat-field', 'Type ');
  typeLab.htmlFor = 'cat-type';
  typeLab.append(typeSel);
  const randomBtn = el('button', 'btn', 'One of these, at random');
  randomBtn.type = 'button';
  randomBtn.id = 'cat-random';

  const findIn = el('input', 'cat-text');
  findIn.id = 'cat-find';
  findIn.type = 'text';
  findIn.placeholder = 'DR7 object id, or RA, Dec';
  findIn.autocomplete = 'off';
  const findLab = el('label', 'cat-field', 'Find ');
  findLab.htmlFor = 'cat-find';
  findLab.append(findIn);
  const findBtn = el('button', 'btn', 'Find');
  findBtn.type = 'button';
  findBtn.id = 'cat-find-go';

  const range = (id: string, label: string, placeholder: string) => {
    const i = el('input', 'num');
    i.id = id;
    i.type = 'text';
    i.inputMode = 'decimal';
    i.size = 5;
    i.placeholder = placeholder;
    const l = el('label', 'cat-field', `${label} `);
    l.htmlFor = id;
    l.append(i);
    return { input: i, label: l };
  };
  const grMin = range('cat-gr-min', 'Colour g−r from', '0.2');
  const grMax = range('cat-gr-max', 'to', '1.0');
  const zMax = range('cat-z-max', 'Redshift up to', '0.1');
  const searchBtn = el('button', 'btn', 'Search');
  searchBtn.type = 'button';
  searchBtn.id = 'cat-search';
  const results = el('div', 'card-list cat-results');
  results.id = 'cat-results';
  const more = el('button', 'btn', 'More');
  more.type = 'button';
  more.hidden = true;
  const closeBtn = el('button', 'btn', 'Close the catalogue');
  closeBtn.type = 'button';
  closeBtn.id = 'cat-close';
  const catOpen = el('div', 'galaxy-card');
  catOpen.id = 'cat-open-card';
  catOpen.hidden = true;

  const typeRow = el('div', 'cat-row');
  typeRow.append(typeLab, randomBtn);
  const findRow = el('div', 'cat-row');
  findRow.append(findLab, findBtn);
  const filters = el('div', 'cat-row');
  filters.append(grMin.label, grMax.label, zMax.label, searchBtn);
  body.append(typeRow, findRow, filters, state, results, more, catOpen, closeBtn);
  cat.append(ch, chint, openCat, body);

  const say = (t: string) => {
    setText(state, t);
  };
  const number = (i: HTMLInputElement): number | undefined => {
    const t = i.value.trim();
    if (t === '') return undefined;
    const v = Number(t);
    return Number.isFinite(v) ? v : NaN;
  };

  /** draws a catalogue card and shows its words */
  const drawCard = (card: GalaxyCard) => {
    page.setGalaxy(choiceOfCard(card));
    showCatalogueCard(card);
  };
  const showCatalogueCard = (card: GalaxyCard) => {
    catOpen.hidden = false;
    catOpen.replaceChildren();
    const words = el('p', 'compare-words', card.caption.text);
    words.append(skyServerLink(card.caption.skyServerUrl, 'See the real one on SkyServer ↗'));
    catOpen.append(words, creditBlock(card.attribution));
  };
  const drawIndex = async (index: number) => {
    const c = await catalogue();
    drawCard(await c.card(index));
  };

  let lastQuery: {
    where: { field: 'gr' | 'z'; min?: number; max?: number }[];
    type: GalaxyType;
  } | null = null;
  let offset = 0;
  const PAGE = 12;
  const list = async (append: boolean) => {
    if (!lastQuery) return;
    const c = await catalogue();
    const r = await c.filter({
      type: lastQuery.type,
      where: lastQuery.where,
      offset,
      limit: PAGE,
    });
    if (!append) results.replaceChildren();
    const cards = await Promise.all(Array.from(r.indices, (i) => c.card(i)));
    for (const card of cards) {
      const b = el('button', 'card cat-card');
      b.type = 'button';
      b.dataset.objid = card.galaxy.objid;
      b.append(
        el('span', 'card-title', card.caption.shortType),
        el(
          'span',
          'card-desc',
          `RA ${card.galaxy.ra.toFixed(2)}, Dec ${card.galaxy.dec.toFixed(2)}`,
        ),
      );
      b.title = card.attribution.text;
      b.addEventListener('click', () => {
        drawCard(card);
      });
      results.append(b);
    }
    offset += cards.length;
    more.hidden = offset >= r.total;
    say(
      r.total
        ? `${r.total.toLocaleString('en-GB')} galaxies match; showing ${String(offset)}.`
        : 'No galaxy matches.',
    );
  };

  const guarded = (f: () => Promise<void>) => () => {
    f().catch((e: unknown) => {
      say(`The catalogue could not do that: ${e instanceof Error ? e.message : String(e)}`);
    });
  };
  openCat.addEventListener(
    'click',
    guarded(async () => {
      openCat.disabled = true;
      say('Loading the catalogue…');
      body.hidden = false;
      try {
        await catalogue();
      } catch (e) {
        body.hidden = true;
        openCat.disabled = false;
        throw e;
      }
      openCat.hidden = true;
      say('The catalogue is open.');
      typeSel.focus();
    }),
  );
  closeBtn.addEventListener('click', () => {
    closeCatalogue();
    body.hidden = true;
    openCat.hidden = false;
    openCat.disabled = false;
    results.replaceChildren();
    more.hidden = true;
    say('');
  });
  randomBtn.addEventListener(
    'click',
    guarded(async () => {
      const c = await catalogue();
      const i = await c.random(typeSel.value as GalaxyType);
      if (i === null) say('No galaxy of that type.');
      else {
        await drawIndex(i);
        say('');
      }
    }),
  );
  const find = guarded(async () => {
    const c = await catalogue();
    const r = await c.find(findIn.value);
    if (r.kind === 'galaxy') {
      await drawIndex(r.index);
      say('');
    } else say(r.message);
  });
  findBtn.addEventListener('click', find);
  findIn.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') find();
  });
  for (const i of [grMin.input, grMax.input, zMax.input])
    i.addEventListener('keydown', (e) => {
      e.stopPropagation();
    });
  searchBtn.addEventListener(
    'click',
    guarded(async () => {
      const where: { field: 'gr' | 'z'; min?: number; max?: number }[] = [];
      const add = (field: 'gr' | 'z', min?: number, max?: number) => {
        if (Number.isNaN(min) || Number.isNaN(max)) throw new Error('a range is not a number');
        if (min !== undefined || max !== undefined)
          where.push({
            field,
            ...(min !== undefined ? { min } : {}),
            ...(max !== undefined ? { max } : {}),
          });
      };
      add('gr', number(grMin.input), number(grMax.input));
      add('z', undefined, number(zMax.input));
      lastQuery = { where, type: typeSel.value as GalaxyType };
      offset = 0;
      say('Searching…');
      await list(false);
    }),
  );
  more.addEventListener(
    'click',
    guarded(() => list(true)),
  );

  page.addChoose(real);
  page.addChoose(cat);

  return {
    show(from) {
      const m = /^real:(\d+)$/.exec(from);
      if (m) {
        const c = cards[Number(m[1])];
        if (c) void showReal(c);
        return;
      }
      const g = /^gz2:(\d{15,20})$/.exec(from);
      if (g)
        void (async () => {
          openCat.hidden = true;
          body.hidden = false;
          const c = await catalogue();
          const f = await c.find(g[1] as string);
          if (f.kind === 'galaxy') showCatalogueCard(await c.card(f.index));
        })().catch(() => undefined);
    },
  };
}
