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
  kind: 'experience' | 'education' | 'website';
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

// --- Shadow DOM ----------------------------------------------------------------------------------------
// Sites built from web components (SmartRecruiters) keep their inputs and labels inside open shadow roots,
// which ordinary querySelector calls do not enter.

/** Every element matching `selector` under `root`, including inside open shadow roots, in page order. */
export function deepAll<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  const out = Array.from(root.querySelectorAll<T>(selector));
  const hosts = Array.from(root.querySelectorAll('*')).filter((el) => el.shadowRoot);
  if (!hosts.length) return out;
  for (const host of hosts) out.push(...deepAll<T>(host.shadowRoot!, selector));
  // Back into page order, since a component's inner fields belong where the component sits.
  return out.sort(composedCompare);
}

/** The parent element, stepping out of a shadow root to its host. */
export function composedParent(el: Element): HTMLElement | null {
  return el.parentElement ?? (((el.getRootNode() as ShadowRoot).host as HTMLElement | undefined) ?? null);
}

/** The document or shadow root an element lives in, where its label[for] and aria ids are found. */
function rootOf(el: Element): Document | ShadowRoot {
  const root = el.getRootNode();
  return root instanceof ShadowRoot || (root as Document).nodeType === 9 ? (root as Document | ShadowRoot) : el.ownerDocument;
}

/** closest() that keeps going past shadow roots. */
export function composedClosest(el: Element, selector: string): HTMLElement | null {
  const found = el.closest(selector);
  if (found) return found as HTMLElement;
  for (let root = el.getRootNode(); root instanceof ShadowRoot; root = root.host.getRootNode()) {
    const outer = root.host.closest(selector);
    if (outer) return outer as HTMLElement;
  }
  return null;
}

/** The web components wrapping an element (nearest first). */
function hostsOf(el: Element): HTMLElement[] {
  const hosts: HTMLElement[] = [];
  for (let root = el.getRootNode(); root instanceof ShadowRoot; root = root.host.getRootNode()) hosts.push(root.host as HTMLElement);
  return hosts;
}

/** Page order across shadow roots: compares the outermost elements that share a tree. */
export function composedCompare(a: Node, b: Node): number {
  if (a === b) return 0;
  // A node no longer on the page (the step changed under it) sorts before everything that is.
  if (a.isConnected !== b.isConnected) return a.isConnected ? 1 : -1;
  const chain = (n: Node) => {
    const out: Node[] = [n];
    for (let root = n.getRootNode(); root instanceof ShadowRoot; root = root.host.getRootNode()) out.push(root.host);
    return out;
  };
  const ca = chain(a);
  const cb = chain(b);
  for (const x of ca) {
    for (const y of cb) {
      if (x !== y && x.getRootNode() === y.getRootNode()) {
        const pos = x.compareDocumentPosition(y);
        return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : pos & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
      }
    }
  }
  return 0;
}

const TEXT_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'number', 'search', 'date', 'month']);
const GENERIC_LABELS =
  /^(attach|upload|upload file|browse|enter manually|choose files?|select files?|(or )?drop files? here|file[- ]?input|file|no files? selected|click to upload.*)$/i;
/** Elements that count as a field of their own when looking for the text of the question before a control. */
const CONTROLS = 'input:not([type="hidden"]), select, textarea, button[aria-haspopup]';
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
    .trim()
    // Teamtailor writes "First name Required"; "(Optional)" is common too.
    .replace(/[\s.]*\(?\b(required|optional)\)?$/i, '')
    .trim();
}

function textOf(el: Element | null | undefined): string {
  return el ? cleanLabel((el as HTMLElement).innerText ?? el.textContent ?? '') : '';
}

/** Site chrome (language pickers, job search boxes) is never part of the application. */
const CHROME = 'header, nav, [role="banner"], [role="navigation"]';

/** Workday date boxes sit under a drawn "MM/YYYY" display, tiny or marked aria-hidden, but they are the real fields. */
const isDatePart = (el: HTMLElement) => /^dateSection(Month|Day|Year)/.test(el.getAttribute('data-automation-id') ?? '');

function isHidden(el: HTMLElement): boolean {
  if (composedClosest(el, `[${OWN_ATTR}]`)) return true;
  if (composedClosest(el, CHROME)) return true;
  if (isDatePart(el)) return isDisplayNone(el);
  if (el.getAttribute('aria-hidden') === 'true') return true;
  // Bot traps are often shrunk to a pixel rather than hidden (Workday's "beecatcher").
  const rect = el.getClientRects?.()[0];
  // Only text boxes: radios and checkboxes are often shrunk on purpose under a styled replacement.
  const textBox = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_TYPES.has((el.getAttribute('type') ?? '').toLowerCase()));
  const laidOut = (el.ownerDocument.body?.getBoundingClientRect().width ?? 0) > 0;
  if (textBox && laidOut && rect && (rect.width <= 2 || rect.height <= 2)) return true;
  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < 16; depth++, node = composedParent(node)) {
    if (node.hidden) return true;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
  }
  return false;
}

function isDisplayNone(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el, depth = 0; node && depth < 16; depth++, node = composedParent(node)) {
    if (node.hidden || node.ownerDocument.defaultView?.getComputedStyle(node).display === 'none') return true;
  }
  return false;
}

function precedes(a: Node, b: Node): boolean {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/**
 * Nearest preceding label-like element inside an enclosing container. Forms that caption fields with plain
 * text (`<span>First name</span>`, `<p>Resume*</p>`) are covered by the text just before the control,
 * whichever of the two is closer.
 */
function precedingLabel(el: HTMLElement, group: HTMLElement[], skip: RegExp = GENERIC_LABELS): { text: string; labelEl: Element | null } {
  const groupIds = new Set(group.map((g) => g.id).filter(Boolean));
  let ancestor = composedParent(el);
  let node: HTMLElement = el;
  let siblingsOpen = true;
  for (let depth = 0; ancestor && depth < 7; depth++, node = ancestor, ancestor = composedParent(ancestor)) {
    let caption: Element | null = null;
    // Previous siblings of the branch holding the control, nearest first, up to the previous field.
    for (let sib = siblingsOpen ? node.previousElementSibling : null; sib; sib = sib.previousElementSibling) {
      if (sib.closest(`[${OWN_ATTR}]`)) continue;
      if (sib.matches(CONTROLS) || sib.querySelector(CONTROLS)) {
        siblingsOpen = false;
        break;
      }
      // Upload buttons and links ("Choose File") are not the question.
      if (sib.closest('a, button') || sib.querySelector('a, button')) continue;
      const t = textOf(sib);
      if (!t || t.length > 300 || skip.test(t) || GENERIC_LABELS.test(t)) continue;
      caption = sib;
      break;
    }
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
    const labelOk = !!last && !!t && !skip.test(t) && !GENERIC_LABELS.test(t);
    if (caption && (!labelOk || precedes(last!, caption))) return { text: textOf(caption), labelEl: caption };
    if (labelOk) return { text: t, labelEl: last };
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

/** "From" / "To" for a Workday date box, from its field's label or the field's id (formField-startDate). */
function workdayDateGroup(el: HTMLElement): string {
  const field = el.closest('[data-automation-id^="formField-"]');
  const label = field?.querySelector('label, legend');
  const text = label ? textOf(label).replace(/\b(month|day|year)\b/gi, '').trim() : '';
  if (text) return text;
  const id = field?.getAttribute('data-automation-id') ?? '';
  if (/start|from|firstYear/i.test(id)) return 'From';
  if (/end|to\b|lastYear/i.test(id)) return 'To';
  return dateGroupLabel(el);
}

/** Workday entry panels (workExperience-3, education-1), counted in page order. */
const PANEL_RE = /^(workExperience|education)-\d+$/;

/** The numbered entry ("Work Experience 2") a field sits in, from its Workday panel, the nearest heading above it, or a Workday id. */
export function sectionOf(el: HTMLElement): Section | undefined {
  const doc = el.ownerDocument;
  const panel = Array.from(doc.querySelectorAll('[data-automation-id]')).filter((p) => PANEL_RE.test(p.getAttribute('data-automation-id')!) && p.contains(el)).pop();
  if (panel) {
    const kind = panel.getAttribute('data-automation-id')!.startsWith('education') ? 'education' : 'experience';
    const prefix = kind === 'education' ? 'education-' : 'workExperience-';
    const siblings = Array.from(doc.querySelectorAll(`[data-automation-id^="${prefix}"]`)).filter((p) => PANEL_RE.test(p.getAttribute('data-automation-id')!));
    return { kind, index: Math.max(0, siblings.indexOf(panel)) };
  }
  let nearest: Element | undefined;
  for (const h of Array.from(doc.querySelectorAll(HEADINGS))) {
    if (h.closest(`[${OWN_ATTR}]`)) continue;
    if (!precedes(h, el)) break;
    // A legend usually names one question ("From"), not the entry; only a numbered one counts.
    if (h.tagName === 'LEGEND' && !SECTION_HEADING_RE.test(textOf(h))) continue;
    nearest = h;
  }
  // Workday "Websites": entries have no numbered heading, so count the URL boxes since the heading.
  const site = /^(websites?|links?|social (networks|media)? ?urls?)(\s*#?\s*(\d+))?$/i.exec(textOf(nearest));
  if (site?.[4]) return { kind: 'website', index: Math.max(0, parseInt(site[4], 10) - 1) };
  if (site && nearest) {
    const boxes = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="url"], input:not([type])')).filter(
      (b) => precedes(nearest!, b) && !isHidden(b) && (b === el || precedes(b, el)),
    );
    if (el.tagName === 'INPUT' && boxes.includes(el as HTMLInputElement)) return { kind: 'website', index: boxes.length - 1 };
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
  const doc = rootOf(el);
  const isGroup = group.length > 1 || el.getAttribute('type') === 'radio';

  if (!isGroup) {
    if (el.id) {
      const forLabel = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const t = textOf(forLabel);
      if (withoutPrompt(t) && !GENERIC_LABELS.test(t)) return { text: t, labelEl: forLabel };
    }
    // Workday names its dropdown buttons "Select One Required"; that is the prompt, not the question, so
    // it is dropped and the question is read from the text before the button instead.
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const els = labelledBy.split(/\s+/).map((id) => doc.getElementById(id)).filter((e) => e && e !== el);
      const t = withoutPrompt(cleanLabel(els.map((e) => textOf(e)).join(' ')));
      if (t) return { text: t, labelEl: els[0] ?? null };
    }
    const aria = withoutPrompt(cleanLabel(el.getAttribute('aria-label') ?? ''));
    if (aria && !GENERIC_LABELS.test(aria)) return { text: aria, labelEl: null };
    // A web component often carries the question as its own attribute: <spl-input label="First name">.
    for (const host of hostsOf(el).slice(0, 3)) {
      const t = cleanLabel(host.getAttribute('label') ?? host.getAttribute('aria-label') ?? '');
      if (t && !GENERIC_LABELS.test(t)) return { text: t, labelEl: null };
    }
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
  if (preceding.text) {
    // One label over several boxes (JazzHR: "Address" over street, City, State, Postal): a label that names a
    // different box gives way to this box's own placeholder.
    const forId = preceding.labelEl?.tagName === 'LABEL' ? preceding.labelEl.getAttribute('for') : null;
    const placeholder = (el.getAttribute('placeholder') ?? '').trim();
    if (forId && forId !== el.id && placeholder && placeholder.length <= 40 && !/^(e\.?g\.?|ex\b|example|type here|start typing|select)/i.test(placeholder)) {
      return { text: cleanLabel(placeholder), labelEl: null };
    }
    return preceding;
  }

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

/** A label with a dropdown's own prompt removed: "Degree Select One Required" → "Degree"; "Select One Required" → "". */
export function withoutPrompt(text: string): string {
  return text
    .replace(/[–—-]{1,2}\s*select\s*[–—-]{1,2}|\b(select one|choose one|please select|select an option|select)\b|\brequired\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRequired(members: HTMLElement[], labelEl: Element | null): boolean {
  if (
    members.some(
      (m) =>
        (m as HTMLInputElement).required ||
        m.getAttribute('aria-required') === 'true' ||
        /\brequired\b/i.test(m.getAttribute('aria-label') ?? '') ||
        hostsOf(m).slice(0, 3).some((h) => h.hasAttribute('required') || h.getAttribute('aria-required') === 'true'),
    )
  ) {
    return true;
  }
  if (!labelEl) return false;
  if (/required/i.test((labelEl as HTMLElement).className ?? '')) return true;
  if (labelEl.querySelector('.required, [class*="required"]')) return true;
  return /[*✱]/.test(labelEl.textContent ?? '');
}

function optionText(input: HTMLInputElement): string {
  const doc = rootOf(input);
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
  // An upload inside a component named for its purpose (<oc-resume-upload>) says what it is through that name.
  if (kind === 'file' && !/resume|cv|cover|transcript/i.test(text)) {
    const chain: string[] = [];
    for (let node = composedParent(el), depth = 0; node && depth < 8; node = composedParent(node), depth++) {
      chain.push(`${node.tagName} ${node.id} ${node.getAttribute('data-test') ?? ''}`);
    }
    const named = chain.join(' ').match(/resume|cover|transcript|\bcv\b/i)?.[0]?.toLowerCase();
    if (named) text = text ? `${text} (${named})` : named;
  }
  // Workday date boxes: the id says which part, the field around it says which date ("From", "To").
  const part = /^dateSection(Month|Day|Year)/.exec(el.getAttribute('data-automation-id') ?? '')?.[1];
  if (part) text = `${workdayDateGroup(el) || text.replace(/\b(month|day|year)$/i, '').trim()} ${part}`.trim();
  else if (DATE_PART_RE.test(text)) {
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
  const seenLoose = new Set<HTMLElement>();
  const yesNoContainers = new Set<Element>();

  // Yes/No button pairs (Ashby). Their hidden checkbox is skipped below.
  for (const btn of deepAll<HTMLButtonElement>(root, 'button')) {
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
  const seenButtons = new Set<HTMLElement>();
  for (const btn of deepAll(root, 'button[aria-haspopup="listbox"]')) {
    if (isHidden(btn) || (btn as HTMLButtonElement).disabled) continue;
    seenButtons.add(btn);
    fields.push(makeField('listbox', btn, [btn], [], btn));
  }

  for (const el of deepAll(root, 'input, textarea, select')) {
    const tag = el.tagName;
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    const name = el.getAttribute('name') ?? '';
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image') continue;
    if (/captcha/i.test(name) || /captcha/i.test(el.id)) continue;
    // The search box inside a dropdown's menu (a phone country list) is part of that dropdown, not a question.
    if (isMenuSearch(el)) continue;
    if (el.parentElement && yesNoContainers.has(el.parentElement)) continue;
    // A styled dropdown keeps the real <select> hidden next to the button people click (BambooHR).
    if (tag === 'SELECT' && isHidden(el)) {
      const button = menuButtonFor(el);
      if (button && !seenButtons.has(button)) {
        seenButtons.add(button);
        const field = makeField('listbox', button, [button], [], button);
        // The select's own label ("State") beats the button's text ("State –Select–").
        field.label = findLabel(el).text || field.label;
        field.required ||= isRequired([el], el.id ? el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
        fields.push(field);
      }
      continue;
    }
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
      // Unnamed radios outside any fieldset: the choices are the radios in the nearest container holding several.
      // Checkboxes sharing a name are already one question; otherwise look for a loose list.
      const sameName = name ? (el.closest('form') ?? root).querySelectorAll(`input[type="checkbox"][name="${CSS.escape(name)}"]`).length : 0;
      const loose = grouped ? null : type === 'radio' ? (!name ? looseRadioGroup(el) : null) : sameName > 1 ? null : looseCheckboxGroup(el);
      if (loose && seenLoose.has(loose[0]!)) continue;
      if (loose) for (const m of loose) seenLoose.add(m);
      const key = grouped ? `wrap:${type}:${inWrapper[0]!.id || inWrapper[0]!.name}:${inWrapper.length}` : `${type}:${name || el.id}`;
      if ((name || grouped) && seenGroups.has(key)) continue;
      seenGroups.add(key);
      const scope = el.closest('form') ?? root;
      const members = loose
        ? loose
        : grouped
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
  const passwords = deepAll(root, 'input[type="password"]').filter((p) => !isHidden(p));
  return passwords.length > 0 && fields.filter((f) => f.kind !== 'checkbox' && f.kind !== 'yesno').length <= 3;
}

/** The radios of one question when they share no name or fieldset: those in the nearest container with several. */
function looseRadioGroup(el: HTMLElement): HTMLInputElement[] | null {
  let node = el.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    const radios = Array.from(node.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((r) => !isHidden(r));
    if (radios.length > 1) return radios.every((r) => !r.name) ? radios : null;
  }
  return null;
}

/**
 * A "select all that apply" list with no fieldset (Workday's race question): the checkboxes in the nearest
 * container holding three or more. Agreement boxes are never grouped; each stays its own question.
 */
function looseCheckboxGroup(el: HTMLElement): HTMLInputElement[] | null {
  let node = el.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    const boxes = Array.from(node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter((b) => !isHidden(b));
    if (boxes.length < 2) continue;
    if (boxes.length < 3) return null;
    const texts = boxes.map(optionText);
    if (texts.some((t) => t.length > 150 || /\b(agree|consent|acknowledge|certify|attest|terms|privacy)\b/i.test(t))) return null;
    return boxes;
  }
  return null;
}

/** The visible button that opens the menu for a hidden native select, if the two sit together. */
function menuButtonFor(select: HTMLElement): HTMLElement | null {
  let node = select.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const buttons = Array.from(node.querySelectorAll<HTMLElement>('button[aria-haspopup]')).filter((b) => !isHidden(b));
    if (buttons.length === 1) return buttons[0]!;
    if (buttons.length > 1 || node.querySelectorAll('select').length > 1) return null;
  }
  return null;
}

function isMenuSearch(el: HTMLElement): boolean {
  const hint = `${el.getAttribute('type') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('placeholder') ?? ''}`;
  if (!/\bsearch\b/i.test(hint)) return false;
  if (composedClosest(el, '[role="listbox"], [role="menu"], [role="dialog"], [role="combobox"]')) return true;
  return hostsOf(el).some((h) => /select|dropdown|menu/i.test(h.tagName));
}
