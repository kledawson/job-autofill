import type { ScannedField } from './scan';
import { scanFields } from './scan';
import { clickSafely, closeMenu, comboboxContainer, comboboxSelectedValues, displayedValue,
  indicatorFor, dispatchSelectionChange, openSelectionMenu, setNativeValueKeepFocus, sleep, timing } from './fill';
import { isPlaceholderOption } from './match';
import { resolveRememberedSelections, sameSelections } from '../selection-matching';
import { exclusiveAnswer, type AnswerSelection, type SelectionMode } from '../remembered-mappings';

function checkboxQuestion(field: ScannedField): boolean {
  const group = field.el.closest('fieldset, [role="group"]');
  if (!group || !(group.querySelector(':scope > legend')?.textContent?.trim() || group.getAttribute('aria-label') || group.getAttribute('aria-labelledby'))) return false;
  const members = [...group.querySelectorAll('input[type="checkbox"]')];
  return members.length === field.members.length && field.members.every(m => m.closest('fieldset, [role="group"]') === group) &&
    !/consent|agree|acknowledge|certify|privacy|terms|subscribe|text messages/i.test(`${field.label} ${field.options.join(' ')}`);
}

/** Prove cardinality from native/accessibility semantics or the tested React-select chip structure. */
export function selectionMode(field: ScannedField): SelectionMode {
  if (field.kind === 'select') return (field.el as HTMLSelectElement).multiple ? 'multiple' : 'single';
  if (field.kind === 'checkboxGroup') return checkboxQuestion(field) ? 'multiple' : 'unknown';
  if (field.kind !== 'combobox') return field.kind === 'prompt' ? 'unknown' : 'single';
  const box = comboboxContainer(field);
  const listId = field.el.getAttribute('aria-controls') ?? field.el.getAttribute('aria-owns');
  const list = listId ? field.el.ownerDocument.getElementById(listId) : null;
  if (field.el.getAttribute('aria-multiselectable') === 'true' || list?.getAttribute('aria-multiselectable') === 'true' ||
    box.querySelector('[class*="multi-value" i], [class*="multiValue" i]')) return 'multiple';
  if (list?.getAttribute('aria-multiselectable') === 'false' || box.querySelector('[class*="single-value" i], [class*="singleValue" i]')) return 'single';
  return 'unknown';
}

export function selectedValues(field: ScannedField): string[] {
  if (field.kind === 'select' && (field.el as HTMLSelectElement).multiple) return Array.from((field.el as HTMLSelectElement).options).filter(o => o.selected && !isPlaceholderOption(o.text)).map(o => o.text.trim());
  if (field.kind === 'checkboxGroup') return field.members.flatMap((m, i) => (m as HTMLInputElement).checked ? [field.options[i]!] : []);
  if (field.kind === 'combobox') return comboboxSelectedValues(field);
  const value = displayedValue(field).trim();
  return value ? [value] : [];
}

export interface MultipleWriteResult { outcome: 'filled' | 'already' | 'nomatch' | 'failed'; labels: string[]; reason?: string }

function ownOptions(field: ScannedField): HTMLElement[] {
  const id = field.el.getAttribute('aria-controls') ?? field.el.getAttribute('aria-owns');
  const linked = id ? field.el.ownerDocument.getElementById(id) : null;
  const scope = linked ?? comboboxContainer(field);
  return Array.from(scope.querySelectorAll<HTMLElement>('[role="option"]')).filter(o => !o.closest('[hidden]') && o.ownerDocument.defaultView?.getComputedStyle(o).display !== 'none');
}
/** A scoped resolver can follow an input rerender, but only a unique unchanged question. */
export function reacquireSelectionField(root: ParentNode, previous: ScannedField): ScannedField | undefined {
  const all = scanFields(root);
  const same = all.find(f => f.el === previous.el);
  const candidates = all.filter(f => f.kind === previous.kind && f.label === previous.label && f.id === previous.id && f.name === previous.name && f.path === previous.path &&
    f.section?.kind === previous.section?.kind && f.section?.index === previous.section?.index);
  if (same && same.label !== previous.label) return undefined;
  if (candidates.length !== 1 || (!same && !previous.id && !previous.path)) return undefined;
  return candidates[0];
}

/** Strict remembered-set writer. A non-empty group is always preserved; partial writes stay incomplete. */
export async function fillRememberedSelections(getField: () => ScannedField | undefined, selections: AnswerSelection[], budgetMs = 8000): Promise<MultipleWriteResult> {
  const end = Date.now() + budgetMs;
  let touched = false;
  let writing = false;
  const write = (action: () => void) => { writing = true; try { action(); } finally { writing = false; } };
  let expected: string[] = [];
  const initial = getField();
  if (!initial) return { outcome: 'failed', labels: [], reason: 'This question changed. Fill the page again.' };
  if (selectedValues(initial).length) return { outcome: 'already', labels: [] };
  const doc = initial.el.ownerDocument;
  const onEdit = (event: Event) => {
    // Native checkbox.click() emits trusted input/change synchronously. These are our
    // writes; genuine user events during awaited widget work must still cancel it.
    if (!writing && event.isTrusted && (event.type === 'keydown' || event.type === 'pointerdown' || event.type === 'input' || event.type === 'change')) touched = true;
  };
  for (const type of ['keydown', 'pointerdown', 'input', 'change']) doc.addEventListener(type, onEdit, true);
  const live = () => {
    const field = getField();
    if (!field || touched || Date.now() >= end || !sameSelections(selectedValues(field), expected)) return undefined;
    return field;
  };
  const wait = async <T,>(read: () => T | undefined, maxMs: number): Promise<T | undefined> => {
    const until = Math.min(end, Date.now() + maxMs);
    do { const result = read(); if (result) return result; await sleep(Math.min(40, Math.max(5, maxMs / 3))); } while (!touched && Date.now() < until);
    return undefined;
  };
  const failed = (reason: string): MultipleWriteResult => ({ outcome: expected.length ? 'failed' : 'nomatch', labels: expected, reason });
  const open = async () => {
    const field = live();
    if (!field) return undefined;
    write(() => openSelectionMenu(field.el));
    if (!ownOptions(field).length) { const arrow = indicatorFor(field); if (arrow) write(() => clickSafely(arrow)); }
    await wait(() => { const f = live(); return f && ownOptions(f).length ? true : undefined; }, timing.menuOpen);
    return live();
  };
  try {
    let field = initial;
    if (field.kind === 'combobox' && selectionMode(field) !== 'multiple') field = await open() ?? field;
    if (selectionMode(field) !== 'multiple') return failed('This widget does not expose a supported multiple-choice selection.');
    if (field.kind === 'select' || field.kind === 'checkboxGroup') {
      const disabled = field.kind === 'select' ? Array.from((field.el as HTMLSelectElement).options).flatMap((o, i) => o.disabled || o.parentElement?.matches('optgroup[disabled]') ? [i] : []) : field.members.flatMap((m, i) => (m as HTMLInputElement).disabled ? [i] : []);
      const plan = resolveRememberedSelections(selections, field.options, disabled);
      if (!plan.ok) return failed(plan.reason);
      if (!live()) return failed('The page selection changed. Your choices were kept.');
      if (field.kind === 'select') {
        const select = field.el as HTMLSelectElement;
        Array.from(select.options).forEach((o, i) => o.selected = plan.indices.includes(i));
        // Reuse guarded dispatch so even a site's change handler cannot submit the application.
        write(() => dispatchSelectionChange(select));
      } else {
        for (const index of plan.indices) {
          const current = live();
          if (!current || current.members.length !== field.members.length || !current.members.every((m, i) => m === field.members[i])) return failed('This checkbox group changed. Review the selected answers.');
          write(() => clickSafely(current.members[index]!));
          expected.push(plan.labels[plan.indices.indexOf(index)]!);
          if (!sameSelections(selectedValues(current), expected)) return failed('Not every selected answer was accepted. Review this field.');
        }
      }
      const current = getField();
      return current && !touched && sameSelections(selectedValues(current), plan.labels) ? { outcome: 'filled', labels: plan.labels } : { outcome: 'failed', labels: plan.labels, reason: 'Not every selected answer was accepted. Review this field.' };
    }
    if (field.kind !== 'combobox') return failed('This multiple-choice widget is not supported yet.');
    // Discover every answer before selecting any. Query results are never treated as selected values.
    const resolved: string[] = [];
    const locate = async (selection: AnswerSelection) => {
      let current = await open();
      if (!current) return undefined;
      const read = () => {
        const f = live(); if (!f) return undefined;
        const options = ownOptions(f).filter(o => o.getAttribute('aria-disabled') !== 'true' && !o.matches('[disabled]'));
        const plan = resolveRememberedSelections([selection], options.map(o => o.textContent?.trim() ?? ''));
        return plan.ok ? { element: options[plan.indices[0]!]!, label: plan.labels[0]! } : undefined;
      };
      let found = read();
      if (found) return found;
      for (const query of [selection.value, ...selection.aliases].slice(0, 3)) {
        current = live(); if (!current) return undefined;
        write(() => setNativeValueKeepFocus(current!.el as HTMLInputElement, query));
        found = await wait(read, Math.min(timing.search, 1000));
        if (found) return found;
      }
      return undefined;
    };
    for (const selection of selections) {
      const option = await locate(selection);
      if (!option) return failed('A saved selection is unavailable or ambiguous. Choose your answers on the page.');
      if (resolved.includes(option.label)) return failed('Two memories match the same option. Review their labels.');
      resolved.push(option.label);
    }
    if (resolved.length > 1 && resolved.some(exclusiveAnswer)) return failed('An exclusive answer must be selected by itself.');
    for (const [i, selection] of selections.entries()) {
      const option = await locate(selection);
      if (!option || option.label !== resolved[i] || !live()) return failed('The dropdown changed before all answers could be selected. Review this field.');
      write(() => clickSafely(option.element));
      const next = [...expected, option.label];
      const committed = await wait(() => { const f = getField(); return f && !touched && sameSelections(selectedValues(f), next) ? f : undefined; }, Math.max(120, timing.settle));
      if (!committed) return { outcome: 'failed', labels: next, reason: 'Not every selected answer was accepted. Review this field.' };
      expected = next;
    }
    return { outcome: 'filled', labels: resolved };
  } finally {
    for (const type of ['keydown', 'pointerdown', 'input', 'change']) doc.removeEventListener(type, onEdit, true);
    const field = getField();
    if (field?.kind === 'combobox' && !touched) { setNativeValueKeepFocus(field.el as HTMLInputElement, ''); closeMenu(field.el); }
  }
}
