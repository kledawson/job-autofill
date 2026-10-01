import { bestOption, firstSearchResultIsRelevant } from './match';
import type { ScannedField } from './scan';

const SELECTED_CLASS = /(^|[\s_-])(active|selected|checked|pressed)([\s_-]|$)/i;

export type FillOutcome = 'filled' | 'already' | 'nomatch' | 'failed';

/** Waits used while dropdowns load; tests shorten these. */
export const timing = { menuOpen: 1000, search: 4000, selection: 1500, settle: 120, typeahead: 4000, afterUpload: 2000 };

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => T | null | undefined | false, timeout: number, interval = 80): Promise<T | null> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(interval);
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
  el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
}

function mouse(el: Element, type: string) {
  const view = el.ownerDocument.defaultView ?? window;
  el.dispatchEvent(new view.MouseEvent(type, { bubbles: true, cancelable: true, view, button: 0 }));
}

function key(el: Element, k: string) {
  const view = el.ownerDocument.defaultView ?? window;
  el.dispatchEvent(new view.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

export function clickSafely(el: HTMLElement) {
  withGuard(el, () => {
    mouse(el, 'pointerdown');
    mouse(el, 'mousedown');
    mouse(el, 'pointerup');
    mouse(el, 'mouseup');
    el.click();
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
    el.focus({ preventScroll: true });
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
  setNativeValue(el, v);
  return el.value === v ? 'filled' : 'failed';
}

export function fillSelect(field: ScannedField, candidates: string[]): FillOutcome {
  const select = field.el as HTMLSelectElement;
  const current = select.options[select.selectedIndex];
  if (current && current.value && select.selectedIndex > 0) return 'already';
  const options = Array.from(select.options);
  const idx = bestOption(candidates, options.map((o) => o.text));
  const option = options[idx];
  if (!option) return 'nomatch';
  withGuard(select, () => {
    select.focus({ preventScroll: true });
    select.value = option.value;
    option.selected = true;
    fire(select, 'input');
    fire(select, 'change');
    select.blur();
  });
  return select.selectedIndex === idx ? 'filled' : 'failed';
}

export function fillRadio(field: ScannedField, candidates: string[]): FillOutcome {
  const radios = field.members as HTMLInputElement[];
  if (radios.some((r) => r.checked)) return 'already';
  const radio = radios[bestOption(candidates, field.options)];
  if (!radio) return 'nomatch';
  clickSafely(radio);
  if (!radio.checked) {
    radio.checked = true;
    withGuard(radio, () => fire(radio, 'change'));
  }
  return radio.checked ? 'filled' : 'failed';
}

export function fillCheckboxGroup(field: ScannedField, candidates: string[]): FillOutcome {
  const boxes = field.members as HTMLInputElement[];
  if (boxes.some((b) => b.checked)) return 'already';
  const box = boxes[bestOption(candidates, field.options)];
  if (!box) return 'nomatch';
  clickSafely(box);
  return box.checked ? 'filled' : 'failed';
}

export function fillYesNo(field: ScannedField, candidates: string[]): FillOutcome {
  const buttons = field.members;
  if (buttons.some((b) => b.getAttribute('aria-pressed') === 'true' || SELECTED_CLASS.test(b.className))) {
    return 'already';
  }
  const button = buttons[bestOption(candidates, field.options)];
  if (!button) return 'nomatch';
  clickSafely(button);
  return 'filled';
}

export function fillFile(field: ScannedField, file: File): FillOutcome {
  const input = field.el as HTMLInputElement;
  if (input.files && input.files.length) return 'already';
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

// --- Custom dropdowns (react-select on Greenhouse, Ashby autocompletes) ---

function isVisible(el: Element): boolean {
  const h = el as HTMLElement;
  if (h.hidden || h.getAttribute('aria-hidden') === 'true') return false;
  const rects = h.getClientRects?.();
  // happy-dom and detached nodes report no rects; treat those as visible.
  return !rects || rects.length > 0 || !h.ownerDocument.defaultView?.getComputedStyle;
}

function comboboxOptions(input: HTMLElement): HTMLElement[] {
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
  return Array.from(doc.querySelectorAll<HTMLElement>('[role="option"]')).filter(isVisible);
}

function comboboxHasValue(field: ScannedField): boolean {
  const input = field.el as HTMLInputElement;
  const box = field.outlineTarget.closest('[class*="container"], [class*="select"]') ?? field.outlineTarget;
  const shown = box.querySelector('[class*="single-value"], [class*="singleValue"], [class*="multi-value"], [class*="multiValue"]');
  if (shown?.textContent?.trim()) return true;
  const hiddenValue = box.querySelector<HTMLInputElement>('input[type="hidden"]')?.value.trim();
  return !!hiddenValue || !!input.getAttribute('aria-valuetext')?.trim();
}

function closeMenu(input: HTMLElement) {
  withGuard(input, () => {
    key(input, 'Escape');
    input.blur();
  });
}

export async function fillCombobox(
  field: ScannedField,
  candidates: string[],
  opts: { acceptFirstResult?: boolean; searchQueries?: string[] } = {},
): Promise<FillOutcome> {
  const input = field.el as HTMLInputElement;
  if (comboboxHasValue(field)) return 'already';
  // An existing query or free-typed value belongs to the applicant; do not replace it.
  if (input.value.trim()) return 'already';

  withGuard(input, () => input.focus({ preventScroll: true }));
  // React batches focus and menu state. Yield before opening and reading options.
  await sleep(0);
  clickSafely(input);
  await sleep(0);
  withGuard(input, () => key(input, 'ArrowDown'));

  // Static lists open immediately; pick from them without typing so option wording can differ.
  let options = (await waitFor(() => {
    const o = comboboxOptions(input);
    return o.length ? o : null;
  }, timing.menuOpen)) ?? [];
  let idx = bestOption(candidates, options.map((o) => o.textContent ?? ''));

  // Async search lists (locations, schools) need a query first.
  const queries = opts.searchQueries ?? [candidates[0] ?? ''];
  for (const [attempt, query] of queries.entries()) {
    if (idx >= 0 || !query || !input.isConnected) break;
    const previousOptions = options.map((option) => option.textContent?.trim() ?? '').join('\n');
    setNativeValueKeepFocus(input, query);
    await sleep(0);
    options =
      (await waitFor(() => {
        const o = comboboxOptions(input).filter((o) => !/^(loading|searching|no (results|options))/i.test(o.textContent?.trim() ?? ''));
        const changed = o.map((option) => option.textContent?.trim() ?? '').join('\n') !== previousOptions;
        const relevantFirstResult =
          attempt === 0 && opts.acceptFirstResult && firstSearchResultIsRelevant(query, o[0]?.textContent ?? '');
        return o.length && (changed || relevantFirstResult) ? o : null;
      }, timing.search)) ?? [];
    idx = bestOption(candidates, options.map((o) => o.textContent ?? ''));
    if (idx < 0 && attempt === 0 && opts.acceptFirstResult && firstSearchResultIsRelevant(query, options[0]?.textContent ?? '')) {
      idx = 0;
    }
  }

  const choice = options[idx];
  if (!choice) {
    if (input.value) setNativeValueKeepFocus(input, '');
    closeMenu(input);
    return 'nomatch';
  }

  clickSafely(choice);
  const selected = await waitFor(() => comboboxHasValue(field), timing.selection);
  closeMenu(input);
  if (!selected) {
    if (input.value) setNativeValueKeepFocus(input, '');
    closeMenu(input);
    return 'failed';
  }
  return 'filled';
}

function setNativeValueKeepFocus(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  withGuard(el, () => {
    el.focus({ preventScroll: true });
    if (setter) setter.call(el, value);
    else el.value = value;
    fire(el, 'input');
  });
}

/** Lever-style location inputs: type, then pick the first suggestion that mentions the city. */
export async function fillTypeahead(
  field: ScannedField,
  candidates: string[],
  opts: { requireSelection?: boolean } = {},
): Promise<FillOutcome> {
  const input = field.el as HTMLInputElement;
  if (input.value.trim() || !candidates[0]) return input.value.trim() ? 'already' : 'nomatch';
  const query = candidates[0];
  const container = input.closest('li, [class*="field"], .application-question') ?? input.parentElement!;
  const selector = '[role="option"], .dropdown-results > div, .dropdown-location, .pac-item';
  const suggestions = () => {
    const local = Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((el) => el.textContent?.trim() && isVisible(el));
    if (local.length) return local;
    return Array.from(input.ownerDocument.querySelectorAll<HTMLElement>('.pac-container .pac-item, [role="listbox"] [role="option"]'))
      .filter((el) => el.textContent?.trim() && isVisible(el));
  };
  setNativeValueKeepFocus(input, query);
  const suggestion = await waitFor(() => {
    const items = suggestions();
    if (!items.length) return null;
    const idx = bestOption(candidates, items.map((i) => i.textContent ?? ''));
    if (idx >= 0) return items[idx];
    return firstSearchResultIsRelevant(query, items[0]?.textContent ?? '') ? items[0] : null;
  }, timing.typeahead);
  if (!suggestion) {
    if (!opts.requireSelection && input.value.trim()) {
      withGuard(input, () => {
        fire(input, 'change');
        input.blur();
      });
      return 'filled';
    }
    setNativeValueKeepFocus(input, '');
    withGuard(input, () => {
      fire(input, 'change');
      input.blur();
    });
    return 'nomatch';
  }
  clickSafely(suggestion);
  const selected = await waitFor(() => {
    const value = input.value.trim();
    return value && (value !== query || !suggestion.isConnected || !isVisible(suggestion));
  }, timing.selection);
  withGuard(input, () => {
    fire(input, 'change');
    input.blur();
  });
  if (!selected) {
    if (!opts.requireSelection && input.value.trim()) return 'filled';
    if (input.value) setNativeValueKeepFocus(input, '');
    return 'failed';
  }
  return 'filled';
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
