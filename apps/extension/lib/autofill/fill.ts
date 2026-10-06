import { bestDegreeOption, bestOption, bestRememberedOption, isPlaceholderOption, normalize } from './match';
import { deepAll, OWN_ATTR, promptContainer, type ScannedField } from './scan';

const SELECTED_CLASS = /(^|[\s_-])(active|selected|checked|pressed)([\s_-]|$)/i;

export type FillOutcome = 'filled' | 'already' | 'nomatch' | 'failed';

export function dispatchSelectionChange(el: HTMLElement) {
  withGuard(el, () => { fire(el, 'input'); fire(el, 'change'); });
}

export function openSelectionMenu(el: HTMLElement) {
  withGuard(el, () => { el.focus({ preventScroll: true }); mouse(el, 'mousedown'); key(el, 'ArrowDown'); });
}

/** Waits used while dropdowns load; tests shorten these. */
export const timing = {
  menuOpen: 700,
  search: 3000,
  typeahead: 2500,
  afterUpload: 2000,
  settle: 350,
  /** How long to wait for a follow-up question (race) after answering one known to reveal it (Hispanic/Latino). */
  reveal: 1500,
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => T | null | undefined | false, timeout: number, interval = 80): Promise<T | null> {
  const end = Date.now() + timeout;
  // Short waits (tests, quick retries) poll proportionally so they do not overshoot their budget.
  const step = Math.min(interval, Math.max(5, timeout / 3));
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

// ---------------------------------------------------------------------------
// Submit safety. The engine never clicks submit buttons, and any form submission
// that fires while the engine is dispatching an event is cancelled.
// ---------------------------------------------------------------------------

let engineDispatching = 0;
let guardInstalled = false;

function installSubmitGuard(win: Window) {
  if (guardInstalled) return;
  guardInstalled = true;
  win.addEventListener(
    'submit',
    (e) => {
      if (engineDispatching > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
}

const SUBMIT_TEXT = /submit|apply|send application|finish|complete application/i;

export function isSubmitControl(el: Element): boolean {
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  const text = (el.textContent ?? '') + ' ' + (el.getAttribute('value') ?? '') + ' ' + (el.getAttribute('aria-label') ?? '');
  if (type === 'submit' && el.tagName === 'INPUT') return true;
  return (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && SUBMIT_TEXT.test(text);
}

function withGuard<T>(el: Element, fn: () => T): T {
  if (isSubmitControl(el)) throw new Error('Refusing to interact with a submit control');
  installSubmitGuard(el.ownerDocument.defaultView ?? window);
  engineDispatching++;
  try {
    return fn();
  } finally {
    engineDispatching--;
  }
}

function fire(el: Element, type: string, init: EventInit = {}) {
  // composed: an input inside a web component's shadow root must still be heard by the component and page.
  el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, composed: true, ...init }));
}

/**
 * Mouse and pointer events the way a real click sends them. `detail: 1` (the click count) matters: some
 * dropdowns (BambooHR) ignore clicks without it, which is what `element.click()` sends.
 */
function mouse(el: Element, type: string) {
  const view = el.ownerDocument.defaultView ?? window;
  const init = { bubbles: true, cancelable: true, composed: true, view, button: 0, buttons: type.endsWith('down') ? 1 : 0, detail: 1 };
  const Pointer = (view as Window & { PointerEvent?: typeof PointerEvent }).PointerEvent;
  if (type.startsWith('pointer') && Pointer) el.dispatchEvent(new Pointer(type, { ...init, pointerType: 'mouse', isPrimary: true }));
  else el.dispatchEvent(new view.MouseEvent(type, init));
}

function key(el: Element, k: string) {
  const view = el.ownerDocument.defaultView ?? window;
  el.dispatchEvent(new view.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, composed: true }));
}

export function clickSafely(el: HTMLElement) {
  withGuard(el, () => {
    mouse(el, 'pointerdown');
    mouse(el, 'mousedown');
    mouse(el, 'pointerup');
    mouse(el, 'mouseup');
    // Radios, checkboxes, and labels need click() to change state; everything else gets a full mouse click.
    const toggles = el.tagName === 'LABEL' || (el.tagName === 'INPUT' && /^(radio|checkbox)$/i.test(el.getAttribute('type') ?? ''));
    if (toggles) el.click();
    else mouse(el, 'click');
  });
}

// ---------------------------------------------------------------------------
// Fillers
// ---------------------------------------------------------------------------

/** Sets a value the way React and Vue expect: native setter, then input and change events. */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  withGuard(el, () => {
    el.focus();
    if (setter) setter.call(el, value);
    else el.value = value;
    fire(el, 'input');
    fire(el, 'change');
    el.blur();
    fire(el, 'focusout');
  });
}

export function fillText(field: ScannedField, value: string): FillOutcome {
  const el = field.el as HTMLInputElement | HTMLTextAreaElement;
  if (el.value.trim()) return 'already';
  let v = value;
  if (field.maxLength && v.length > field.maxLength) v = v.slice(0, field.maxLength);
  if (el.getAttribute('type') === 'month' && !/^\d{4}-\d{2}$/.test(v)) return 'nomatch';
  // Workday's MM / YYYY boxes keep their own state and only update from keystrokes.
  if (/^dateSection/.test(el.getAttribute('data-automation-id') ?? '')) {
    withGuard(el, () => {
      mouse(el, 'mousedown');
      mouse(el, 'click');
    });
    setNativeValueKeepFocus(el as HTMLInputElement, v);
    withGuard(el, () => {
      fire(el, 'change');
      el.blur();
      fire(el, 'focusout');
    });
    return sameValue(el.value, v) ? 'filled' : 'failed';
  }
  setNativeValue(el, v);
  // Segmented date boxes (Workday's month/year) and some masked inputs only take typed keys.
  if (!sameValue(el.value, v) && el.tagName === 'INPUT') {
    setNativeValueKeepFocus(el as HTMLInputElement, v);
    withGuard(el, () => {
      fire(el, 'change');
      el.blur();
      fire(el, 'focusout');
    });
  }
  return sameValue(el.value, v) ? 'filled' : 'failed';
}

/** "06" and "6" are the same month once a date box reformats it. */
function sameValue(shown: string, wanted: string): boolean {
  if (shown === wanted) return true;
  return /^\d+$/.test(wanted) && /^\d+$/.test(shown.trim()) && Number(shown) === Number(wanted);
}

/** How a list answer is chosen. */
export interface ChoiceOpts {
  /** Nothing matches: take the first real option. */
  topOption?: boolean;
  /** Match degree levels and abbreviations. */
  degree?: boolean;
  /** Every distinctive word must appear in the option (schools, majors). */
  strict?: boolean;
  /** Chooses from the option texts directly instead of matching candidates (location preferences). */
  pick?: (options: string[]) => number;
  /** Search lists: the first result is acceptable when it starts like the answer. */
  acceptFirstResult?: boolean;
  /** Multi-select lists: add another item even if one is already chosen. */
  allowMore?: boolean;
  /** Authored literal answers must match exactly (or an unambiguous Yes/No variant). */
  remembered?: boolean;
}

function chooser(opts: ChoiceOpts): (candidates: string[], options: string[]) => number {
  if (opts.pick) return (_c, options) => opts.pick!(options);
  if (opts.remembered) return bestRememberedOption;
  if (opts.degree) return bestDegreeOption;
  return (c, o) => bestOption(c, o, { strict: opts.strict });
}

export function fillSelect(field: ScannedField, candidates: string[], opts: ChoiceOpts = {}): FillOutcome {
  const select = field.el as HTMLSelectElement;
  const current = select.options[select.selectedIndex];
  if (current && current.value && !isPlaceholderOption(current.text)) return 'already';
  const options = Array.from(select.options);
  let idx = chooser(opts)(candidates, options.map((o) => o.text));
  // Nothing fits exactly: take the first real option.
  if (idx < 0 && opts.topOption) idx = options.findIndex((o) => o.value && !isPlaceholderOption(o.text));
  const option = options[idx];
  if (!option) return 'nomatch';
  withGuard(select, () => {
    select.focus();
    select.value = option.value;
    option.selected = true;
    fire(select, 'input');
    fire(select, 'change');
    select.blur();
  });
  return select.selectedIndex === idx ? 'filled' : 'failed';
}

export function fillRadio(field: ScannedField, candidates: string[], opts: ChoiceOpts = {}): FillOutcome {
  const radios = field.members as HTMLInputElement[];
  if (radios.some((r) => r.checked)) return 'already';
  const radio = radios[chooser(opts)(candidates, field.options)];
  if (!radio) return 'nomatch';
  clickSafely(radio);
  if (!radio.checked) {
    radio.checked = true;
    withGuard(radio, () => fire(radio, 'change'));
  }
  return radio.checked ? 'filled' : 'failed';
}

/** A lone "I consent to text messages" box: ticked only when the answer is Yes, otherwise left unticked. */
export function fillCheckbox(field: ScannedField, candidates: string[]): FillOutcome {
  const box = field.members[0] as HTMLInputElement | undefined;
  if (!box) return 'nomatch';
  if (box.checked) return 'already';
  if (candidates[0] !== 'Yes') return 'nomatch';
  clickSafely(box);
  return box.checked ? 'filled' : 'failed';
}

export function fillCheckboxGroup(field: ScannedField, candidates: string[], opts: ChoiceOpts = {}): FillOutcome {
  const boxes = field.members as HTMLInputElement[];
  if (boxes.some((b) => b.checked)) return 'already';
  const box = boxes[chooser(opts)(candidates, field.options)];
  if (!box) return 'nomatch';
  clickSafely(box);
  return box.checked ? 'filled' : 'failed';
}

/** "Select all that apply": ticks the best box for each answer (each race, for example). */
export function fillCheckboxes(field: ScannedField, answers: string[][]): FillOutcome {
  const boxes = field.members as HTMLInputElement[];
  if (boxes.some((b) => b.checked)) return 'already';
  const picks = new Set(answers.map((a) => bestOption(a, field.options)).filter((i) => i >= 0));
  if (!picks.size) return 'nomatch';
  for (const i of picks) clickSafely(boxes[i]!);
  return [...picks].every((i) => boxes[i]!.checked) ? 'filled' : 'failed';
}

export function fillYesNo(field: ScannedField, candidates: string[], opts: { strict?: boolean; pick?: (options: string[]) => number } = {}): FillOutcome {
  const buttons = field.members;
  if (buttons.some((b) => b.getAttribute('aria-pressed') === 'true' || SELECTED_CLASS.test(b.className))) {
    return 'already';
  }
  const button = buttons[opts.pick ? opts.pick(field.options) : (opts.strict ? bestRememberedOption : bestOption)(candidates, field.options)];
  if (!button) return 'nomatch';
  clickSafely(button);
  return 'filled';
}

export function fillFile(field: ScannedField, file: File): FillOutcome {
  const input = field.el as HTMLInputElement;
  if ((input.files && input.files.length) || uploadedAlready(input)) return 'already';
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    withGuard(input, () => {
      input.files = dt.files;
      fire(input, 'input');
      fire(input, 'change');
    });
    return 'filled';
  } catch {
    return 'failed';
  }
}

/** A file the site already shows as attached next to this upload box (Workday keeps the box empty after uploading). */
function uploadedAlready(input: HTMLInputElement): boolean {
  let node = input.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    if (node.querySelectorAll('input[type="file"]').length > 1) return false;
    if (node.querySelector('[data-automation-id="file-upload-item"], [data-automation-id*="fileName" i], [data-automation-id="file-upload-successful"]')) return true;
    // A file name ("Jordan_Resume.pdf"), not a hint like "Accepted: .pdf, .docx".
    if (/[\w)\]-]\.(pdf|docx?|rtf)\b/i.test(node.textContent ?? '')) return true;
  }
  return false;
}

/** The answer a list field currently shows, read back to avoid repeating it in a later question. */
export function displayedValue(field: ScannedField): string {
  switch (field.kind) {
    case 'select': {
      const s = field.el as HTMLSelectElement;
      return s.selectedIndex >= 0 && fieldHasValue(field) ? (s.options[s.selectedIndex]?.text ?? '') : '';
    }
    case 'listbox':
      return listboxHasValue(field) ? (field.el.textContent ?? '').trim() : '';
    case 'radio':
      return field.options[(field.members as HTMLInputElement[]).findIndex((m) => m.checked)] ?? '';
    case 'yesno':
      return field.options[field.members.findIndex(b => b.getAttribute('aria-pressed') === 'true' || SELECTED_CLASS.test(b.className))] ?? '';
    case 'prompt': {
      const pills = [...new Set(pillTexts(field))];
      return pills.length === 1 ? pills[0]! : '';
    }
    case 'combobox': {
      const selected = comboboxSelectedValues(field);
      if (selected.length) return selected.length === 1 ? selected[0]! : '';
      const input = field.el as HTMLInputElement;
      const box = comboboxContainer(field);
      // React-select's text input is only a search query, not a committed selection.
      if (box.matches('[class*="select__"], [class*="react-select"]') || box.querySelector('[class*="select__"], [class*="react-select"]') || input.getAttribute('aria-expanded') === 'true') return '';
      return input.value?.trim() ?? '';
    }
    default:
      return (field.el as HTMLInputElement).value ?? '';
  }
}

// --- Custom dropdowns (react-select on Greenhouse, Ashby autocompletes) ---

function isVisible(el: Element): boolean {
  const h = el as HTMLElement;
  if (h.hidden || h.getAttribute('aria-hidden') === 'true') return false;
  const rects = h.getClientRects?.();
  // happy-dom and detached nodes report no rects; treat those as visible.
  return !rects || rects.length > 0 || !h.ownerDocument.defaultView?.getComputedStyle;
}

export function comboboxOptions(input: HTMLElement): HTMLElement[] {
  const doc = input.ownerDocument;
  const ids = [input.getAttribute('aria-controls'), input.getAttribute('aria-owns')].filter(Boolean) as string[];
  for (const id of ids) {
    const lb = doc.getElementById(id);
    if (lb) {
      const opts = Array.from(lb.querySelectorAll<HTMLElement>('[role="option"]')).filter(isVisible);
      if (opts.length) return opts;
    }
  }
  // Menus usually render next to the input; fall back to the whole document.
  let scope: HTMLElement | null = input.parentElement;
  for (let i = 0; scope && i < 5; i++, scope = scope.parentElement) {
    const opts = Array.from(scope.querySelectorAll<HTMLElement>('[role="option"]')).filter(isVisible);
    if (opts.length) return opts;
  }
  // Menus drawn inside web components (shadow roots) are found too.
  return deepAll(doc, '[role="option"]').filter((o) => isVisible(o) && !o.closest('[data-automation-id="selectedItemList"]'));
}

// --- Button dropdowns (Workday "Select One") ---

/** True when the dropdown button shows a choice rather than its "Select One" prompt. */
// --- Workday-style lists ----------------------------------------------------------------------------
// Workday options are not always role=option: rows can be promptOption / promptLeafNode / menuItem, and the
// name can live only in data-automation-label. Chosen answers ("pills") are also drawn as a list, so they
// are never mistaken for the options of another field.

const OPTION_SELECTOR = '[role="option"], [data-automation-id="promptOption"], [data-automation-id="promptLeafNode"], [data-automation-id="menuItem"], [role="menuitem"], [role="menuitemradio"]';
const POPUP_SELECTOR = '[data-automation-id="responsiveMonikerPrompt"], [data-automation-id="promptPopup"], [data-automation-id="activeListContainer"], [role="listbox"], [role="menu"]';
const PILLS = '[data-automation-id="selectedItemList"]';
/** Rows with a chevron are categories that open more rows; they are not answers. */
const FOLDER = '.wd-icon-chevron-right, .wd-icon-chevron-right-small, [data-automation-id="promptOptionMore"]';
const NOT_AN_OPTION_RE = /^(loading|searching|no (items|results|matches)|search|select one)\b/i;

export function optionLabel(el: Element): string {
  // A row can be an empty wrapper around the node that carries the name.
  const raw =
    el.getAttribute('data-automation-label') ||
    el.textContent?.trim() ||
    el.querySelector('[data-automation-label]')?.getAttribute('data-automation-label') ||
    '';
  return raw.replace(/\s+/g, ' ').trim();
}

/** Options under `root`, innermost labelled node each, without pills, folders, or "Loading…" rows. */
function optionsIn(root: ParentNode): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(OPTION_SELECTOR)).filter(
    (o) => isVisible(o) && !o.closest(PILLS) && !o.closest(`[${OWN_ATTR}]`) && optionLabel(o) && !NOT_AN_OPTION_RE.test(optionLabel(o)),
  );
  return all.filter((o) => !all.some((other) => other !== o && o.contains(other)) && !isFolder(o));
}

function isFolder(option: HTMLElement): boolean {
  const row = (option.closest('[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]') as HTMLElement | null) ?? option;
  if (row.querySelector('[data-automation-id="radioBtn"], [data-automation-id="checkbox"], input[type="radio"], input[type="checkbox"]')) return false;
  return row.matches(FOLDER) || !!row.querySelector(FOLDER);
}

/** The list this control opened: the one it names in aria-controls, else the newest open popup on the page. */
function openPopup(control: HTMLElement): ParentNode | null {
  const doc = control.ownerDocument;
  for (const id of [control.getAttribute('aria-controls'), control.getAttribute('aria-owns'), control.getAttribute('data-menu-id')]) {
    const owned = id ? doc.getElementById(id) : null;
    if (owned && optionsIn(owned).length) return owned;
  }
  const popups = Array.from(doc.querySelectorAll<HTMLElement>(POPUP_SELECTOR)).filter(
    (p) => isVisible(p) && !control.contains(p) && !p.closest(PILLS) && p.getAttribute('data-automation-id') !== 'selectedItemList' && optionsIn(p).length,
  );
  return popups[popups.length - 1] ?? null;
}

/** Options of an open list: its popup's, else ones rendered next to the control (Workday prompt results). */
function listOptions(control: HTMLElement): HTMLElement[] {
  const popup = openPopup(control);
  if (popup) return optionsIn(popup);
  const loose = Array.from(control.ownerDocument.querySelectorAll<HTMLElement>('[data-automation-id="promptOption"]'));
  return loose.length ? optionsIn(control.ownerDocument) : comboboxOptions(control).filter((o) => !o.closest(PILLS));
}

/** The element that scrolls a list: the nearest ancestor of a row (up to the popup) with more content than room. */
function scrollerOf(row: HTMLElement, popup: ParentNode): HTMLElement | null {
  for (let node: HTMLElement | null = row.parentElement; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (node.scrollHeight > node.clientHeight + 4 && /(auto|scroll)/.test(style?.overflowY ?? '')) return node;
    if (node === popup) break;
  }
  return null;
}

/**
 * Long lists (Workday's degrees and fields of study) only draw the rows in view. Scrolls the open list from the
 * top, like a person would, until a row matches; returns that row, scrolled into view.
 */
async function scrollForOption(
  control: HTMLElement,
  candidates: string[],
  match: (candidates: string[], options: string[]) => number,
  observe?: (rows: HTMLElement[]) => void,
): Promise<HTMLElement | null> {
  const popup = openPopup(control);
  const first = popup ? optionsIn(popup)[0] : undefined;
  const scroller = first && popup ? scrollerOf(first, popup) : null;
  if (!popup || !scroller) return null;
  scroller.scrollTop = 0;
  for (let step = 0; step < 60; step++) {
    await sleep(80);
    const rows = optionsIn(popup);
    observe?.(rows);
    const idx = match(candidates, rows.map(optionLabel));
    if (idx >= 0) {
      rows[idx]!.scrollIntoView?.({ block: 'nearest' });
      await sleep(60);
      return rows[idx]!;
    }
    const before = scroller.scrollTop;
    scroller.scrollTop = before + Math.max(40, scroller.clientHeight * 0.8);
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    if (scroller.scrollTop === before) break;
  }
  return null;
}

/** True when the open list scrolls, so more rows exist than are drawn. */
function listScrolls(control: HTMLElement): boolean {
  const popup = openPopup(control);
  const first = popup ? optionsIn(popup)[0] : undefined;
  return !!(first && popup && scrollerOf(first, popup));
}

/** A row whose name is exactly the answer ("Computer Science", or "Computer Science (BS)"); -1 if none. */
export function exactOption(candidates: string[], labels: string[]): number {
  const want = new Set(candidates.map(normalize).filter(Boolean));
  return labels.findIndex((l) => want.has(normalize(l)) || want.has(normalize(l.replace(/\s*\([^)]*\)\s*$/, ''))));
}

/** The same name written a little differently: "The University of California Santa Cruz" for "University of California, Santa Cruz". */
export function nearOption(candidates: string[], labels: string[]): number {
  const loose = (t: string) => normalize(t.replace(/\s*\([^)]*\)\s*$/, '')).replace(/\b(the|of|at|and|in)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const want = new Set(candidates.map(loose).filter(Boolean));
  return labels.findIndex((l) => want.has(loose(l)));
}

/** Clicks the part of a row that holds its handler (the leaf node or option, not the inner label). */
function activateOption(option: HTMLElement) {
  const target = (option.closest('[data-automation-id="promptLeafNode"]') ?? option.closest('[role="option"]') ?? option) as HTMLElement;
  clickSafely(target);
}

/** The text the dropdown button shows as its answer. */
function listboxShown(button: HTMLElement): string {
  const label = button.querySelector('[data-automation-id="promptSelectionLabel"], [data-automation-id="selectedItemLabel"]');
  return (label?.textContent ?? button.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function listboxHasValue(field: ScannedField): boolean {
  const text = listboxShown(field.el);
  // Some buttons also carry the question or "Required" as hidden text around their "Select One" prompt.
  return !!text && !isPlaceholderOption(text) && !LISTBOX_PROMPT_RE.test(text);
}

// No leading \b: hidden text often runs straight into the prompt ("RequiredSelect One").
const LISTBOX_PROMPT_RE = /select one\b|[–—-]{1,2}\s*select\s*[–—-]{1,2}|\bplease select\b|\bchoose one\b/i;

function press(el: Element, k: string) {
  const view = el.ownerDocument.defaultView ?? window;
  const code = ({ Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38 } as Record<string, number>)[k] ?? k.toUpperCase().charCodeAt(0);
  el.dispatchEvent(new view.KeyboardEvent('keydown', { key: k, keyCode: code, which: code, bubbles: true, cancelable: true, composed: true }));
  el.dispatchEvent(new view.KeyboardEvent('keyup', { key: k, keyCode: code, which: code, bubbles: true, cancelable: true, composed: true }));
}

/**
 * Some dropdowns (Workday's degree list) ignore clicks on a row and only commit from the keyboard: move
 * down to the row and press Enter, or, with the list closed, type the answer's name and press Enter.
 */
async function commitByKeyboard(field: ScannedField, label: string): Promise<boolean> {
  const button = field.el;
  const doc = button.ownerDocument;
  const want = normalize(label);
  withGuard(button, () => button.focus());
  let moved = false;
  for (let step = 0; step < 80 && !listboxHasValue(field); step++) {
    const popup = openPopup(button);
    // A list that shows no highlight after a few presses does not take arrow keys.
    if (step >= 3 && !moved) break;
    const activeId = (popup instanceof Element ? popup.getAttribute('aria-activedescendant') : null) ?? button.getAttribute('aria-activedescendant');
    const active = activeId ? doc.getElementById(activeId) : (doc.activeElement as HTMLElement | null);
    if (activeId || (active && active !== button && active !== doc.body)) moved = true;
    if (active && normalize(optionLabel(active)) === want) {
      // Enter goes where the keys go: the focused control, which owns the list.
      withGuard(button, () => press(doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : button, 'Enter'));
      await sleep(40);
      break;
    }
    if (!popup) break;
    withGuard(button, () => press(doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : button, 'ArrowDown'));
    await sleep(25);
  }
  if (listboxHasValue(field)) return true;
  return typeOnClosed(field, label);
}

/**
 * Closed list: typing selects the option whose name starts with what was typed (Workday's degree and yes/no
 * dropdowns commit this way). The list must really be closed first, or the keys only move a highlight.
 */
async function typeOnClosed(field: ScannedField, label: string): Promise<boolean> {
  const button = field.el;
  const doc = button.ownerDocument;
  const want = normalize(label);
  await closeListbox(button);
  const shows = () => {
    const face = normalize(listboxShown(button));
    return face === want || face.endsWith(` ${want}`) || face.startsWith(`${want} `);
  };
  withGuard(button, () => {
    button.focus();
    for (const ch of label) {
      press(button, ch);
      if (shows()) break;
    }
  });
  await sleep(timing.settle);
  if (!shows() && listIsOpen(button)) {
    // The keys opened the list and moved its highlight. Enter only when the highlighted row is the answer;
    // a blind Enter would pick whatever row is first ("Yes").
    const popup = openPopup(button);
    const activeId = (popup instanceof Element ? popup.getAttribute('aria-activedescendant') : null) ?? button.getAttribute('aria-activedescendant');
    const active = activeId ? doc.getElementById(activeId) : null;
    if (active && normalize(optionLabel(active)) === want) {
      withGuard(button, () => press(doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : button, 'Enter'));
      await sleep(timing.settle);
    }
    if (!shows()) await closeListbox(button);
  }
  return listboxHasValue(field) && shows();
}

/** Lists already on the page before a dropdown was clicked, so a new one (even an empty one) counts as its list. */
const popupsBefore = new WeakMap<HTMLElement, Set<Element>>();

function visiblePopups(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll(POPUP_SELECTOR)).filter(
    (p) => isVisible(p) && !p.closest(PILLS) && p.getAttribute('data-automation-id') !== 'selectedItemList',
  );
}

/** The lists showing on the page right now, to tell later which ones a field opened. */
export function openLists(doc: Document): Set<Element> {
  return new Set(visiblePopups(doc));
}

/**
 * Leaves the page as a person would after answering: every list the field opened is closed and the field is
 * no longer focused. Lists that ignore Escape (Workday's search lists) close on a click outside them, or on
 * their own toggle.
 */
export async function closeListsOpenedBy(field: ScannedField, before: Set<Element>) {
  const doc = field.el.ownerDocument;
  const stillOpen = () => visiblePopups(doc).filter((p) => !before.has(p) && !p.contains(field.el));
  const attempts: (() => void)[] = [
    () => {
      const focused = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : field.el;
      withGuard(field.el, () => {
        press(focused, 'Escape');
        if (focused !== field.el) press(field.el, 'Escape');
      });
    },
    () => {
      // A click on the page outside the list, the way a person dismisses it.
      (doc.activeElement as HTMLElement | null)?.blur?.();
      withGuard(doc.body, () => {
        mouse(doc.body, 'pointerdown');
        mouse(doc.body, 'mousedown');
        mouse(doc.body, 'pointerup');
        mouse(doc.body, 'mouseup');
        mouse(doc.body, 'click');
      });
    },
    () => {
      const toggle = composedClosestField(field.el)?.querySelector<HTMLElement>(
        '[data-automation-id="promptIcon"], [data-automation-id="promptSearchButton"], [class*="indicator" i] button, button[aria-haspopup]',
      );
      if (toggle && toggle !== field.el) clickSafely(toggle);
    },
  ];
  for (const attempt of attempts) {
    if (!stillOpen().length) break;
    attempt();
    await sleep(timing.settle + 50);
  }
  const focused = doc.activeElement as HTMLElement | null;
  if (focused && focused !== doc.body && (field.el === focused || field.el.contains(focused) || promptScope(field.el).contains(focused))) {
    focused.blur();
    fire(focused, 'focusout');
  }
}

/** The question's own wrapper, where its list toggle lives. */
function composedClosestField(el: HTMLElement): HTMLElement | null {
  return (el.closest('[data-automation-id^="formField-"], [data-automation-id="multiSelectContainer"], [class*="select__control"], [class*="field" i]') as HTMLElement | null) ?? el.parentElement;
}

function listIsOpen(button: HTMLElement): boolean {
  if (openPopup(button) || button.getAttribute('aria-expanded') === 'true') return true;
  const before = popupsBefore.get(button);
  return !!before && visiblePopups(button.ownerDocument).some((p) => !before.has(p) && !button.contains(p));
}

/** Closes a button dropdown's list, whether or not the button reports aria-expanded. */
async function closeListbox(button: HTMLElement) {
  const doc = button.ownerDocument;
  for (let attempt = 0; attempt < 3 && listIsOpen(button); attempt++) {
    withGuard(button, () => {
      const focused = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : button;
      press(focused, 'Escape');
      if (focused !== button) press(button, 'Escape');
    });
    await sleep(timing.settle + 50);
    // Some lists only close when their button is clicked again.
    if (attempt === 1 && listIsOpen(button)) clickSafely(button);
  }
}

export async function fillListbox(
  field: ScannedField,
  candidates: string[],
  opts: ChoiceOpts = {},
): Promise<FillOutcome> {
  const button = field.el;
  if (listboxHasValue(field)) return 'already';
  popupsBefore.set(button, new Set(visiblePopups(button.ownerDocument)));
  clickSafely(button);
  const waitOptions = async (ms: number) =>
    (await waitFor(() => {
      const o = listOptions(button);
      return o.length ? o : null;
    }, ms)) ?? [];
  let options = await waitOptions(timing.menuOpen);
  const matchOption = chooser(opts);
  let idx = matchOption(candidates, options.map(optionLabel));
  // Long lists render only the options in view; typing the start of the answer scrolls to it.
  const query = opts.pick ? '' : (candidates[0] ?? '');
  if (idx < 0 && query && options.length) {
    const target = (button.ownerDocument.activeElement as HTMLElement | null) ?? button;
    withGuard(target, () => {
      for (const ch of query.slice(0, 8)) key(target, ch);
    });
    options = await waitOptions(timing.settle + 100);
    idx = matchOption(candidates, options.map(optionLabel));
  }
  if (idx < 0 && opts.topOption) idx = options.findIndex((o) => !isPlaceholderOption(optionLabel(o)));
  let choice = options[idx];
  // The answer may be further down a list that only draws the rows in view.
  if (!choice && !opts.pick) choice = (await scrollForOption(button, candidates, matchOption)) ?? undefined;
  // Labels and the page's own option texts only; the person's answer is never logged.
  const seen = options.slice(0, 30).map((o) => `"${optionLabel(o).slice(0, 40)}"`).join(', ');
  if (!choice) {
    // Some Workday questions show no readable rows when opened; their closed button still takes the answer typed.
    // Only answers that could be an option are typed: never a company name into a yes/no question.
    const yesNoQuestion = /^(are|is|do|does|did|will|would|have|has|can|could)\b/i.test(field.label.trim()) || /\?\s*$/.test(field.label.trim());
    const typeable = candidates.filter((c) => c.length <= 60 && (!yesNoQuestion || /^(yes|no)\b/i.test(c)));
    if (!options.length && !opts.pick) {
      for (const answer of typeable.slice(0, 3)) {
        if (await typeOnClosed(field, answer)) {
          console.info(`[Job Autofill] dropdown "${field.label.slice(0, 60)}": no readable options -> filled by typing`);
          return 'filled';
        }
      }
    }
    console.info(`[Job Autofill] dropdown "${field.label.slice(0, 60)}": ${options.length} options (${seen}) -> no match`);
    await closeListbox(button);
    return 'nomatch';
  }
  const label = optionLabel(choice);
  activateOption(choice);
  await sleep(timing.settle);
  if (!listboxHasValue(field) && button.isConnected) await commitByKeyboard(field, label);
  if (listIsOpen(button)) await closeListbox(button);
  const outcome = listboxHasValue(field) || !button.isConnected ? 'filled' : 'failed';
  console.info(`[Job Autofill] dropdown "${field.label.slice(0, 60)}": ${options.length} options (${seen}) -> ${outcome}`);
  return outcome;
}

// --- Search prompts (Workday: open from the icon, type in the search box, pick a result into a pill) ---

/** The question's own area, where its pills and search box live. */
function promptScope(el: HTMLElement): HTMLElement {
  return (el.closest('[data-automation-id^="formField-"], [data-fkit-id]') as HTMLElement | null) ?? promptContainer(el);
}

function pillTexts(field: ScannedField): string[] {
  const scope = promptScope(field.el);
  const pills = Array.from(
    scope.querySelectorAll('[data-automation-id="selectedItem"], [data-automation-id="selectedItemLabel"], [data-automation-id="selectedItemList"] [role="option"], [data-automation-id="selectedItemList"] li'),
  );
  return pills
    .map((p) => optionLabel(p.querySelector('[data-automation-id="promptOption"]') ?? p))
    .filter((t) => t && !/^(delete|remove|search)$/i.test(t));
}

export function promptHasValue(field: ScannedField): boolean {
  return pillTexts(field).length > 0;
}

/** The search box the prompt shows once opened (it may differ from the closed field's input). */
function promptSearchBox(field: ScannedField): HTMLInputElement {
  const selector = 'input[data-automation-id="searchBox"], input[data-automation-id="promptSearchInput"], input[data-automation-id="monikerSearchBox"], [data-automation-id="monikerSearchBox"] input';
  const inField = promptScope(field.el).querySelector<HTMLInputElement>(selector);
  if (inField && isVisible(inField) && inField !== field.el) return inField;
  // The opened prompt paints its own search box, often before it has any rows.
  const popups = Array.from(field.el.ownerDocument.querySelectorAll<HTMLElement>(POPUP_SELECTOR)).filter(
    (p) => isVisible(p) && !p.closest(PILLS) && p.getAttribute('data-automation-id') !== 'selectedItemList' && !field.el.contains(p),
  );
  for (let i = popups.length - 1; i >= 0; i--) {
    const box = popups[i]!.querySelector<HTMLInputElement>(selector);
    if (box) return box;
  }
  return inField ?? (field.el as HTMLInputElement);
}

/** Leaves the prompt closed and empty: no half-typed query, no list left open over the page. */
function closePrompt(field: ScannedField, search: HTMLInputElement) {
  for (const box of new Set([search, field.el as HTMLInputElement])) {
    if (box.isConnected && box.value) setNativeValueKeepFocus(box, '');
    withGuard(box, () => press(box, 'Escape'));
  }
  const doc = field.el.ownerDocument;
  if (openPopup(field.el)) withGuard(doc.body, () => press(doc.body, 'Escape'));
  (doc.activeElement as HTMLElement | null)?.blur?.();
}

export async function fillPrompt(
  field: ScannedField,
  candidates: string[],
  opts: ChoiceOpts = {},
): Promise<FillOutcome> {
  const input = field.el as HTMLInputElement;
  const before = pillTexts(field).length;
  if (before && !opts.allowMore) return 'already';
  const matchOption = chooser(opts);
  const committed = () => pillTexts(field).length > before;
  // Text left in the closed box makes the icon search instead of opening the list; clear it first.
  if (input.value.trim()) setNativeValueKeepFocus(input, '');
  // Open from the list icon when there is one; a bare click on the text box does not open it.
  const icon = promptScope(input).querySelector<HTMLElement>('[data-automation-id="promptIcon"], [data-automation-id="promptSearchButton"]');
  clickSafely(icon ?? input);
  if (!icon) withGuard(input, () => key(input, 'ArrowDown'));
  const search = (await waitFor(() => {
    const box = promptSearchBox(field);
    return box !== input || listOptions(input).length ? box : null;
  }, timing.menuOpen)) ?? input;

  // An exact name beats a close one: a long catalog can list "Computer and Information Science" before
  // "Computer Science". A close match is taken at once only from a short list that shows every choice;
  // otherwise it is remembered and used if no exact one turns up.
  let closeLabel: string | null = null;
  let nearLabel: string | null = null;
  const noteClose = (rows: HTMLElement[]) => {
    const labels = rows.map(optionLabel);
    const near = nearOption(candidates, labels);
    if (near >= 0 && !nearLabel) nearLabel = labels[near]!;
    const i = matchOption(candidates, labels);
    if (i >= 0 && !closeLabel) closeLabel = labels[i]!;
  };
  const exactFirst = !opts.pick;
  // Only a short list with no search box shows every choice, so only there can a close match be taken at once.
  const complete = () => search === input && !listScrolls(input);
  const pickIndex = (rows: HTMLElement[]) => {
    const labels = rows.map(optionLabel);
    if (!exactFirst) return matchOption(candidates, labels);
    const exact = exactOption(candidates, labels);
    if (exact >= 0) return exact;
    noteClose(rows);
    if (!complete()) return -1;
    const near = nearOption(candidates, labels);
    return near >= 0 ? near : matchOption(candidates, labels);
  };
  const tryPick = async (options: HTMLElement[]): Promise<FillOutcome | null> => {
    const idx = pickIndex(options);
    if (idx < 0) return null;
    activateOption(options[idx]!);
    await sleep(timing.settle);
    if (committed() || !input.isConnected) return 'filled';
    // A row that did not commit on click often commits on Enter while highlighted.
    withGuard(search, () => press(search, 'Enter'));
    await sleep(timing.settle);
    return committed() ? 'filled' : null;
  };

  // Short lists (race, phone code) show every choice when opened; pick from them before searching, since a
  // search for the saved wording ("Decline to answer") can miss the site's ("I do not wish to answer").
  let options = listOptions(input);
  let outcome = await tryPick(options);
  if (!outcome && !opts.pick && options.length) {
    // A long catalog (fields of study) opens at "Accounting"; scroll it for an exact name before searching.
    const row = await scrollForOption(input, candidates, exactFirst ? exactOption : matchOption, noteClose);
    if (row) outcome = await tryPick([row]);
  }
  // Then search: the saved wording, its other spellings, and shorter forms of it. Each search waits for its own
  // results; Enter asks lists that do not search as you type.
  const queries = opts.pick ? [] : Array.from(new Set([...candidates.slice(0, 3), ...searchQueries(candidates)])).slice(0, 5);
  let firstResults: HTMLElement[] = [];
  const readOptions = () => {
    const found = listOptions(search);
    return found.length || search === input ? found : listOptions(input);
  };
  const signature = (rows: HTMLElement[]) => rows.map(optionLabel).join('|');
  for (const [i, q] of (outcome ? [] : queries).entries()) {
    // Results count only once they differ from the list shown before this search (the whole catalog, or the
    // previous search's results).
    const before = signature(readOptions());
    setNativeValueKeepFocus(search, q);
    const limit = i === 0 ? timing.search : Math.min(timing.search, 1500);
    const started = Date.now();
    let entered = false;
    for (;;) {
      options = readOptions();
      if (options.length && signature(options) !== before) break;
      // Workday searches on Enter, not as you type.
      if (!entered && Date.now() - started > Math.min(250, limit / 4)) {
        withGuard(search, () => press(search, 'Enter'));
        entered = true;
      }
      if (Date.now() - started > limit) break;
      await sleep(Math.min(80, Math.max(5, limit / 10)));
    }
    if (options.length && !firstResults.length) firstResults = options;
    outcome = await tryPick(options);
    if (!outcome && options.length) {
      const row = await scrollForOption(search, candidates, exactFirst ? exactOption : matchOption, noteClose);
      if (row) outcome = await tryPick([row]);
    }
    if (outcome) break;
  }
  // No exact name anywhere: search for the same name written differently, else the closest one seen, and pick it.
  const close = (nearLabel ?? closeLabel) as string | null;
  if (!outcome && close) {
    setNativeValueKeepFocus(search, close);
    withGuard(search, () => press(search, 'Enter'));
    const rows = (await waitFor(() => {
      const r = listOptions(search).filter((o) => normalize(optionLabel(o)) === normalize(close));
      return r.length ? r : null;
    }, timing.search)) ?? [];
    const row = rows[0] ?? (await scrollForOption(search, [close], exactOption));
    if (row) {
      activateOption(row);
      await sleep(timing.settle);
      if (committed()) outcome = 'filled';
    }
  }
  const firstWord = normalize(candidates[0] ?? '').split(' ')[0] ?? '';
  if (!outcome && firstResults.length && opts.acceptFirstResult && firstWord && normalize(optionLabel(firstResults[0]!)).includes(firstWord)) {
    activateOption(firstResults[0]!);
    await sleep(timing.settle);
    if (committed()) outcome = 'filled';
  }
  if (!outcome) {
    console.info(
      `[Job Autofill] search list "${field.label.slice(0, 60)}": ${firstResults.length} results (${firstResults.slice(0, 30).map((o) => `"${optionLabel(o).slice(0, 40)}"`).join(', ')}) -> no match`,
    );
    closePrompt(field, search);
    return 'nomatch';
  }
  if (search !== input && search.value) setNativeValueKeepFocus(search, '');
  if (openPopup(input)) closePrompt(field, search);
  console.info(`[Job Autofill] search list "${field.label.slice(0, 60)}" -> ${outcome}`);
  return outcome;
}

export function comboboxContainer(field: ScannedField): Element {
  return field.outlineTarget.closest('[class*="container"], [class*="select"]') ?? field.outlineTarget;
}

/** Committed React-select labels, without nested labels or remove-button text counted twice. */
export function comboboxSelectedValues(field: ScannedField): string[] {
  const box = comboboxContainer(field);
  const selector = '[class*="single-value" i], [class*="singleValue" i], [class*="multi-value" i], [class*="multiValue" i]';
  const matches = Array.from(box.querySelectorAll(selector)).filter(node => !node.matches('[class*="remove" i]'));
  // Read each committed label separately, even when an outer value container matches
  // the same CSS fragment. A parent containing several chips is not itself an answer.
  const roots = matches.filter(node => !matches.some(other => other !== node && node.contains(other)));
  return roots.map(node => {
    const label = node.cloneNode(true) as Element;
    label.querySelectorAll('button, [role="button"], svg, [class*="remove" i], [aria-hidden="true"]').forEach(control => control.remove());
    return (label.textContent ?? '').trim();
  }).filter(Boolean);
}

export function comboboxHasValue(field: ScannedField): boolean {
  return comboboxSelectedValues(field).length > 0 || !!(field.el as HTMLInputElement).value.trim();
}

export function closeMenu(input: HTMLElement) {
  withGuard(input, () => {
    // Escape on an already-closed react-select can clear the chosen value, so only send it to an open menu.
    if (input.getAttribute('aria-expanded') !== 'false') key(input, 'Escape');
    input.blur();
  });
}

/** Closes a dropdown that is still showing its list. Safe on closed ones: it only acts when the page says the list is open. */
export function closeIfOpen(input: HTMLElement) {
  if (input.getAttribute('aria-expanded') !== 'true') return;
  withGuard(input, () => {
    input.focus();
    key(input, 'Escape');
    input.blur();
    fire(input, 'focusout');
  });
}

export async function fillCombobox(
  field: ScannedField,
  candidates: string[],
  opts: ChoiceOpts = {},
): Promise<FillOutcome> {
  const input = field.el as HTMLInputElement;
  if (comboboxHasValue(field)) return 'already';

  withGuard(input, () => {
    input.focus();
    mouse(input, 'mousedown');
    key(input, 'ArrowDown');
  });

  // Static lists open immediately; pick from them without typing so option wording can differ.
  const waitOptions = async (ms: number) =>
    (await waitFor(() => {
      const o = comboboxOptions(input);
      return o.length ? o : null;
    }, ms)) ?? [];
  let options = await waitOptions(timing.menuOpen);
  const trace: string[] = [`focus+arrow=${options.length}`];
  // Some forms ignore clicks on the text box and only open from the arrow button, like a person would use.
  if (!options.length) {
    const arrow = indicatorFor(field);
    if (arrow) {
      withGuard(arrow, () => {
        mouse(arrow, 'pointerdown');
        mouse(arrow, 'mousedown');
        mouse(arrow, 'pointerup');
        mouse(arrow, 'mouseup');
        arrow.click();
      });
      options = await waitOptions(timing.menuOpen);
    }
    trace.push(`arrow${arrow ? '' : '(none)'}=${options.length}`);
  }
  const matchOption = chooser(opts);
  let idx = matchOption(candidates, options.map((o) => o.textContent ?? ''));
  // A static list with no close match: take its first real option.
  const firstReal = (list: HTMLElement[]) => list.findIndex((o) => !isPlaceholderOption(o.textContent ?? ''));
  const staticOptions = options;

  // Async search lists (locations, schools) need a query first. A picker chooses from the list as shown.
  const query = opts.pick ? '' : (candidates[0] ?? '');
  if (idx < 0 && query) {
    let firstResults: HTMLElement[] = [];
    // The list may spell things differently ("University of California - Santa Cruz"), so try the
    // wording as given, then cleaner and shorter searches, until a result matches.
    const queries = opts.strict ? candidates : searchQueries(candidates);
    for (const [i, q] of queries.entries()) {
      setNativeValueKeepFocus(input, q);
      options =
        (await waitFor(() => {
          const o = comboboxOptions(input).filter((o) => !/^(loading|searching|no (results|options))/i.test(o.textContent?.trim() ?? ''));
          return o.length ? o : null;
        }, i === 0 ? timing.search : Math.min(timing.search, 1500))) ?? [];
      trace.push(`typed${i + 1}=${options.length}`);
      if (options.length && !firstResults.length) firstResults = options;
      idx = matchOption(candidates, options.map((o) => o.textContent ?? ''));
      if (idx >= 0) break;
    }
    // Only the most specific search that returned anything may supply a "top result" guess.
    if (idx < 0) options = firstResults;
    const firstWord = normalize(query).split(' ')[0] ?? '';
    if (idx < 0 && opts.acceptFirstResult && firstWord && normalize(options[0]?.textContent ?? '').includes(firstWord)) {
      idx = 0;
    }
    // Results came back for the query: the top one is the best guess ("San Jose, CA, United States").
    if (idx < 0 && opts.topOption) idx = firstReal(options);
  }
  if (idx < 0 && opts.topOption && !query) idx = firstReal(staticOptions);

  const choice = options[idx];
  console.info(`[Job Autofill] dropdown "${field.label.slice(0, 40)}": ${trace.join(' ')} -> ${choice ? 'picked an option' : 'no match'}`);
  if (!choice) {
    if (input.value) setNativeValueKeepFocus(input, '');
    closeMenu(input);
    return 'nomatch';
  }

  clickSafely(choice);
  await sleep(120);
  closeMenu(input);
  // Give the page time to commit the choice to its own state before the next field is touched.
  await sleep(timing.settle);
  return comboboxHasValue(field) || !input.isConnected ? 'filled' : 'failed';
}

/** Search texts to try in a type-ahead dropdown: each candidate as written, then punctuation-free and shortened forms of the first. */
export function searchQueries(candidates: string[]): string[] {
  const clean = (s: string) => s.replace(/[(),;:.\/-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = (s: string, n: number) => clean(s).split(' ').slice(0, n).join(' ');
  const first = candidates[0] ?? '';
  const tail = (n: number) => clean(first).split(' ').slice(-n).join(' ');
  // The distinctive end of a name ("Santa Cruz") often finds it when the full wording does not.
  const all = [first, ...candidates.slice(1, 3), clean(first), tail(2), words(first, 4), words(first, 3), words(first, 2)];
  return Array.from(new Set(all.map((q) => q.trim()).filter((q) => q.length >= 2)));
}

/** The arrow/toggle button of a custom dropdown, if it has one. */
export function indicatorFor(field: ScannedField): HTMLElement | null {
  const scope = field.outlineTarget;
  return (
    scope.querySelector<HTMLElement>('button[aria-label*="toggle" i], button[aria-label*="flyout" i], button[aria-label*="open" i]') ??
    scope.querySelector<HTMLElement>('[class*="dropdown-indicator"], [class*="dropdownIndicator"], [class*="indicatorContainer"]:not([class*="separator"])')
  );
}

/**
 * Types into a search box one character at a time. Some react-select search lists (Greenhouse locations)
 * ignore a whole query set at once and only search when text arrives as typing would.
 */
export function setNativeValueKeepFocus(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  const win = el.ownerDocument.defaultView ?? window;
  const write = (v: string) => (setter ? setter.call(el, v) : (el.value = v));
  withGuard(el, () => {
    el.focus({ preventScroll: true });
    if (!value) {
      write('');
      fire(el, 'input');
      return;
    }
    let typed = '';
    for (const ch of value) {
      el.dispatchEvent(new win.KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true, composed: true }));
      typed += ch;
      write(typed);
      const InputEventCtor = win.InputEvent ?? win.Event;
      el.dispatchEvent(new InputEventCtor('input', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: ch } as InputEventInit));
      el.dispatchEvent(new win.KeyboardEvent('keyup', { key: ch, bubbles: true, composed: true }));
    }
  });
}

/** Lever-style location inputs: type, then pick the first suggestion that mentions the city. */
export async function fillTypeahead(field: ScannedField, candidates: string[]): Promise<FillOutcome> {
  const input = field.el as HTMLInputElement;
  const container = input.closest('li, [class*="field"], .application-question') ?? input.parentElement!;
  // Lever keeps the chosen suggestion in a hidden box. Text with an empty hidden box was prefilled (e.g. by
  // resume parsing) without picking a suggestion, so search again and select one.
  const chosen = container.querySelector<HTMLInputElement>('input[type="hidden"][name="selectedLocation"]');
  const unchosen = !!chosen && !chosen.value.trim();
  if (input.value.trim() && !unchosen) return 'already';
  if (!candidates[0]) return input.value.trim() ? 'already' : 'nomatch';
  if (input.value.trim()) setNativeValueKeepFocus(input, '');
  setNativeValueKeepFocus(input, candidates[0]);
  const suggestion = await waitFor(() => {
    const items = Array.from(
      container.querySelectorAll<HTMLElement>('[role="option"], .dropdown-results > div, .dropdown-location, .pac-item'),
    ).filter((el) => el.textContent?.trim());
    if (!items.length) return null;
    const idx = bestOption(candidates, items.map((i) => i.textContent ?? ''));
    return items[Math.max(idx, 0)];
  }, timing.typeahead);
  if (suggestion) clickSafely(suggestion);
  await sleep(100);
  withGuard(input, () => {
    fire(input, 'change');
    input.blur();
  });
  if (chosen?.value.trim()) keepSelection(input, chosen);
  return input.value.trim() ? 'filled' : 'failed';
}

/**
 * Lever's resume parser can finish after we pick a suggestion (it can take a while) and reset the hidden
 * "selected location" box (empty or a stub like {"name":""}); the text stays but the form then refuses to submit. While the visible text is
 * unchanged, put the choice back, and again right before the form is submitted.
 */
function keepSelection(input: HTMLInputElement, hidden: HTMLInputElement) {
  const saved = hidden.value;
  const text = input.value;
  const doc = input.ownerDocument;
  const restore = () => {
    if (input.isConnected && hidden.value !== saved && input.value === text) hidden.value = saved;
  };
  const timer = setInterval(() => {
    if (!input.isConnected) clearInterval(timer);
    else restore();
  }, 250);
  for (const type of ['click', 'submit', 'mousedown']) doc.addEventListener(type, restore, true);
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export function fieldHasValue(field: ScannedField): boolean {
  switch (field.kind) {
    case 'text':
    case 'textarea':
      return !!(field.el as HTMLInputElement).value.trim();
    case 'select': {
      const s = field.el as HTMLSelectElement;
      const o = s.options[s.selectedIndex];
      return !!o && !!o.value && !/^(select|please select|choose)/i.test(o.text.trim());
    }
    case 'radio':
    case 'checkbox':
    case 'checkboxGroup':
      return (field.members as HTMLInputElement[]).some((m) => m.checked);
    case 'combobox':
      return comboboxHasValue(field);
    case 'listbox':
      return listboxHasValue(field);
    case 'prompt':
      return promptHasValue(field);
    case 'yesno':
      return field.members.some(
        (b) => b.getAttribute('aria-pressed') === 'true' || SELECTED_CLASS.test(b.className),
      );
    case 'file': {
      const input = field.el as HTMLInputElement;
      if (input.files && input.files.length) return true;
      // Some forms move the upload elsewhere and show the file name instead.
      return /\.(pdf|docx?|txt|rtf)\b/i.test(field.outlineTarget.textContent ?? '');
    }
  }
}
