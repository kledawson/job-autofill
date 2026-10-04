import type { AnswerRequest, FillContext, Result } from '../messages';
import { payloadToFile } from '../messages';
import type { Adapter, JobInfo } from './adapters';
import { classifyField, type Classification } from './classify';
import {
  clickSafely,
  comboboxHasValue,
  fieldHasValue,
  fillCheckboxGroup,
  fillCombobox,
  fillFile,
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
import { scanFields, type ScannedField } from './scan';
import { WITH_CODE_RE } from './classify';
import { SEARCH_FIRST_RESULT_KEYS, TOP_OPTION_KEYS, valueFor } from './values';
import { isPlaceholderOption } from './match';

export interface EngineDeps {
  context: FillContext;
  answer(req: AnswerRequest): Promise<Result<{ answer: string }>>;
  jobDescription(info: JobInfo): Promise<string>;
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
  const pos = a.field.el.compareDocumentPosition(b.field.el);
  return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : pos & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
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

  /** Watches for conditional follow-up questions and user edits. */
  observe() {
    const root = this.root() as Node;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rescan = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
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
  }

  disconnect() {
    this.observer?.disconnect();
  }

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
    for (const field of scanFields(this.root())) {
      if (this.records.has(field.el)) continue;
      const rec: FieldRecord = { field, cls: classifyField(field, this.adapter.keys) };
      this.records.set(field.el, rec);
      fresh.push(rec);
    }
    return fresh;
  }

  /** Fills fields not seen before. Returns how many new fields were found. */
  async processNew(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const fresh = this.collectFresh();
      if (!fresh.length) return 0;

      // Resume first: some sites (Ashby, Lever) parse it and prefill fields, and we only fill empty ones.
      const files = fresh.filter((r) => r.field.kind === 'file');
      for (const rec of files) await this.fillProfileField(rec);
      if (files.some((r) => r.outcome === 'filled')) await sleep(this.adapter.platform === 'greenhouse' ? 300 : timing.afterUpload);

      const watcher = this.watchForCleared();
      // Walk the form top to bottom. A question revealed by an answer (race after Hispanic/Latino) is
      // slotted in right after the field that revealed it, so it is filled before moving further down.
      let added = false;
      const grow = new MutationObserver((mutations) => {
        if (mutations.some((m) => Array.from(m.addedNodes).some((n) => n.nodeType === 1 && !(n as Element).closest('[data-jaf]')))) {
          added = true;
        }
      });
      grow.observe(this.root() as Node, { childList: true, subtree: true });
      const queue = fresh.filter((r) => r.field.kind !== 'file');
      try {
        for (let i = 0; i < queue.length; i++) {
          const rec = queue[i]!;
          added = false;
          await this.fillProfileField(rec);
          const reveals = REVEALS_RE.test(rec.field.label);
          if (!added && !reveals) continue;
          // The follow-up can render a beat after the answer lands, so a known reveal question is
          // polled before moving on; other DOM changes get one short settle.
          const more = await this.waitForFresh(reveals ? timing.reveal : timing.settle);
          if (!more.length) continue;
          fresh.push(...more);
          const rest = [...queue.slice(i + 1), ...more.filter((r) => r.field.kind !== 'file')].sort(byDocumentOrder);
          queue.length = i + 1;
          queue.push(...rest);
          for (const r of more) if (r.field.kind === 'file') await this.fillProfileField(r);
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
      for (const rec of fresh) {
        if (rec.cls.kind === 'free_response') await this.fillFreeResponse(rec);
      }
      return fresh.length;
    } finally {
      this.busy = false;
    }
  }

  /** Leaves every dropdown closed; a question we could not answer is flagged red instead of left open. */
  private async closeOpenDropdowns() {
    const inputs = [...this.records.values()].filter((r) => r.field.kind === 'combobox' && r.field.el.isConnected).map((r) => r.field.el);
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
      if (key === 'salary' && this.description === null) {
        this.description = this.jobInfo.description || (await this.deps.jobDescription(this.jobInfo).catch(() => ''));
      }
      const values = valueFor(key, profile, {
        description: key === 'salary' ? (this.description ?? '') : undefined,
        phoneWithCode: !hasCodeField && WITH_CODE_RE.test(field.label.toLowerCase()),
        yesNo: (key === 'workMode' || key === 'clearance') && yesNo,
        label: field.label,
        required: field.required,
        options: field.options,
      });
      const topOption = TOP_OPTION_KEYS.has(key);
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
          if ((field.el as HTMLInputElement).type === 'date') {
            const iso = values.find((v) => /^\d{4}-\d{2}-\d{2}$/.test(v));
            rec.outcome = iso ? fillText(field, iso) : 'nomatch';
            break;
          }
          const isTypeahead =
            key === 'location' &&
            (this.adapter.platform === 'lever' || /location/i.test((field.el as HTMLElement).className));
          // A number box rejects "$115,000"; give it just the digits.
          const typed = (field.el as HTMLInputElement).type === 'number' ? first.replace(/[^\d.]/g, '') : first;
          rec.outcome = isTypeahead ? await fillTypeahead(field, values) : fillText(field, typed);
          break;
        }
        case 'textarea':
          rec.outcome = fillText(field, first);
          break;
        case 'select':
          rec.outcome = fillSelect(field, values, { topOption, degree: key === 'degree' });
          break;
        case 'combobox':
          rec.outcome = await fillCombobox(field, values, { acceptFirstResult: SEARCH_FIRST_RESULT_KEYS.has(key), topOption, degree: key === 'degree' });
          break;
        case 'radio':
          rec.outcome = fillRadio(field, values, { degree: key === 'degree' });
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
    if (this.description === null) {
      this.description = this.jobInfo.description || (await this.deps.jobDescription(this.jobInfo).catch(() => ''));
    }
    const res = await this.deps.answer({
      question: field.label,
      characterLimit: characterLimitFor(field.label, field.maxLength),
      company: this.jobInfo.company,
      role: this.jobInfo.role,
      jobDescription: this.description,
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

/** Waits for a client-rendered form (Ashby) to appear. */
export async function waitForForm(doc: Document, adapter: Adapter, timeout = 15000): Promise<boolean> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (scanFields(adapter.formRoot(doc)).filter((f) => f.kind !== 'yesno').length >= 2) return true;
    await sleep(300);
  }
  return false;
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
