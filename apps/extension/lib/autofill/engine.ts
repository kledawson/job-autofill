import type { AnswerRequest, FieldQuestion, FillContext, Result } from '../messages';
import { AI_MAPPABLE_KEYS } from '../field-map';
import { payloadToFile } from '../messages';
import type { Adapter, JobInfo } from './adapters';
import { classifyField, type Classification, type ProfileKey } from './classify';
import {
  clickSafely,
  comboboxHasValue,
  fieldHasValue,
  fillCheckboxGroup,
  fillCheckboxes,
  displayedValue,
  openLists,
  closeListsOpenedBy,
  type ChoiceOpts,
  fillCombobox,
  fillFile,
  fillListbox,
  fillPrompt,
  fillRadio,
  fillSelect,
  fillText,
  fillTypeahead,
  closeIfOpen,
  setNativeValue,
  fillCheckbox,
  fillYesNo,
  sleep,
  timing,
  type FillOutcome,
} from './fill';
import { clearOutline, outline, type ReviewState } from './highlight';
import { characterLimitFor } from './match';
import { composedCompare, isSignInPage, scanFields, type ScannedField } from './scan';
import { WITH_CODE_RE } from './classify';
import { pickLocationPreference, raceChoices, SEARCH_FIRST_RESULT_KEYS, TOP_OPTION_KEYS, valueFor } from './values';
import { isPlaceholderOption } from './match';

export interface EngineDeps {
  context: FillContext;
  answer(req: AnswerRequest): Promise<Result<{ answer: string }>>;
  jobDescription(info: JobInfo): Promise<string>;
  /** Asks AI which profile fact (if any) answers each question no rule recognised. Optional. */
  mapFields?(fields: FieldQuestion[]): Promise<Result<{ keys: (string | null)[] }>>;
  /** Called whenever counts change (initial fill, conditional fields, user edits). */
  onProgress?(summary: FillSummary): void;
}

export interface FillSummary {
  filledCount: number;
  aiAnswers: number;
  missingLabels: string[];
  /** Why free responses were skipped, when they were. */
  aiNote?: string;
}

interface FieldRecord {
  field: ScannedField;
  cls: Classification;
  outcome?: FillOutcome;
  ai?: boolean;
  /** Flag red even if optional (a free response that could not be written). */
  flag?: boolean;
}

/** Questions whose answer is known to reveal a follow-up directly beneath them. */
const REVEALS_RE = /hispanic|latino/i;

function byDocumentOrder(a: FieldRecord, b: FieldRecord): number {
  return composedCompare(a.field.el, b.field.el);
}

export class FillSession {
  private records = new Map<HTMLElement, FieldRecord>();
  private jobInfo: JobInfo;
  private description: string | null = null;
  private busy = false;
  private observer?: MutationObserver;
  private aiNote?: string;
  private resumeFile: File | null;
  private coverLetterFile: File | null;
  private transcriptFile: File | null;

  constructor(
    private doc: Document,
    private adapter: Adapter,
    private deps: EngineDeps,
  ) {
    this.jobInfo = adapter.jobInfo(doc);
    this.resumeFile = deps.context.resume ? payloadToFile(deps.context.resume) : null;
    this.coverLetterFile = deps.context.coverLetter ? payloadToFile(deps.context.coverLetter) : null;
    this.transcriptFile = deps.context.transcript ? payloadToFile(deps.context.transcript) : null;
  }

  get info(): JobInfo {
    return this.jobInfo;
  }

  private root(): ParentNode {
    return this.adapter.formRoot(this.doc);
  }

  /** Runs the full pipeline once: scan, classify, fill, free responses, verify. */
  async run(): Promise<FillSummary> {
    await this.processNew();
    // Answering one question can reveal another (race after Hispanic/Latino). Those appear while the
    // pass runs, before observe() starts, so keep scanning until a pass finds nothing new.
    for (let round = 0; round < 5; round++) {
      await sleep(timing.settle);
      if (!(await this.processNew())) break;
    }
    return this.verify();
  }

  /** Watches for conditional follow-up questions, user edits, and (multi-step forms) the next step. */
  observe() {
    // A multi-step form swaps its whole form between steps, so watch the page instead.
    const root = (this.adapter.multiStep ? this.doc.body : this.root()) as Node;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rescan = () => {
      clearTimeout(timer);
      if (this.stopped) return;
      timer = setTimeout(async () => {
        if (this.stopped) return;
        if (this.busy) return rescan();
        const added = await this.processNew();
        if (added) this.deps.onProgress?.(this.verify());
      }, 700);
    };
    this.observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((m) =>
        Array.from(m.addedNodes).some((n) => n.nodeType === 1 && !(n as Element).closest('[data-jaf]')),
      );
      if (relevant) rescan();
    });
    this.observer.observe(root, { childList: true, subtree: true });

    let editTimer: ReturnType<typeof setTimeout> | undefined;
    const onEdit = () => {
      clearTimeout(editTimer);
      editTimer = setTimeout(() => {
        if (!this.busy) this.deps.onProgress?.(this.verify());
      }, 1200);
    };
    root.addEventListener('change', onEdit, true);
    root.addEventListener('input', onEdit, true);
    root.addEventListener('click', onEdit, true);
    this.stopWatching = () => {
      clearTimeout(timer);
      clearTimeout(editTimer);
      root.removeEventListener('change', onEdit, true);
      root.removeEventListener('input', onEdit, true);
      root.removeEventListener('click', onEdit, true);
    };
  }

  /** Stops watching for good: a rescan already scheduled does not run, so a newer session has the page to itself. */
  disconnect() {
    this.stopped = true;
    this.observer?.disconnect();
    this.stopWatching?.();
  }

  private stopped = false;
  /** Repeatable sections already given their entries in this session. */
  private expanded = new WeakSet<Element>();
  private stopWatching?: () => void;

  /** Polls until new fields show up or the time runs out. */
  private async waitForFresh(maxMs: number): Promise<FieldRecord[]> {
    const step = Math.min(150, maxMs);
    for (let waited = 0; ; waited += step) {
      await sleep(step);
      const found = this.collectFresh();
      if (found.length || waited + step >= maxMs) return found;
    }
  }

  /** Registers fields that appeared since the last scan, in document order. */
  private collectFresh(): FieldRecord[] {
    const fresh: FieldRecord[] = [];
    if (this.stopped) return fresh;
    const fields = scanFields(this.root());
    // Sign-in pages are left alone; the form after them is new and gets filled then.
    if (isSignInPage(this.root(), fields)) return fresh;
    for (const field of fields) {
      if (this.records.has(field.el)) continue;
      const rec: FieldRecord = { field, cls: classifyField(field, this.adapter.keys) };
      if (rec.cls.kind !== 'profile') console.info(`[Job Autofill] "${field.label.slice(0, 60) || '(no label)'}" (${field.kind}): ${rec.cls.kind}`);
      this.records.set(field.el, rec);
      fresh.push(rec);
    }
    return fresh;
  }

  /** Fills fields not seen before. Returns how many new fields were found. */
  async processNew(): Promise<number> {
    if (this.busy || this.stopped) return 0;
    this.busy = true;
    try {
      // Add one work-experience / education entry per profile entry before reading the fields.
      await this.adapter.prepare?.(this.root(), this.deps.context.profile, this.expanded).catch((err) => console.warn('[Job Autofill] could not add entries', err));
      const fresh = this.collectFresh();
      if (!fresh.length) return 0;

      // Questions no rule recognised are matched (from their wording) before filling starts, so the pass
      // below can go strictly top to bottom.
      await this.mapUnknown(fresh);

      const watcher = this.watchForCleared();
      // Walk the form top to bottom, uploads and AI-written answers included, never going back up. A question
      // revealed by an answer (race after Hispanic/Latino) is slotted in right after the field that revealed it.
      let added = false;
      const grow = new MutationObserver((mutations) => {
        if (mutations.some((m) => Array.from(m.addedNodes).some((n) => n.nodeType === 1 && !(n as Element).closest('[data-jaf]')))) {
          added = true;
        }
      });
      grow.observe(this.root() as Node, { childList: true, subtree: true });
      const queue = [...fresh].sort(byDocumentOrder);
      try {
        for (let i = 0; i < queue.length; i++) {
          // A disconnected session (a newer Fill, or the page moved on) stops mid-pass.
          if (this.stopped) break;
          const rec = queue[i]!;
          added = false;
          await this.fillRecord(rec);
          const reveals = REVEALS_RE.test(rec.field.label);
          if (!added && !reveals) continue;
          // The follow-up can render a beat after the answer lands, so a known reveal question is
          // polled before moving on; other DOM changes get one short settle.
          const more = await this.waitForFresh(reveals ? timing.reveal : timing.settle);
          if (!more.length) continue;
          await this.mapUnknown(more);
          fresh.push(...more);
          // Fields that appeared above the current one (a page re-render) are not gone back for.
          // (When the page changed under the current field, everything new is below it.)
          const below = rec.field.el.isConnected ? more.filter((r) => byDocumentOrder(rec, r) < 0) : more;
          const rest = [...queue.slice(i + 1), ...below].sort(byDocumentOrder);
          queue.length = i + 1;
          queue.push(...rest);
        }
      } finally {
        grow.disconnect();
      }
      // Some forms reset a dropdown when a later field is touched; put back any that went blank.
      this.traceDropdowns('before restore');
      await this.restoreDropdowns(fresh);
      this.traceDropdowns('end of pass');
      watcher.disconnect();
      await this.closeOpenDropdowns();
      return fresh.length;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Questions no rule recognised: AI picks which saved profile fact answers each (or none), and the value
   * itself still comes from the profile. Only labels and option texts are sent, never profile values.
   */
  private async mapUnknown(records: FieldRecord[]) {
    if (!this.deps.mapFields || !this.deps.context.hasGeminiKey) return;
    const pending = records.filter(
      (r) => r.cls.kind === 'unknown' && r.cls.askAi && r.field.el.isConnected && r.field.kind !== 'file' && !fieldHasValue(r.field),
    );
    if (!pending.length) return;
    const res = await this.deps
      .mapFields(
        pending.map((r) => ({
          label: r.field.label.slice(0, 300),
          kind: r.field.kind,
          options: r.field.options.filter((o) => !isPlaceholderOption(o)).slice(0, 30).map((o) => o.slice(0, 120)),
          section: r.field.section?.kind === 'website' ? undefined : r.field.section?.kind,
        })),
      )
      .catch((err) => ({ ok: false as const, error: String(err) }));
    if (!res.ok) {
      console.warn('[Job Autofill] AI field matching skipped:', res.error);
      return;
    }
    for (const [i, rec] of pending.entries()) {
      const key = res.keys[i];
      if (!key || !AI_MAPPABLE_KEYS.has(key as ProfileKey)) continue;
      const index = rec.field.section?.index;
      rec.cls = { kind: 'profile', key: key as ProfileKey, source: 'ai', ...(index !== undefined ? { index } : {}) };
    }
  }

  /** Fills one field of the top-to-bottom pass, whatever kind of answer it takes. */
  private async fillRecord(rec: FieldRecord) {
    if (rec.cls.kind === 'free_response') return this.fillFreeResponse(rec);
    if (rec.cls.kind !== 'profile') return;
    const before = openLists(this.doc);
    await this.fillProfileField(rec);
    // Whatever the outcome, leave no list open and the field unfocused before moving on.
    if (rec.field.el.isConnected) await closeListsOpenedBy(rec.field, before);
    if (rec.outcome !== 'filled') return;
    if (rec.cls.source === 'ai') {
      rec.ai = true;
      outline(rec.field.outlineTarget, 'ai');
    }
    // Some sites read an uploaded resume and prefill the fields below it; let that finish first.
    if (rec.field.kind === 'file') await sleep(this.adapter.platform === 'greenhouse' ? 300 : timing.afterUpload);
  }

  /** Leaves every dropdown closed; a question we could not answer is flagged red instead of left open. */
  private async closeOpenDropdowns() {
    const inputs = [...this.records.values()]
      .filter((r) => (r.field.kind === 'combobox' || r.field.kind === 'listbox') && r.field.el.isConnected)
      .map((r) => r.field.el);
    for (let round = 0; round < 2; round++) {
      for (const el of inputs) closeIfOpen(el);
      await sleep(timing.settle);
    }
  }

  /** Field being filled right now, named in the warning when an earlier answer disappears. */
  private activeLabel = '';

  /** Logs (labels only, never values) when a chosen dropdown answer is removed from the page mid-fill. */
  private watchForCleared(): MutationObserver {
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of Array.from(m.removedNodes)) {
          if (n.nodeType === 1 && /single-?value/i.test((n as Element).className?.toString?.() ?? '')) {
            console.warn(`[Job Autofill] a dropdown answer was cleared while filling "${this.activeLabel}"`);
          }
        }
      }
    });
    obs.observe(this.root() as Node, { childList: true, subtree: true });
    return obs;
  }

  private async restoreDropdowns(records: FieldRecord[]) {
    for (let round = 0; round < 3; round++) {
      const lost = records.filter(
        (r) => r.field.kind === 'combobox' && r.outcome === 'filled' && r.field.el.isConnected && !comboboxHasValue(r.field),
      );
      if (!lost.length) return;
      console.warn(`[Job Autofill] re-filling ${lost.length} dropdown(s) that went blank (round ${round + 1})`);
      for (const rec of lost) {
        rec.outcome = undefined;
        await this.fillProfileField(rec);
      }
      await sleep(timing.settle);
    }
  }

  private async fillProfileField(rec: FieldRecord) {
    if (rec.cls.kind !== 'profile') return;
    const { field } = rec;
    this.activeLabel = field.label;
    const key = rec.cls.key;
    const profile = this.deps.context.profile;
    try {
      if (key === 'resume' || key === 'coverLetter' || key === 'transcript') {
        const file = key === 'resume' ? this.resumeFile : key === 'coverLetter' ? this.coverLetterFile : this.transcriptFile;
        rec.outcome = field.kind === 'file' && file ? fillFile(field, file) : 'nomatch';
        return;
      }
      const hasCodeField = [...this.records.values()].some((r) => r.cls.kind === 'profile' && r.cls.key === 'phoneCountryCode');
      // react-select style dropdowns expose no options up front, so a question-shaped label stands in.
      const yesNo = isYesNo(field.options) || (!field.options.length && field.kind !== 'text' && QUESTION_RE.test(field.label.trim()));
      // Salary answers follow the pay range posted in the job description when there is one.
      if (key === 'salary') await this.loadDescription();
      const values = valueFor(key, profile, {
        description: key === 'salary' ? (this.description ?? '') : undefined,
        phoneWithCode: !hasCodeField && WITH_CODE_RE.test(field.label.toLowerCase()),
        yesNo: (key === 'workMode' || key === 'clearance') && yesNo,
        label: field.label,
        required: field.required,
        options: field.options,
        index: rec.cls.index,
        company: this.jobInfo.company,
      });
      const topOption = TOP_OPTION_KEYS.has(key);
      const choice: ChoiceOpts = {
        topOption,
        degree: key === 'degree',
        // "University of California" is not "University of California, Santa Cruz".
        strict: STRICT_KEYS.has(key),
        acceptFirstResult: SEARCH_FIRST_RESULT_KEYS.has(key),
      };
      if (key === 'locationPreference') {
        // Ranked office choices: never repeat an earlier preference; see pickLocationPreference.
        const rank = preferenceRank(field.label);
        const chosen = [...this.records.values()]
          .filter((r) => r !== rec && r.cls.kind === 'profile' && r.cls.key === 'locationPreference' && r.field.el.isConnected)
          .map((r) => displayedValue(r.field))
          .filter(Boolean);
        choice.pick = (options) => pickLocationPreference(options, profile, rank, chosen);
        choice.topOption = false;
      }
      // Skill pickers (Workday "Type to Add Skills"): add each saved skill as its own chip.
      if (key === 'skills' && field.kind === 'prompt') {
        let added = 0;
        for (const [i, skill] of profile.skills.slice(0, 15).entries()) {
          const out = await fillPrompt(field, [skill], { allowMore: i > 0, strict: true });
          if (i === 0 && out === 'already') {
            added = -1;
            break;
          }
          if (out === 'filled') added++;
        }
        rec.outcome = added < 0 ? 'already' : added ? 'filled' : 'nomatch';
        if (rec.outcome === 'filled') outline(field.outlineTarget, 'filled');
        console.info(`[Job Autofill] "${field.label.slice(0, 60)}" (prompt) as skills: ${added > 0 ? `${added} added` : rec.outcome}`);
        return;
      }
      // "Select all that apply" race lists get every saved race; single-choice ones get one answer.
      if (key === 'race' && (field.kind === 'checkboxGroup' || field.kind === 'prompt')) {
        const answers = raceChoices(profile);
        if (field.kind === 'checkboxGroup') rec.outcome = fillCheckboxes(field, answers);
        else {
          // Add each race as its own chip; stop if the list was already answered before we started.
          let added = false;
          for (const [i, a] of answers.entries()) {
            const out = await fillPrompt(field, a, { allowMore: i > 0 });
            if (i === 0 && out === 'already') {
              rec.outcome = 'already';
              break;
            }
            added ||= out === 'filled';
          }
          rec.outcome ??= added ? 'filled' : 'nomatch';
        }
        if (rec.outcome === 'filled') outline(field.outlineTarget, 'filled');
        console.info(`[Job Autofill] "${field.label.slice(0, 60)}" (${field.kind}) as race: ${rec.outcome}`);
        return;
      }
      // A multiple-choice list of arrangements: "Flexible" ticks every one.
      if (key === 'workMode' && field.kind === 'checkboxGroup' && profile.preferences.workMode === 'flexible') {
        const boxes = field.members as HTMLInputElement[];
        for (const b of boxes) if (!b.checked) clickSafely(b);
        rec.outcome = boxes.some((b) => b.checked) ? 'filled' : 'failed';
        if (rec.outcome === 'filled') outline(field.outlineTarget, 'filled');
        return;
      }
      const first = values?.[0];
      if (!values || !first) {
        // The site's resume parser may have prefilled an employer the profile says is blank; clear it.
        if (key === 'currentCompany' && field.kind === 'text' && !profile.currentCompany.trim()) {
          keepBlank(field.el as HTMLInputElement);
        }
        rec.outcome = 'nomatch';
        return;
      }
      switch (field.kind) {
        case 'text': {
          const input = field.el as HTMLInputElement;
          if (input.type === 'date' || input.type === 'month') {
            const iso = values.find((v) => (input.type === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/).test(v));
            rec.outcome = iso ? fillText(field, iso) : 'nomatch';
            break;
          }
          const isTypeahead =
            key === 'location' &&
            (this.adapter.platform === 'lever' || /location/i.test((field.el as HTMLElement).className));
          // A number box rejects "$115,000" or "June"; give it digits ("06" for a month box).
          const numeric =
            input.type === 'number' ||
            input.getAttribute('role') === 'spinbutton' ||
            input.inputMode === 'numeric' ||
            /^dateSection/.test(input.getAttribute('data-automation-id') ?? '');
          const typed = numeric ? (values.find((v) => /^\d+$/.test(v)) ?? first.replace(/[^\d.]/g, '')) : first;
          rec.outcome = isTypeahead ? await fillTypeahead(field, values) : fillText(field, typed);
          break;
        }
        case 'textarea':
          rec.outcome = fillText(field, first);
          break;
        case 'select':
          rec.outcome = fillSelect(field, values, choice);
          break;
        case 'combobox':
          rec.outcome = await fillCombobox(field, values, choice);
          break;
        case 'listbox':
          rec.outcome = await fillListbox(field, values, choice);
          break;
        case 'prompt':
          rec.outcome = await fillPrompt(field, values, choice);
          break;
        case 'radio':
          rec.outcome = fillRadio(field, values, choice);
          break;
        case 'checkbox':
          rec.outcome = fillCheckbox(field, values);
          break;
        case 'checkboxGroup':
          rec.outcome = fillCheckboxGroup(field, values);
          break;
        case 'yesno':
          rec.outcome = fillYesNo(field, values);
          break;
        default:
          rec.outcome = 'nomatch';
      }
    } catch (err) {
      console.warn('[Job Autofill] could not fill', field.label, err);
      rec.outcome = 'failed';
    }
    if (rec.outcome === 'filled') outline(field.outlineTarget, 'filled');
    console.info(`[Job Autofill] "${field.label.slice(0, 60)}" (${field.kind}) as ${key}: ${rec.outcome}`);
    if (field.kind === 'combobox') this.traceDropdowns(`after "${field.label.slice(0, 50)}" (${rec.outcome})`);
  }

  /** One console line listing which dropdowns currently show an answer (labels only, never values). */
  private traceDropdowns(when: string) {
    const state = [...this.records.values()]
      .filter((r) => r.field.kind === 'combobox' && r.field.el.isConnected)
      .map((r) => `${r.field.label.slice(0, 28)}=${comboboxHasValue(r.field) ? 'set' : 'EMPTY'}`);
    console.debug(`[Job Autofill] ${when}: ${state.join(' | ')}`);
  }

  private async fillFreeResponse(rec: FieldRecord) {
    const { field } = rec;
    if (fieldHasValue(field)) {
      rec.outcome = 'already';
      return;
    }
    if (!this.deps.context.hasGeminiKey) {
      rec.flag = true;
      this.aiNote = 'Add a Gemini API key in settings to have free responses written for you.';
      return;
    }
    outline(field.outlineTarget, 'pending');
    await this.loadDescription();
    const res = await this.deps.answer({
      question: field.label,
      characterLimit: characterLimitFor(field.label, field.maxLength),
      company: this.jobInfo.company,
      role: this.jobInfo.role,
      jobDescription: this.description ?? '',
    });
    if (!res.ok) {
      rec.flag = true;
      this.aiNote = res.error;
      clearOutline(field.outlineTarget);
      return;
    }
    rec.outcome = fillText(field, res.answer);
    if (rec.outcome === 'filled') {
      rec.ai = true;
      outline(field.outlineTarget, 'ai');
    } else {
      rec.flag = true;
    }
  }

  private async loadDescription() {
    if (this.description !== null) return;
    // Multi-step forms move on from the posting; read it again in case this step shows it.
    if (!this.jobInfo.description && this.adapter.multiStep) this.jobInfo = { ...this.adapter.jobInfo(this.doc), ...pickKnown(this.jobInfo) };
    this.description = this.jobInfo.description || (await this.deps.jobDescription(this.jobInfo).catch(() => ''));
  }

  /** Re-reads every field, sets outlines, and returns the counts shown to the user. */
  verify(): FillSummary {
    let filledCount = 0;
    let aiAnswers = 0;
    const missingLabels: string[] = [];
    for (const [el, rec] of this.records) {
      if (!el.isConnected) {
        this.records.delete(el);
        continue;
      }
      const { field } = rec;
      const weFilled = rec.outcome === 'filled';
      // Yes/No buttons and file inputs do not always expose their state; trust our own fill there.
      const has = fieldHasValue(field) || (weFilled && (field.kind === 'yesno' || field.kind === 'file'));
      let state: ReviewState | null = null;
      if (rec.ai && has) state = 'ai';
      else if (weFilled && has) state = 'filled';
      else if (!has && (field.required || rec.flag)) state = 'missing';

      if (state === 'ai') aiAnswers++;
      if (state === 'filled') filledCount++;
      if (state === 'missing') missingLabels.push(labelFor(field));

      if (state) outline(field.outlineTarget, state);
      else if (field.outlineTarget.hasAttribute('data-jaf-state')) clearOutline(field.outlineTarget);
    }
    return { filledCount, aiAnswers, missingLabels, aiNote: this.aiNote };
  }
}

function labelFor(field: ScannedField): string {
  const text = field.label || field.name || 'Unlabeled field';
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

/** Company and role already read, so a later re-read only adds the description. */
function pickKnown(info: JobInfo): Partial<JobInfo> {
  return Object.fromEntries(Object.entries(info).filter(([, v]) => v)) as Partial<JobInfo>;
}

/** True when the page shows an application form (not a sign-in page or a page with a search box). */
export function formReady(doc: Document, adapter: Adapter): boolean {
  const root = adapter.formRoot(doc);
  const fields = scanFields(root).filter((f) => f.kind !== 'yesno');
  if (fields.length < 2 || isSignInPage(root, fields)) return false;
  if (!adapter.minProfileFields) return true;
  const known = fields.filter((f) => classifyField(f, adapter.keys).kind === 'profile').length;
  return known >= adapter.minProfileFields;
}

/** Waits for a client-rendered form (Ashby) or the next step of a multi-step application to appear. */
export async function waitForForm(doc: Document, adapter: Adapter, timeout = 15000): Promise<boolean> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (formReady(doc, adapter)) return true;
    await sleep(timeout > 60000 ? 1000 : 300);
  }
  return false;
}

/** Keys whose list answers must contain every distinctive word of the saved value. */
const STRICT_KEYS = new Set<ProfileKey>(['school', 'major']);

/** 1 for "first location preference", 2 for "second ...", and so on. */
function preferenceRank(label: string): number {
  const l = label.toLowerCase();
  if (/\b(second|2nd)\b/.test(l)) return 2;
  if (/\b(third|3rd)\b/.test(l)) return 3;
  if (/\b(fourth|4th)\b/.test(l)) return 4;
  return 1;
}

const QUESTION_RE = /^(are|is|will|would|do|does|can|could|have|did)\b/i;

/** True when the choices are just Yes and No ("Are you open to remote work?"). */
function isYesNo(options: string[]): boolean {
  const real = options.filter((o) => !isPlaceholderOption(o));
  return real.length > 0 && real.length <= 3 && real.every((o) => /^(yes|no)\b/i.test(o.trim()));
}

/**
 * Keeps an optional box empty while the site's resume parser may still be prefilling it. Parsing can finish
 * seconds after the upload, so check for a while; stop as soon as the person types or focuses the box.
 */
function keepBlank(input: HTMLInputElement, ms = 20000) {
  let touched = false;
  const stop = () => {
    touched = true;
  };
  input.addEventListener('keydown', stop, { once: true });
  input.addEventListener('focus', stop, { once: true });
  const clear = () => {
    if (!touched && input.isConnected && input.value.trim()) setNativeValue(input, '');
  };
  clear();
  const timer = setInterval(clear, 300);
  setTimeout(() => clearInterval(timer), ms);
}
