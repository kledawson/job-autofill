import type { AnswerRequest, FillContext, Result } from '../messages';
import { payloadToFile } from '../messages';
import type { Adapter, JobInfo } from './adapters';
import { classifyField, type Classification } from './classify';
import {
  fieldHasValue,
  fillCheckboxGroup,
  fillCombobox,
  fillFile,
  fillRadio,
  fillSelect,
  fillText,
  fillTypeahead,
  fillYesNo,
  sleep,
  timing,
  type FillOutcome,
} from './fill';
import { clearOutline, outline, type ReviewState } from './highlight';
import { characterLimitFor } from './match';
import { scanFields, type ScannedField } from './scan';
import { WITH_CODE_RE } from './classify';
import { SEARCH_FIRST_RESULT_KEYS, valueFor } from './values';

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

  /** Fills fields not seen before. Returns how many new fields were found. */
  async processNew(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const fresh: FieldRecord[] = [];
      for (const field of scanFields(this.root())) {
        if (this.records.has(field.el)) continue;
        const rec: FieldRecord = { field, cls: classifyField(field, this.adapter.keys) };
        this.records.set(field.el, rec);
        fresh.push(rec);
      }
      if (!fresh.length) return 0;

      // Resume first: some sites (Ashby, Lever) parse it and prefill fields, and we only fill empty ones.
      const files = fresh.filter((r) => r.field.kind === 'file');
      for (const rec of files) await this.fillProfileField(rec);
      if (files.some((r) => r.outcome === 'filled')) await sleep(this.adapter.platform === 'greenhouse' ? 300 : timing.afterUpload);

      for (const rec of fresh) {
        if (rec.field.kind !== 'file') await this.fillProfileField(rec);
      }
      for (const rec of fresh) {
        if (rec.cls.kind === 'free_response') await this.fillFreeResponse(rec);
      }
      return fresh.length;
    } finally {
      this.busy = false;
    }
  }

  private async fillProfileField(rec: FieldRecord) {
    if (rec.cls.kind !== 'profile') return;
    const { field } = rec;
    const key = rec.cls.key;
    const profile = this.deps.context.profile;
    try {
      if (key === 'resume' || key === 'coverLetter' || key === 'transcript') {
        const file = key === 'resume' ? this.resumeFile : key === 'coverLetter' ? this.coverLetterFile : this.transcriptFile;
        rec.outcome = field.kind === 'file' && file ? fillFile(field, file) : 'nomatch';
        return;
      }
      const values = valueFor(key, profile, { phoneWithCode: WITH_CODE_RE.test(field.label.toLowerCase()) });
      const first = values?.[0];
      if (!values || !first) {
        rec.outcome = 'nomatch';
        return;
      }
      switch (field.kind) {
        case 'text': {
          const isTypeahead =
            key === 'location' &&
            (this.adapter.platform === 'lever' || /location/i.test((field.el as HTMLElement).className));
          rec.outcome = isTypeahead ? await fillTypeahead(field, values) : fillText(field, first);
          break;
        }
        case 'textarea':
          rec.outcome = fillText(field, first);
          break;
        case 'select':
          rec.outcome = fillSelect(field, values);
          break;
        case 'combobox':
          rec.outcome = await fillCombobox(field, values, { acceptFirstResult: SEARCH_FIRST_RESULT_KEYS.has(key) });
          break;
        case 'radio':
          rec.outcome = fillRadio(field, values);
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
