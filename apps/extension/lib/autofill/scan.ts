export type FieldKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'combobox'
  | 'radio'
  | 'checkbox'
  | 'checkboxGroup'
  | 'yesno'
  | 'file'
  /** A button that opens a list of options (Workday "Select One" dropdowns). */
  | 'listbox'
  /** A search box that picks items into a list of chips (Workday multiselect prompts). */
  | 'prompt';

/** A numbered, repeatable block such as "Work Experience 2" or "Education 1". */
export interface Section {
  kind: 'experience' | 'education';
  /** Zero-based entry number. */
  index: number;
}

export interface ScannedField {
  kind: FieldKind;
  /** Primary element: the input, or the first input/button of a group. */
  el: HTMLElement;
  /** Radio/checkbox inputs or Yes/No buttons in the group. */
  members: HTMLElement[];
  /** Option labels for selects and groups (aligned with `members` for groups). */
  options: string[];
  label: string;
  id: string;
  name: string;
  /** Ashby's data-field-path or Workday's data-automation-id, when present. */
  path: string;
  /** The repeatable entry the field belongs to, when it sits under a numbered heading. */
  section?: Section;
  autocomplete: string;
  required: boolean;
  maxLength?: number;
  /** Element to outline during review. */
  outlineTarget: HTMLElement;
}

/** Marks nodes this extension adds to the page so the scanner and observer ignore them. */
export const OWN_ATTR = 'data-jaf';

const TEXT_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'number', 'search', 'date', 'month']);
const GENERIC_LABELS = /^(attach|upload|upload file|browse|enter manually|choose file|select files?|(or )?drop files? here)$/i;
/** Labels that name only part of a date ("Month"); the question is the label of the group around it. */
const DATE_PART_RE = /^(month|year|day|mm|yyyy|yy|dd)$/i;
const HEADINGS = 'h1, h2, h3, h4, h5, h6, legend, [role="heading"]';
const SECTION_HEADING_RE = /^(work experience|experience|employment( history)?|employer|job|position|education|school)\s*#?\s*(\d+)$/i;
const SECTION_ID_RE = /^(workExperience|education)-\d+--/;
const LABELISH =
  'label, legend, .application-label, [class*="question-title"], [class*="questionTitle"], [class*="label"], [class*="Label"]';

export function cleanLabel(raw: string): string {
  return raw
    .replace(/ /g, ' ')
    .replace(/[*✱]/g, '')
    .replace(/\(required\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function textOf(el: Element | null | undefined): string {
  return el ? cleanLabel((el as HTMLElement).innerText ?? el.textContent ?? '') : '';
}

function isHidden(el: HTMLElement): boolean {
  if (el.closest(`[${OWN_ATTR}]`)) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
    if (node.hidden) return true;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
  }
  return false;
}

function precedes(a: Node, b: Node): boolean {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** Nearest preceding label-like element inside an enclosing container. */
function precedingLabel(el: HTMLElement, group: HTMLElement[], skip: RegExp = GENERIC_LABELS): { text: string; labelEl: Element | null } {
  const groupIds = new Set(group.map((g) => g.id).filter(Boolean));
  let ancestor = el.parentElement;
  for (let depth = 0; ancestor && depth < 7; depth++, ancestor = ancestor.parentElement) {
    const candidates = Array.from(ancestor.querySelectorAll(LABELISH)).filter((c) => {
      if (c.closest(`[${OWN_ATTR}]`)) return false;
      if (group.some((g) => c.contains(g))) return false;
      if (c.tagName === 'LABEL' && groupIds.has(c.getAttribute('for') ?? '')) return false;
      if (c.querySelector('input, select, textarea, button[aria-haspopup]')) return false;
      // Captions inside upload buttons ("ATTACH RESUME/CV") are not the question.
      if (c.closest('a, button')) return false;
      return precedes(c, el);
    });
    const last = candidates[candidates.length - 1];
    const t = textOf(last);
    if (last && t && !skip.test(t) && !GENERIC_LABELS.test(t)) return { text: t, labelEl: last };
  }
  return { text: '', labelEl: null };
}

/** "From" for the Month box of a "From: [MM] / [YYYY]" date, read from the group around it. */
function dateGroupLabel(el: HTMLElement): string {
  const doc = el.ownerDocument;
  const legend = el.closest('fieldset')?.querySelector('legend');
  if (legend && textOf(legend)) return textOf(legend);
  const group = el.closest('[role="group"]');
  const labelledBy = group?.getAttribute('aria-labelledby');
  if (labelledBy) {
    const t = cleanLabel(labelledBy.split(/\s+/).map((id) => textOf(doc.getElementById(id))).join(' '));
    if (t) return t;
  }
  const aria = group?.getAttribute('aria-label');
  if (aria) return cleanLabel(aria);
  return precedingLabel(el, [el], DATE_PART_RE).text;
}

/** The numbered entry ("Work Experience 2") a field sits in, from the nearest heading above it or a Workday id. */
export function sectionOf(el: HTMLElement): Section | undefined {
  const doc = el.ownerDocument;
  let nearest: Element | undefined;
  for (const h of Array.from(doc.querySelectorAll(HEADINGS))) {
    if (h.closest(`[${OWN_ATTR}]`)) continue;
    if (!precedes(h, el)) break;
    // A legend usually names one question ("From"), not the entry; only a numbered one counts.
    if (h.tagName === 'LEGEND' && !SECTION_HEADING_RE.test(textOf(h))) continue;
    nearest = h;
  }
  const m = SECTION_HEADING_RE.exec(textOf(nearest));
  if (m) {
    const kind = /education|school/i.test(m[1]!) ? 'education' : 'experience';
    return { kind, index: Math.max(0, parseInt(m[3]!, 10) - 1) };
  }
  // Workday ids carry a per-entry number that is not the entry's position, so count distinct prefixes.
  const prefix = (el.closest('[id]')?.id ?? '').match(SECTION_ID_RE)?.[0];
  if (prefix) {
    const kind = prefix.startsWith('education') ? 'education' : 'experience';
    const all = Array.from(doc.querySelectorAll(`[id^="${prefix.split('-')[0]}-"]`))
      .map((n) => n.id.match(SECTION_ID_RE)?.[0])
      .filter((p): p is string => !!p);
    return { kind, index: Math.max(0, Array.from(new Set(all)).indexOf(prefix)) };
  }
  return undefined;
}

/**
 * The question text for a control or a group of controls. Tries explicit associations first,
 * then the nearest label-like element before it in an enclosing container.
 */
export function findLabel(el: HTMLElement, group: HTMLElement[] = [el]): { text: string; labelEl: Element | null } {
  const doc = el.ownerDocument;
  const isGroup = group.length > 1 || el.getAttribute('type') === 'radio';

  if (!isGroup) {
    if (el.id) {
      const forLabel = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const t = textOf(forLabel);
      if (t && !GENERIC_LABELS.test(t)) return { text: t, labelEl: forLabel };
    }
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const els = labelledBy.split(/\s+/).map((id) => doc.getElementById(id)).filter(Boolean);
      const t = cleanLabel(els.map((e) => textOf(e)).join(' '));
      if (t) return { text: t, labelEl: els[0] ?? null };
    }
    const aria = el.getAttribute('aria-label');
    if (aria && !GENERIC_LABELS.test(aria.trim())) return { text: cleanLabel(aria), labelEl: null };
  } else {
    const fieldset = el.closest('fieldset');
    const legend = fieldset?.querySelector('legend');
    if (legend && textOf(legend)) return { text: textOf(legend), labelEl: legend };
    const groupEl = el.closest('[role="radiogroup"], [role="group"]');
    const groupLabel = groupEl?.getAttribute('aria-labelledby');
    if (groupLabel) {
      const t = textOf(doc.getElementById(groupLabel));
      if (t) return { text: t, labelEl: doc.getElementById(groupLabel) };
    }
  }

  const preceding = precedingLabel(el, group);
  if (preceding.text) return preceding;

  // Lever wraps the whole question in a <label>: use its text minus the control's own text.
  const wrap = el.closest('label');
  if (wrap && !isGroup) {
    const t = textOf(wrap);
    if (t) return { text: t, labelEl: wrap };
  }

  const placeholder = el.getAttribute('placeholder');
  if (placeholder && !/^(type here|start typing|select)/i.test(placeholder)) {
    return { text: cleanLabel(placeholder), labelEl: null };
  }
  return { text: '', labelEl: null };
}

function isRequired(members: HTMLElement[], labelEl: Element | null): boolean {
  if (members.some((m) => (m as HTMLInputElement).required || m.getAttribute('aria-required') === 'true')) {
    return true;
  }
  if (!labelEl) return false;
  if (/required/i.test((labelEl as HTMLElement).className ?? '')) return true;
  if (labelEl.querySelector('.required, [class*="required"]')) return true;
  return /[*✱]/.test(labelEl.textContent ?? '');
}

function optionText(input: HTMLInputElement): string {
  const doc = input.ownerDocument;
  if (input.id) {
    const l = doc.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (l && textOf(l)) return textOf(l);
  }
  const wrap = input.closest('label');
  if (wrap && textOf(wrap)) return textOf(wrap);
  const aria = input.getAttribute('aria-label');
  if (aria) return cleanLabel(aria);
  const next = input.nextElementSibling;
  if (next && textOf(next)) return textOf(next);
  return input.value;
}

/** Ancestor that holds every member of a group, used as the outline target. */
function commonContainer(members: HTMLElement[]): HTMLElement {
  const first = members[0]!;
  let node: HTMLElement | null = first.parentElement;
  while (node && !members.every((m) => node!.contains(m))) node = node.parentElement;
  const container = node ?? first;
  return (container.closest('fieldset') as HTMLElement | null) ?? container;
}

function comboboxOutline(input: HTMLElement): HTMLElement {
  return (
    (input.closest('[class*="select__control"], [class*="control"], [class*="inputContainer"]') as HTMLElement | null) ??
    input.parentElement ??
    input
  );
}

function makeField(kind: FieldKind, el: HTMLElement, members: HTMLElement[], options: string[], outlineTarget: HTMLElement): ScannedField {
  const found = findLabel(el, members);
  const { labelEl } = found;
  let text = found.text;
  if (DATE_PART_RE.test(text)) {
    const group = dateGroupLabel(el);
    if (group && !DATE_PART_RE.test(group)) text = `${group} ${text}`;
  }
  const input = el as HTMLInputElement;
  const maxLength = 'maxLength' in input && input.maxLength > 0 ? input.maxLength : undefined;
  return {
    kind,
    el,
    members,
    options,
    label: text,
    id: el.id,
    name: el.getAttribute('name') ?? '',
    path: el.closest('[data-field-path]')?.getAttribute('data-field-path') ?? el.getAttribute('data-automation-id') ?? '',
    section: sectionOf(el),
    autocomplete: el.getAttribute('autocomplete') ?? '',
    required: isRequired(members, labelEl),
    maxLength,
    outlineTarget,
  };
}

/** Finds every fillable control under `root`, grouping radios, checkboxes, and Yes/No buttons. */
export function scanFields(root: ParentNode): ScannedField[] {
  const fields: ScannedField[] = [];
  const seenGroups = new Set<string>();
  const yesNoContainers = new Set<Element>();

  // Yes/No button pairs (Ashby). Their hidden checkbox is skipped below.
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('button'))) {
    if (btn.textContent?.trim().toLowerCase() !== 'yes' || isHidden(btn)) continue;
    const parent = btn.parentElement;
    if (!parent || yesNoContainers.has(parent)) continue;
    const buttons = Array.from(parent.querySelectorAll<HTMLButtonElement>(':scope > button'));
    const no = buttons.find((b) => b.textContent?.trim().toLowerCase() === 'no');
    if (!no || buttons.length !== 2) continue;
    yesNoContainers.add(parent);
    fields.push(makeField('yesno', btn, buttons, ['Yes', 'No'], parent));
  }

  // Buttons that open a list (Workday "Select One"). Their text shows the current choice.
  for (const btn of Array.from(root.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"]'))) {
    if (isHidden(btn) || (btn as HTMLButtonElement).disabled) continue;
    fields.push(makeField('listbox', btn, [btn], [], btn));
  }

  const controls = root.querySelectorAll<HTMLElement>('input, textarea, select');
  for (const el of Array.from(controls)) {
    const tag = el.tagName;
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    const name = el.getAttribute('name') ?? '';
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image') continue;
    if (/captcha/i.test(name) || /captcha/i.test(el.id)) continue;
    if (el.parentElement && yesNoContainers.has(el.parentElement)) continue;
    if (type !== 'file' && isHidden(el)) continue;
    if ((el as HTMLInputElement).disabled) continue;

    if (type === 'file') {
      const outline = (el.closest('[class*="field"], li, .application-question, fieldset') as HTMLElement | null) ?? el.parentElement ?? el;
      fields.push(makeField('file', el, [el], [], outline));
      continue;
    }

    if (type === 'radio' || type === 'checkbox') {
      // Survey questions often leave radios unnamed, or give each checkbox its own name; the
      // surrounding fieldset or radiogroup is then the only thing tying the choices together.
      const wrapper = el.closest<HTMLElement>('fieldset, [role="radiogroup"], [role="group"]');
      const inWrapper = wrapper
        ? Array.from(wrapper.querySelectorAll<HTMLInputElement>(`input[type="${type}"]`)).filter((m) => !isHidden(m))
        : [];
      const grouped = inWrapper.length > 1 && (type === 'radio' ? !name : true);
      const key = grouped ? `wrap:${type}:${inWrapper[0]!.id || inWrapper[0]!.name}:${inWrapper.length}` : `${type}:${name || el.id}`;
      if ((name || grouped) && seenGroups.has(key)) continue;
      seenGroups.add(key);
      const scope = el.closest('form') ?? root;
      const members = grouped
        ? inWrapper
        : name
          ? Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="${type}"][name="${CSS.escape(name)}"]`)).filter(
              (m) => !isHidden(m),
            )
          : [el as HTMLInputElement];
      const options = members.map(optionText);
      const kind: FieldKind = type === 'radio' ? 'radio' : members.length > 1 ? 'checkboxGroup' : 'checkbox';
      fields.push(makeField(kind, members[0] ?? el, members, options, commonContainer(members.length ? members : [el])));
      continue;
    }

    if (tag === 'SELECT') {
      const select = el as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.text.trim());
      fields.push(makeField('select', el, [el], options, el));
      continue;
    }

    if (tag === 'TEXTAREA') {
      fields.push(makeField('textarea', el, [el], [], el));
      continue;
    }

    if (isPromptInput(el)) {
      fields.push(makeField('prompt', el, [el], [], promptContainer(el)));
      continue;
    }

    const role = el.getAttribute('role');
    const autocompleteList = /^(list|both)$/.test(el.getAttribute('aria-autocomplete') ?? '');
    if (role === 'combobox' || autocompleteList) {
      fields.push(makeField('combobox', el, [el], [], comboboxOutline(el)));
      continue;
    }

    if (TEXT_TYPES.has(type)) fields.push(makeField('text', el, [el], [], el));
  }
  return fields;
}

/** Workday-style multiselect search box: type, press Enter, and pick results into chips. */
function isPromptInput(el: HTMLElement): boolean {
  return (
    el.getAttribute('data-uxi-widget-type') === 'selectinput' ||
    (el.getAttribute('data-automation-id') === 'searchBox' &&
      !!el.closest('[data-automation-id="multiSelectContainer"], [data-automation-id="multiselectInputContainer"]'))
  );
}

export function promptContainer(el: HTMLElement): HTMLElement {
  return (
    (el.closest('[data-automation-id="multiSelectContainer"], [data-automation-id="multiselectInputContainer"]') as HTMLElement | null) ??
    el.parentElement ??
    el
  );
}

/**
 * A sign-in or create-account page: a password box with only a few other fields. Filling stops there; the
 * person signs in themselves, and filling continues on the form that appears next.
 */
export function isSignInPage(root: ParentNode, fields: ScannedField[] = scanFields(root)): boolean {
  const passwords = Array.from(root.querySelectorAll<HTMLElement>('input[type="password"]')).filter((p) => !isHidden(p));
  return passwords.length > 0 && fields.filter((f) => f.kind !== 'checkbox' && f.kind !== 'yesno').length <= 3;
}
