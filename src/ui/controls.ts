/**
 * The control panel, built from the schema and the layout (src/ui/layout.ts): a slider with a
 * typeable value for a number, a group of radio buttons for a choice of up to three options and a
 * menu for more, and off/on buttons for the switches v21 shows as such. The panel keeps no state of
 * its own: it reads parameters with `get`, reports a change with `set`, and `sync` brings every
 * control to the parameters (after a preset, the orbit or the URL changes them).
 *
 * The Galaxy, Sky and Ink tabs are v21's recipe: a stack of cards, one for each part of the picture
 * (a name, a summary of its settings in words, its main controls, and more behind a disclosure). A
 * part that can be left out has a "Take out" button and an "Add" button in its tab. The Merger tab
 * has one card whose controls are disabled until the merger is switched on.
 *
 * Accessibility: every control has a visible label tied to it (`label for`, or a `fieldset` with a
 * `legend` for a group of radios); sliders are native `input[type=range]` (arrow keys, Home, End,
 * Page keys), with the value also in a text box that takes a typed number; the tabs follow the
 * WAI-ARIA tabs pattern (arrow keys, Home, End; the panel is a tab stop of its own); a card's
 * header is a button with `aria-expanded`; a part that is switched off is a disabled `fieldset`,
 * so its controls are skipped and announced as unavailable.
 */
import type { ParamKey, Params } from '../core/params';
import { SCHEMA, type ChoiceSpec, type NumberSpec } from '../core/schema';
import {
  componentsOf,
  decimalsOf,
  endLabel,
  isOn,
  optionLabel,
  TABS,
  TOGGLES,
  visibleTabs,
  type Component,
  type Features,
  type IconSpec,
  type TabId,
} from './layout';

export interface PanelHost {
  get(): Params;
  /** a control changed a parameter */
  set(key: ParamKey, value: number | string): void;
}

type El<K extends keyof HTMLElementTagNameMap> = HTMLElementTagNameMap[K];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): El<K> {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** What the options of a choice are: radio buttons up to three, else a menu. */
export const RADIO_MAX = 3;

interface Control {
  /** brings the control to the parameters */
  sync(P: Params): void;
}

function sliderControl(
  key: ParamKey,
  spec: NumberSpec,
  host: PanelHost,
): { root: HTMLElement } & Control {
  const dec = decimalsOf(spec.step);
  const id = `c-${key}`;
  const root = el('div', 'field slider');
  root.dataset.key = key;
  const label = el('label', undefined, spec.label);
  label.htmlFor = id;
  const row = el('div', 'slider-row');
  const track = el('div', 'track');
  const range = el('input');
  range.type = 'range';
  range.id = id;
  range.min = String(spec.min);
  range.max = String(spec.max);
  range.step = String(spec.step);
  const ticks = el('div', 'ticks');
  ticks.setAttribute('aria-hidden', 'true');
  ticks.append(el('span', undefined, endLabel(spec.min, spec.step)));
  if (spec.min < 0 && spec.max > 0) ticks.append(el('span', undefined, '0'));
  ticks.append(el('span', undefined, endLabel(spec.max, spec.step)));
  track.append(range, ticks);
  const valueBox = el('div', 'value');
  const num = el('input', 'num');
  num.type = 'text';
  num.inputMode = 'decimal';
  num.id = `${id}-n`;
  num.setAttribute('aria-label', `${spec.label}, value`);
  num.autocomplete = 'off';
  valueBox.append(num);
  if (spec.unit) {
    num.classList.add('has-unit');
    valueBox.append(el('span', 'unit', spec.unit));
  }
  row.append(track, valueBox);
  root.append(label, row);

  const paint = (v: number) => {
    const hi = Number(range.max);
    const f = hi === spec.min ? 0 : ((v - spec.min) / (hi - spec.min)) * 100;
    range.style.setProperty('--fill', `${String(Math.min(100, Math.max(0, f)))}%`);
    range.setAttribute('aria-valuetext', `${v.toFixed(dec)}${spec.unit ?? ''}`);
    if (document.activeElement !== num) num.value = v.toFixed(dec);
  };
  range.addEventListener('input', () => {
    const v = parseFloat(range.value);
    paint(v);
    host.set(key, v);
  });
  num.addEventListener('change', () => {
    const v = parseFloat(num.value.replace(',', '.'));
    if (Number.isFinite(v)) {
      const c = Math.min(spec.max, Math.max(spec.min, v));
      if (c > Number(range.max)) range.max = String(c);
      range.value = String(c);
      host.set(key, c);
    }
    paint(Number(host.get()[key]));
  });
  num.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') num.blur();
    // the plate's keys and the page's must not act while typing a number
    e.stopPropagation();
  });
  num.addEventListener('blur', () => {
    paint(Number(host.get()[key]));
  });
  const maxTick = ticks.lastElementChild;
  return {
    root,
    sync(P) {
      const v = Number(P[key]);
      // the moment in the merger runs to the timeline's horizon (v21), not to the schema's limit
      if (key === 'mTime') {
        const max = Math.max(2, P.mHorizon);
        range.max = String(max);
        if (maxTick) maxTick.textContent = endLabel(max, spec.step);
      }
      if (document.activeElement !== range) range.value = String(v);
      paint(v);
    },
  };
}

/** A set of radio buttons, drawn as one segmented control. */
function radioControl(
  key: ParamKey,
  title: string,
  options: readonly { label: string; value: number | string }[],
  isOn: (P: Params, value: number | string) => boolean,
  pick: (value: number | string) => void,
): { root: HTMLElement } & Control {
  const root = el('fieldset', 'field choice');
  root.dataset.key = key;
  root.append(el('legend', undefined, title));
  const seg = el('div', 'seg');
  const inputs: HTMLInputElement[] = [];
  options.forEach((o, i) => {
    const label = el('label', 'opt');
    const input = el('input');
    input.type = 'radio';
    input.name = `c-${key}`;
    input.id = `c-${key}-${String(i)}`;
    input.value = String(o.value);
    input.addEventListener('change', () => {
      if (input.checked) pick(o.value);
    });
    label.append(input, el('span', undefined, o.label));
    seg.append(label);
    inputs.push(input);
  });
  root.append(seg);
  return {
    root,
    sync(P) {
      options.forEach((o, i) => {
        const input = inputs[i];
        if (input) input.checked = isOn(P, o.value);
      });
    },
  };
}

function selectControl(
  key: ParamKey,
  spec: ChoiceSpec,
  host: PanelHost,
): { root: HTMLElement } & Control {
  const root = el('div', 'field choice-menu');
  root.dataset.key = key;
  const label = el('label', undefined, spec.label);
  label.htmlFor = `c-${key}`;
  const select = el('select');
  select.id = `c-${key}`;
  for (const o of spec.options) select.add(new Option(optionLabel(key, o), String(o)));
  select.addEventListener('change', () => {
    const o = spec.options.find((x) => String(x) === select.value);
    if (o !== undefined) host.set(key, o);
  });
  root.append(label, select);
  return {
    root,
    sync(P) {
      select.value = String(P[key]);
    },
  };
}

function controlFor(key: ParamKey, host: PanelHost): { root: HTMLElement } & Control {
  const spec = SCHEMA[key];
  const on = TOGGLES[key];
  if (on !== undefined)
    return radioControl(
      key,
      spec.label,
      [
        { label: 'off', value: 0 },
        { label: 'on', value: on },
      ],
      (P, v) => Number(P[key]) > 0 === (v !== 0),
      (v) => {
        host.set(key, Number(v));
      },
    );
  if (spec.kind === 'number') return sliderControl(key, spec, host);
  if (spec.options.length > RADIO_MAX) return selectControl(key, spec, host);
  return radioControl(
    key,
    spec.label,
    spec.options.map((o) => ({ label: optionLabel(key, o), value: o })),
    (P, v) => String(P[key]) === String(v),
    (v) => {
      host.set(key, v);
    },
  );
}

interface Card {
  comp: Component;
  root: HTMLElement;
  summary: HTMLElement;
  header: HTMLButtonElement;
  body: HTMLElement;
  inner: HTMLFieldSetElement | null;
  hint: HTMLElement | null;
  take: HTMLButtonElement | null;
  controls: Control[];
}

export interface PanelOptions {
  host: PanelHost;
  features: Features;
  /** the Choose tab's own content (the preset cards) */
  choose: HTMLElement;
  /** a card's icon, from the library's drawings */
  icon?: (spec: IconSpec) => SVGElement | null;
  initial?: TabId;
}

/** Sets text only when it differs, so a screen reader is not told the same thing again. */
export function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

export class ControlPanel {
  readonly tabs: TabId[];
  private readonly cards: Card[] = [];
  private readonly buttons = new Map<TabId, HTMLButtonElement>();
  private readonly panes = new Map<TabId, HTMLElement>();
  private readonly adds = new Map<TabId, HTMLElement>();
  /** the value a part had when it was taken out, to put back */
  private readonly stash = new Map<ParamKey, number | string>();
  private current: TabId;
  private last: Params | null = null;
  private readonly host: PanelHost;

  constructor(root: HTMLElement, o: PanelOptions) {
    this.host = o.host;
    this.tabs = visibleTabs(o.features);
    this.current = this.tabs.includes(o.initial ?? 'choose') ? (o.initial ?? 'choose') : 'choose';
    const bar = el('div', 'tabs');
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Parts of the panel');
    root.append(bar);
    for (const t of TABS.filter((x) => this.tabs.includes(x.id))) {
      const b = el('button', `tab tab-${t.id}`);
      b.type = 'button';
      b.id = `tab-${t.id}`;
      // the hand-lettered tab is a picture of the word; the word is the button's name
      b.append(el('span', 'tab-label', t.label));
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', `pane-${t.id}`);
      b.addEventListener('click', () => {
        this.select(t.id);
      });
      b.addEventListener('keydown', (e) => {
        this.tabKey(e, t.id);
      });
      bar.append(b);
      this.buttons.set(t.id, b);
      const pane = el('div', 'pane');
      pane.id = `pane-${t.id}`;
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', b.id);
      pane.tabIndex = 0;
      pane.append(el('p', 'pane-hint', `${t.label}: ${t.hint}`));
      if (t.id === 'choose') pane.append(o.choose);
      else {
        const stack = el('div', 'rstack');
        for (const c of componentsOf(t.id, o.features)) {
          const card = this.card(c, o.icon);
          this.cards.push(card);
          stack.append(card.root);
        }
        const add = el('div', 'radd');
        this.adds.set(t.id, add);
        pane.append(stack, add);
      }
      root.append(pane);
      this.panes.set(t.id, pane);
    }
    this.select(this.current, false);
  }

  private card(c: Component, icon?: (spec: IconSpec) => SVGElement | null): Card {
    const host = this.host;
    const root = el('section', 'rcard');
    root.dataset.id = c.id;
    const top = el('h3', 'rc-top');
    const header = el('button', 'rc-hd');
    header.type = 'button';
    header.id = `rc-${c.id}-hd`;
    header.setAttribute('aria-controls', `rc-${c.id}-body`);
    const ic = icon?.(c.icon);
    if (ic) header.append(ic);
    const tx = el('span', 'rc-tx');
    const summary = el('span', 'rc-sm');
    tx.append(el('span', 'rc-nm', c.name), summary);
    header.append(tx, el('span', 'rc-chev'));
    top.append(header);
    const body = el('div', 'rc-body');
    body.id = `rc-${c.id}-body`;
    const setOpen = (open: boolean) => {
      header.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
    };
    header.addEventListener('click', () => {
      setOpen(header.getAttribute('aria-expanded') !== 'true');
    });
    setOpen(c.open === true);
    let take: HTMLButtonElement | null = null;
    if (c.on) {
      take = el('button', 'rc-take');
      take.type = 'button';
      take.setAttribute('aria-label', `Take the ${c.name.toLowerCase()} out`);
      take.append(el('span', undefined, 'Take out'));
      take.addEventListener('click', () => {
        const on = c.on;
        if (!on) return;
        this.stash.set(on.key, host.get()[on.key]);
        host.set(on.key, on.offVal);
        // the card has gone: the way back is the Add button for it
        this.adds.get(c.tab)?.querySelector<HTMLElement>(`[data-add="${c.id}"]`)?.focus();
      });
      top.append(take);
    }
    root.append(top, body);

    const controls: Control[] = [];
    let inner: HTMLFieldSetElement | null = null;
    let hint: HTMLElement | null = null;
    let into: HTMLElement = body;
    c.main.forEach((key, i) => {
      const ctl = controlFor(key, host);
      controls.push(ctl);
      if (c.gate && i === 0) {
        body.append(ctl.root);
        hint = el('p', 'hint', `Turn on “${SCHEMA[key].label}” to use the controls below.`);
        inner = el('fieldset', 'inner');
        body.append(hint, inner);
        into = inner;
      } else into.append(ctl.root);
    });
    if (c.more?.length) {
      const wrap = el('div', 'rc-morew');
      wrap.id = `rc-${c.id}-more`;
      wrap.hidden = true;
      const more = el('button', 'btn rc-more', 'More');
      more.type = 'button';
      more.setAttribute('aria-expanded', 'false');
      more.setAttribute('aria-controls', wrap.id);
      more.addEventListener('click', () => {
        const open = more.getAttribute('aria-expanded') !== 'true';
        more.setAttribute('aria-expanded', String(open));
        more.textContent = open ? 'Fewer' : 'More';
        wrap.hidden = !open;
      });
      for (const key of c.more) {
        const ctl = controlFor(key, host);
        controls.push(ctl);
        wrap.append(ctl.root);
      }
      into.append(more, wrap);
    }
    return { comp: c, root, summary, header, body, inner, hint, take, controls };
  }

  select(id: TabId, focus = false): void {
    this.current = id;
    for (const [k, b] of this.buttons) {
      const on = k === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      const pane = this.panes.get(k);
      if (pane) pane.hidden = !on;
    }
    if (focus) this.buttons.get(id)?.focus();
  }

  get tab(): TabId {
    return this.current;
  }

  /** Opens a card (a test, or a link to a part, may ask). */
  open(id: string): void {
    const card = this.cards.find((c) => c.comp.id === id);
    if (card && card.header.getAttribute('aria-expanded') !== 'true') card.header.click();
  }

  private tabKey(e: KeyboardEvent, id: TabId): void {
    const i = this.tabs.indexOf(id);
    const n = this.tabs.length;
    let to: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i + n - 1) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    const next = to === null ? undefined : this.tabs[to];
    if (next === undefined) return;
    e.preventDefault();
    this.select(next, true);
  }

  /** Brings every control to these parameters. */
  sync(P: Params): void {
    this.last = P;
    for (const card of this.cards) {
      const c = card.comp;
      for (const ctl of card.controls) ctl.sync(P);
      setText(card.summary, c.summary(P));
      const shown = c.show ? c.show(P) : true;
      card.root.hidden = !shown || (!c.gate && !isOn(c, P));
      if (card.take) card.take.hidden = false;
      if (card.inner) card.inner.disabled = !isOn(c, P);
      if (card.hint) card.hint.hidden = isOn(c, P);
    }
    this.renderAdds(P);
  }

  /** The "Add" row of each tab: the parts that can be in the picture and are not. */
  private renderAdds(P: Params): void {
    for (const [tab, add] of this.adds) {
      const off = this.cards.filter(
        (k) =>
          k.comp.tab === tab &&
          k.comp.on &&
          !k.comp.gate &&
          (k.comp.show?.(P) ?? true) &&
          !isOn(k.comp, P),
      );
      const key = off.map((k) => k.comp.id).join();
      if (add.dataset.key === key) continue;
      add.dataset.key = key;
      add.replaceChildren();
      if (!off.length) continue;
      add.append(el('span', 'radd-lab', 'Add'));
      for (const k of off) {
        const on = k.comp.on;
        if (!on) continue;
        const b = el('button', 'btn radd-b', `+ ${k.comp.name.replace(/^An? /, '')}`);
        b.type = 'button';
        b.dataset.add = k.comp.id;
        b.setAttribute('aria-label', `Add the ${k.comp.name.toLowerCase()}`);
        b.addEventListener('click', () => {
          this.host.set(on.key, this.stash.get(on.key) ?? on.onVal);
          this.open(k.comp.id);
          k.header.focus();
        });
        add.append(b);
      }
    }
  }

  /** The parameters the panel last showed (for tests). */
  get shown(): Params | null {
    return this.last;
  }
}
