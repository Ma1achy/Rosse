/**
 * The control panel, built from the schema and the layout (src/ui/layout.ts): a slider with a
 * typeable value for a number, a group of radio buttons for a choice of up to three options and a
 * menu for more, and off/on buttons for the switches v21 shows as such. The panel keeps no state of
 * its own: it reads parameters with `get`, reports a change with `set`, and `sync` brings every
 * control to the parameters (after a preset, the orbit or the URL changes them).
 *
 * Accessibility: every control has a visible label tied to it (`label for`, or a `fieldset` with a
 * `legend` for a group of radios); sliders are native `input[type=range]` (arrow keys, Home, End,
 * Page keys), with the value also in a text box that takes a typed number; the tabs follow the
 * WAI-ARIA tabs pattern (arrow keys, Home, End; the panel is a tab stop of its own); a group whose
 * switch is off is a disabled `fieldset`, so its controls are skipped and announced as unavailable.
 */
import type { ParamKey, Params } from '../core/params';
import { SCHEMA, type ChoiceSpec, type NumberSpec } from '../core/schema';
import {
  decimalsOf,
  endLabel,
  groupOn,
  groupsOf,
  optionLabel,
  TABS,
  TOGGLES,
  visibleTabs,
  type FeatureName,
  type Group,
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
    const f = spec.max === spec.min ? 0 : ((v - spec.min) / (spec.max - spec.min)) * 100;
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
  return {
    root,
    sync(P) {
      const v = Number(P[key]);
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

interface Section {
  group: Group;
  root: HTMLElement;
  inner: HTMLFieldSetElement | null;
  hint: HTMLElement | null;
  controls: Control[];
}

function sectionFor(group: Group, host: PanelHost): Section {
  const root = el('section', 'group');
  root.setAttribute('aria-labelledby', `g-${group.id}`);
  root.append(Object.assign(el('h3', undefined, group.title), { id: `g-${group.id}` }));
  const controls: Control[] = [];
  let inner: HTMLFieldSetElement | null = null;
  let hint: HTMLElement | null = null;
  let into: HTMLElement = root;
  for (const key of group.items) {
    const c = controlFor(key, host);
    controls.push(c);
    if (key === group.switch) {
      root.append(c.root);
      hint = el(
        'p',
        'hint',
        `Switch this on to use the controls under ${group.title.toLowerCase()}.`,
      );
      inner = el('fieldset', 'inner');
      root.append(hint, inner);
      into = inner;
    } else into.append(c.root);
  }
  return { group, root, inner, hint, controls };
}

export class ControlPanel {
  readonly tabs: TabId[];
  private readonly sections: Section[] = [];
  private readonly buttons = new Map<TabId, HTMLButtonElement>();
  private readonly panes = new Map<TabId, HTMLElement>();
  private current: TabId;

  /**
   * `choose` is the Choose tab's own content (the preset cards); the others are built from the
   * layout for the features that are drawn.
   */
  constructor(
    root: HTMLElement,
    host: PanelHost,
    choose: HTMLElement,
    features: Record<FeatureName, boolean>,
    initial: TabId = 'choose',
  ) {
    this.tabs = visibleTabs(features);
    this.current = this.tabs.includes(initial) ? initial : 'choose';
    const bar = el('div', 'tabs');
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Parts of the panel');
    root.append(bar);
    for (const t of TABS.filter((x) => this.tabs.includes(x.id))) {
      const b = el('button', 'tab', t.label);
      b.type = 'button';
      b.id = `tab-${t.id}`;
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
      pane.append(Object.assign(el('p', 'pane-hint'), { textContent: `${t.label}: ${t.hint}` }));
      if (t.id === 'choose') pane.append(choose);
      else
        for (const g of groupsOf(t.id, features)) {
          const s = sectionFor(g, host);
          this.sections.push(s);
          pane.append(s.root);
        }
      root.append(pane);
      this.panes.set(t.id, pane);
    }
    this.select(this.current, false);
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
    for (const s of this.sections) {
      for (const c of s.controls) c.sync(P);
      const on = groupOn(s.group, P);
      if (s.inner) s.inner.disabled = !on;
      if (s.hint) s.hint.hidden = on;
    }
  }
}
