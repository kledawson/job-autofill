import { preparedResponse } from '../presets';
import type { AnswerRequest, FieldQuestion, FillContext, Result } from '../messages';
import { AI_MAPPABLE_KEYS } from '../field-map';
import { payloadToFile } from '../messages';
import type { Adapter, JobInfo } from './adapters';
import { readJobDetails, type JobDetails } from '../job-details';
import { classifyField, type Classification, type ProfileKey } from './classify';
import {
  clickSafely,
  comboboxHasValue,
  comboboxSelectedValues,
  fieldHasValue,
  fillCheckboxGroup,
  fillCheckboxes,
  displayedValue,
  openLists,
  closeListsOpenedBy,
  type ChoiceOpts,
  fillCombobox,
  bindWriterSignal,
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
  uploadedAlready,
  fillYesNo,
  yesNoExposesState,
  yesNoSelected,
  yesNoTook,
  sleep,
  timing,
  type FillOutcome,
} from './fill';
import { clearOutline, outline, revealField, type ReviewState } from './highlight';
import { feedbackPriority, type FieldFeedback } from '../field-feedback';
import { bestGpaOption, characterLimitFor } from './match';
import { clampToLimit } from '../prompt';
import { findPostingLink } from '../posting-link';
import { composedCompare, isHidden, isSignInPage, scanFields, type ScannedField } from './scan';
import { WITH_CODE_RE, isEmployerContact } from './classify';
import { applicantLocationQueries, pickApplicantLocation, pickLocationPreference, raceChoices, valueFor } from './values';
import { isPlaceholderOption } from './match';
import { parseSelections, resolveRememberedMapping, type RememberedMapping, type SavedField, type SavedMatch, type ReviewField, type CapturedAnswer } from '../remembered-mappings';
import { rememberedChoice } from '../saved-answer-preview';
import { fillRememberedSelections, reacquireSelectionField, selectedValues, selectionMode } from './selections';
import { sameSelections } from '../selection-matching';

export interface EngineDeps {
  context: FillContext;
  onPhase?(phase: string): void;
  answer(req: AnswerRequest): Promise<Result<{ answer: string }>>;
  jobDescription(info: JobInfo): Promise<string>;
  /** Location and work model for postings whose page doesn't show them. Optional. */
  jobDetails?(remote: NonNullable<JobInfo['remote']>): Promise<JobDetails>;
  /** Asks AI which profile fact (if any) answers each question no rule recognised. Optional. */
  mapFields?(fields: FieldQuestion[]): Promise<Result<{ keys: (string | null)[] }>>;
  rememberedMappings?(questions: string[]): Promise<RememberedMapping[]>;
  matchSavedAnswers?(fields: SavedField[]): Promise<SavedMatch[]>;
  /** Called whenever counts change (initial fill, conditional fields, user edits). */
  onProgress?(summary: FillSummary): void;
}

export interface FillSummary {
  filledCount: number;
  aiAnswers: number;
  missingLabels: string[];
  missingQuestions: (string | null)[];
  reviewFields?: ReviewField[];
  fieldFeedback?: FieldFeedback[];
  memoryQuestions?: string[];
  usedMappingIds?: number[];
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
  token?: string;
  review?: boolean;
  saved?: RememberedMapping;
  suggestionId?: number;
  selectionLabels?: string[];
  selectionReason?: string;
  /** Local read-back only; never sent to the worker or persisted. */
  writtenValue?: string;
}

/** Questions whose answer is known to reveal a follow-up directly beneath them. */
const REVEALS_RE = /hispanic|latino/i;

function fieldSignature(f: FieldRecord['field']): string {
  return [f.kind, f.label, f.path, f.section?.kind ?? '', f.section?.index ?? ''].join('|');
}

function byDocumentOrder(a: FieldRecord, b: FieldRecord): number {
  return composedCompare(a.field.el, b.field.el);
}

const LINK_KEYS = new Set<string>(['linkedin', 'github', 'portfolio', 'website']);

export class FillSession {
  get processing() { return this.busy; }
  private idleWaiters = new Set<() => void>();
  /** Observed conditional-field fills can run after the initial content task has ended. */
  whenIdle(): Promise<void> {
    return this.busy ? new Promise(resolve => this.idleWaiters.add(resolve)) : Promise.resolve();
  }
  private markIdle() {
    this.busy = false;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
  private records = new Map<HTMLElement, FieldRecord>();
  private jobInfo: JobInfo;
  private description: string | null = null;
  private details: JobDetails = { location: '', workMode: '', pay: '' };
  private detailsFetched = false;
  private busy = false;
  private observer?: MutationObserver;
  private stopWatching?: () => void;
  private blanking = new AbortController();
  private aiNote?: string;
  private resumeFile: File | null;
  private coverLetterFile: File | null;
  private transcriptFile: File | null;
  private captures = new Map<string, { rec: FieldRecord; value: string; question: string; values: string[]; members: HTMLElement[]; mode: import('../remembered-mappings').SelectionMode }>();

  constructor(
    private doc: Document,
    private adapter: Adapter,
    private deps: EngineDeps,
  ) {
    bindWriterSignal(doc, this.blanking.signal);
    this.jobInfo = adapter.jobInfo(doc);
    this.resumeFile = deps.context.resume ? payloadToFile(deps.context.resume) : null;
    this.coverLetterFile = deps.context.coverLetter ? payloadToFile(deps.context.coverLetter) : null;
    this.transcriptFile = deps.context.transcript ? payloadToFile(deps.context.transcript) : null;
  }

  get info(): JobInfo {
    return this.jobInfo;
  }
  get knownDetails(): JobDetails { return this.details; }
  showField(token: string, question: string) {
    // Locating a known question is read-only and must remain available during a fill.
    if (this.stopped) throw new Error('This fill has stopped. Refresh the review results before locating a field.');
    const rec = [...this.records.values()].find(r => r.token === token);
    const field = rec && this.relocate(rec);
    if (!field || !labelMatches(field, question) || isHidden(field.el)) throw new Error('This field changed or is hidden. Click Fill this page to refresh the results.');
    rec!.field = { ...field, label: rec!.field.label };
    revealField(field.outlineTarget, field.el);
  }
  summary(): FillSummary { return this.verify(); }
  /** Called only after the old writer has stopped; keep capture/edits live without more writes. */
  enterReview(): FillSummary {
    if (this.busy) throw new Error('Wait for the current widget writer to stop before entering review.');
    this.stopped = false;
    this.blanking = new AbortController();
    bindWriterSignal(this.doc, this.blanking.signal);
    this.collectFresh(true);
    this.observe(false);
    return this.verify();
  }

  /** Where the job is, whether it is remote, and its pay. Keeps what an earlier step found when a later page shows less. */
  async jobDetails(): Promise<JobDetails> {
    const merge = (next: Partial<JobDetails>) => {
      this.details = {
        location: next.location || this.details.location,
        workMode: next.workMode || this.details.workMode,
        pay: next.pay || this.details.pay,
      };
    };
    const read = () => merge(readJobDetails(this.doc, this.description ?? this.jobInfo.description, this.jobInfo.role, this.jobInfo.location));
    read();
    const remote = this.jobInfo.remote;
    if (remote && this.deps.jobDetails && !this.detailsFetched && !(this.details.location && this.details.workMode && this.details.pay)) {
      this.detailsFetched = true;
      merge((await this.deps.jobDetails(remote).catch(() => null)) ?? {});
    }
    if (!this.details.pay) {
      // The posted range is often only in the description, which some platforms fetch separately.
      await this.loadDescription().catch(() => undefined);
      read();
    }
    return this.details;
  }

  /**
   * The scanned field for a record. Workday re-renders a question once it is answered, so the original element can
   * be replaced by an identical one: find it again by label and kind, and re-key the record to the new element.
   */
  private relocate(rec: FieldRecord): ScannedField | undefined {
    const scanned = scanFields(this.root());
    const same = scanned.find((f) => f.el === rec.field.el);
    if (same) return same;
    const taken = new Set(this.records.keys());
    const candidates = scanned.filter((f) => !taken.has(f.el) && f.kind === rec.field.kind && f.label === rec.field.label &&
      JSON.stringify(f.section) === JSON.stringify(rec.field.section));
    if (candidates.length !== 1) return undefined;
    this.records.delete(rec.field.el);
    this.records.set(candidates[0]!.el, rec);
    return candidates[0];
  }

  /** Only an explicit request reads an answer; unresolved metadata contains no values. */
  captureAnswer(token: string, question: string, reset = true): CapturedAnswer {
    if (this.busy || this.stopped) throw new Error('Wait for autofill to finish, then try again.');
    const rec = [...this.records.values()].find(r => r.token === token);
    const field = rec && this.relocate(rec);
    // Say which check failed (no values), so a page that rewrites its labels or markup can be diagnosed.
    const why = !rec ? 'its record is gone' : !field ? 'it is no longer on the page' : !labelMatches(field, question) ? 'its label changed' : !canRemember({ ...rec, field }) ? `${field.kind} fields cannot be saved` : '';
    if (why || !rec || !field) {
      console.warn(`[Job Autofill] cannot capture: ${why}`, { was: question.slice(0, 200), now: field?.label.slice(0, 200) });
      throw new Error(`This field changed (${why}). Click Fill this page to refresh it.`);
    }
    rec.field = { ...field, label: rec.field.label };
    const mode = selectionMode(field);
    const values = mode === 'multiple' ? selectedValues(field) : [];
    const value = mode === 'multiple' ? (values.length === 1 ? values[0]! : '') : fieldHasValue(field) ? answerOf(field, question) : '';
    if (mode !== 'multiple' && fieldHasValue(field) && !value) throw new Error('Choose an answer from the dropdown before saving. If the selected answer cannot be read, add it in Settings → Memories.');
    if (values.length) parseSelections(values.map(value => ({ value, aliases: [] })));
    const captureId = crypto.randomUUID();
    if (reset) this.captures.clear();
    this.captures.set(captureId, { rec, value, question, values, members: [...field.members], mode });
    return { token, captureId, section: field.section, label: rec.field.label, kind: field.kind, options: field.options.filter(o => !isPlaceholderOption(o)).slice(0, 200), value, selectionMode: mode, ...(mode === 'multiple' ? { values } : {}) };
  }

  captureAnswers(fields: { token: string; label: string }[]) {
    if (!Array.isArray(fields) || fields.length > 100 || new Set(fields.map(f => f.token)).size !== fields.length) throw new Error('Choose up to 100 distinct questions.');
    this.captures.clear();
    const captures: CapturedAnswer[] = [];
    const skipped: { label: string; reason: string }[] = [];
    for (const field of fields) {
      try {
        const rec = [...this.records.values()].find(r => r.token === field.token);
        if (!rec?.review) throw new Error('This question is no longer in the review list.');
        const capture = this.captureAnswer(field.token, field.label, false);
        if (!capture.value && !capture.values?.length) { this.captures.delete(capture.captureId); skipped.push({ label: field.label, reason: 'No committed answer yet.' }); }
        else captures.push(capture);
      } catch { skipped.push({ label: field.label, reason: 'This field changed or its selected answer could not be read. Capture it individually.' }); }
    }
    return { captures, skipped };
  }

  validateCaptures(entries: { token: string; captureId: string }[]) {
    if (this.stopped || this.busy || !Array.isArray(entries) || !entries.length || entries.length > 100 || new Set(entries.map(e => e.captureId)).size !== entries.length) throw new Error('These captures expired. Read the answers again.');
    return entries.map(entry => {
      const snapshot = this.checkedCapture(entry.token, entry.captureId);
      const field = snapshot.rec.field;
      return { token: entry.token, captureId: entry.captureId, label: field.label, section: field.section, kind: field.kind, options: field.options.slice(0, 200), value: snapshot.mode === 'multiple' ? '' : snapshot.value, selectionMode: snapshot.mode, ...(snapshot.mode === 'multiple' ? { values: snapshot.values } : {}) } satisfies CapturedAnswer;
    });
  }

  finishRemembering(entries: { token: string; captureId: string }[]) {
    this.validateCaptures(entries);
    for (const entry of entries) {
      const snapshot = this.checkedCapture(entry.token, entry.captureId);
      snapshot.rec.review = false;
      snapshot.rec.outcome = 'already';
      snapshot.rec.selectionReason = undefined;
      this.captures.delete(entry.captureId);
    }
    this.deps.onProgress?.(this.verify());
  }

  private checkedCapture(token: string, captureId: string) {
    const snapshot = this.captures.get(captureId);
    if (!snapshot || snapshot.rec.token !== token || this.stopped || this.busy) throw new Error('This capture expired. Remember the answer again.');
    const current = scanFields(this.root()).find(f => f.el === snapshot.rec.field.el);
    if (!current || !labelMatches(current, snapshot.question) || JSON.stringify(current.section) !== JSON.stringify(snapshot.rec.field.section) || selectionMode(current) !== snapshot.mode ||
      current.members.length !== snapshot.members.length || current.members.some((m, i) => m !== snapshot.members[i]) ||
      (snapshot.mode === 'multiple' ? !sameSelections(selectedValues(current), snapshot.values) : answerOf(current, snapshot.question) !== snapshot.value)) throw new Error('The page answer changed after capture. Read the answers again.');
    snapshot.rec.field = { ...current, label: snapshot.rec.field.label };
    return snapshot;
  }

  async applyAnswer(token: string, captureId: string, mapping: RememberedMapping): Promise<string> {
    const snapshot = this.checkedCapture(token, captureId);
    this.captures.delete(captureId);
    const { rec } = snapshot;
    const current = scanFields(this.root()).find(f => f.el === rec.field.el);
    if (!current) throw new Error('The page field changed. Capture it again.');
    rec.field = { ...current, label: rec.field.label };
    // Never replace an answer entered by the person. Saving and applying an empty field is sufficient.
    if (fieldHasValue(current)) { rec.review = false; rec.outcome = 'already'; rec.selectionReason = undefined; this.deps.onProgress?.(this.verify()); return 'Saved for future applications. Your page answer was kept.'; }
    this.busy = true;
    try {
      rec.saved = mapping;
      rec.cls = mapping.target.kind === 'profile' ? { kind: 'profile', key: mapping.target.key, source: 'remembered' } : mapping.target.kind === 'answer' ? { kind: 'saved_answer', answer: mapping.target.value } : { kind: 'unknown', askAi: false };
      await this.fillRecord(rec);
      if (rec.outcome === 'filled' && fieldHasValue(rec.field)) rec.review = false;
    } finally { this.markIdle(); }
    this.deps.onProgress?.(this.verify());
    return rec.outcome === 'filled' ? 'Saved and applied to this field.' : 'Saved for future applications. Select the answer on this page; no unambiguous option matched.';
  }

  /** The question and job details for drafting one empty free response on a chat website. Reads no page answers. */
  async draftRequest(token: string, question: string): Promise<Omit<AnswerRequest, 'runId'>> {
    const rec = this.liveFreeResponse(token, question);
    if (fieldHasValue(rec.field)) throw new Error('This question already has an answer on the page.');
    await this.loadDescription().catch(() => undefined);
    return {
      question: rec.field.label,
      characterLimit: characterLimitFor(rec.field.label, rec.field.maxLength),
      company: this.jobInfo.company,
      role: this.jobInfo.role,
      jobDescription: this.description ?? '',
      jobUrl: this.postingLink(),
    };
  }

  /** The job posting this form belongs to: a link back to it on the page, or the posting its address points to. */
  postingLink(): string {
    return findPostingLink(this.doc, this.doc.location?.href ?? '');
  }

  /** Writes a reply the person pasted into one empty free response, marked as an AI draft to review. */
  applyDraft(token: string, question: string, text: string): string {
    const rec = this.liveFreeResponse(token, question);
    if (fieldHasValue(rec.field)) throw new Error('This question already has an answer on the page, so it was kept. Clear it there to use the draft.');
    // A box shorter than the usual minimum still gets a reply cut at a sentence, not mid-word.
    const limit = Math.min(characterLimitFor(rec.field.label, rec.field.maxLength), rec.field.maxLength || Infinity);
    const full = clampToLimit(text, Infinity), answer = clampToLimit(text, limit);
    if (!answer) throw new Error('Paste the reply first.');
    rec.outcome = fillText(rec.field, answer);
    if (rec.outcome !== 'filled' || !fieldHasValue(rec.field)) {
      rec.outcome = 'failed';
      throw new Error('Could not write the answer into this field. Paste it on the page instead.');
    }
    rec.cls = { kind: 'free_response' };
    rec.ai = true;
    rec.flag = false;
    rec.writtenValue = fieldValueSignature(rec.field);
    outline(rec.field.outlineTarget, 'ai');
    this.deps.onProgress?.(this.verify());
    return answer.length < full.length
      ? `Added for review, shortened to fit ${limit} characters. Check it on the page before submitting.`
      : 'Added for review. Check it on the page before submitting.';
  }

  /** A free response, including one the page redrew after filling (recorded without a fill classification). */
  private isFreeResponse(rec: FieldRecord): boolean {
    return isTextBox(rec.field) && (rec.cls.kind === 'free_response' || classifyField(rec.field, this.adapter.keys).kind === 'free_response');
  }

  private liveFreeResponse(token: string, question: string): FieldRecord {
    if (this.busy || this.stopped) throw new Error('Wait for autofill to finish, then try again.');
    let rec = [...this.records.values()].find(r => r.token === token);
    let field = rec && this.relocate(rec);
    if (!rec || !field || !labelMatches(field, question)) {
      // The page redrew the question (a new element and token) or it was filled again: find it by its wording.
      this.collectFresh(true);
      const same = [...this.records.values()].filter(r => r.field.el.isConnected && labelMatches(r.field, question) && this.isFreeResponse(r));
      rec = same.length === 1 ? same[0] : undefined;
      field = rec && this.relocate(rec);
    }
    if (!rec || !field || !labelMatches(field, question) || !this.isFreeResponse(rec)) {
      throw new Error('This question is no longer on the page. Click Fill this page to refresh the results.');
    }
    rec.field = { ...field, label: rec.field.label };
    return rec;
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
      console.debug(`[Job Autofill] rescan round ${round + 1}`);
      if (!(await this.processNew())) break;
    }
    console.debug('[Job Autofill] rescans done');
    // Hydration/options can finish after the first pass. Retry only empty local facts;
    // essays, uploads and user-entered values are never replayed here.
    if (!this.stopped) {
      const retry = [...this.records.values()].filter(rec =>
        ['failed', 'nomatch'].includes(rec.outcome ?? '') &&
        !['free_response', 'challenge', 'consent'].includes(rec.cls.kind) && !rec.ai && rec.field.kind !== 'file');
      if (retry.length) {
        console.debug(`[Job Autofill] retrying ${retry.length} empty field(s)`);
        await sleep(timing.settle);
        const before = new Map(retry.map(rec => [rec, { el: rec.field.el, label: rec.field.label, kind: rec.field.kind, options: JSON.stringify(rec.field.options), saved: rec.saved?.id }]));
        const current = new Map(scanFields(this.root()).map(field => [field.el, field]));
        for (const rec of retry) {
          const field = current.get(rec.field.el) ?? this.relocate(rec);
          if (field && field.label === before.get(rec)!.label && field.kind === before.get(rec)!.kind) rec.field = field;
        }
        await this.applyRememberedMappings(retry);
        for (const rec of retry) {
          const field = rec.field.el.isConnected ? rec.field : this.relocate(rec);
          if (this.stopped) break;
          if (!field || fieldHasValue(field) || (!rec.saved && !['profile', 'saved_answer'].includes(rec.cls.kind))) continue;
          const was = before.get(rec)!;
          if (field.label !== was.label || field.kind !== was.kind) continue;
          if (field.el === was.el && JSON.stringify(field.options) === was.options && rec.saved?.id === was.saved) continue;
          rec.field = field;
          await this.fillRecord(rec);
          if (rec.outcome === 'filled') { rec.review = false; rec.selectionReason = undefined; }
        }
      }
    }
    console.debug('[Job Autofill] verifying');
    return this.verify();
  }

  /** Watches for conditional follow-up questions, user edits, and (multi-step forms) the next step. */
  observe(autofill = true) {
    this.observer?.disconnect();
    this.stopWatching?.();
    if (this.stopped) return;
    let active = true;
    // A multi-step form swaps its whole form between steps, so watch the page instead.
    const root = this.doc.body;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rescan = () => {
      clearTimeout(timer);
      if (this.stopped) return;
      timer = setTimeout(async () => {
        if (this.stopped) return;
        if (this.busy) return rescan();
        if (autofill) await this.processNew(true);
        else this.collectFresh(true);
        if (active && !this.stopped) this.deps.onProgress?.(this.verify());
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
    const onEdit = (event: Event) => {
      // A real edit makes even an optional question teachable. This marks only
      // the existing field token; reading an answer still requires explicit capture.
      if (event.isTrusted && ['input', 'change'].includes(event.type) && event.target instanceof Node) {
        const target = event.target;
        const rec = [...this.records.values()].find(r => r.field.el === target || r.field.members.some(member => member.contains(target)));
        if (rec && canRemember(rec)) rec.review = true;
      }
      clearTimeout(editTimer);
      editTimer = setTimeout(() => {
        if (active && !this.stopped && !this.busy) this.deps.onProgress?.(this.verify());
      }, 1200);
    };
    root.addEventListener('change', onEdit, true);
    root.addEventListener('input', onEdit, true);
    root.addEventListener('click', onEdit, true);
    this.stopWatching = () => {
      active = false;
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
    this.observer = undefined;
    this.stopWatching = undefined;
    this.blanking.abort();
  }

  private stopped = false;
  /** Repeatable sections already given their entries in this session. */
  private expanded = new WeakSet<Element>();
  /** Questions already handled in this session, so a redrawn copy is not filled again behind the user's back. */
  private seen = new Set<string>();
  /** Uploads have external side effects. Never repeat one because a site replaces its input. */
  private attemptedDocuments = new Set<string>();

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
  private collectFresh(watching = false): FieldRecord[] {
    const fresh: FieldRecord[] = [];
    if (this.stopped) return fresh;
    const fields = scanFields(this.root());
    // Sign-in pages are left alone; the form after them is new and gets filled then.
    if (isSignInPage(this.root(), fields)) return fresh;
    for (const field of fields) {
      if (this.records.has(field.el)) continue;
      // A control the page redrew after the user removed its value (a deleted resume swapped for an upload
      // button) is a new element, but not a new question: leave it for the next explicit Fill.
      const sig = fieldSignature(field);
      if (this.seen.has(sig)) {
        const previous = [...this.records.values()].filter(r => !r.field.el.isConnected && fieldSignature(r.field) === sig);
        if (previous.length === 1) {
          const rec = previous[0]!;
          this.records.delete(rec.field.el);
          rec.field = field;
          this.records.set(field.el, rec);
          continue;
        }
        if (watching) {
          this.records.set(field.el, { field, cls: { kind: 'unknown', askAi: false }, token: crypto.randomUUID() });
          continue;
        }
      }
      this.seen.add(sig);
      const rec: FieldRecord = { field, cls: classifyField(field, this.adapter.keys), token: crypto.randomUUID() };
      if (rec.cls.kind !== 'profile') console.info(`[Job Autofill] "${field.label.slice(0, 60) || '(no label)'}" (${field.kind}): ${rec.cls.kind}`);
      this.records.set(field.el, rec);
      fresh.push(rec);
    }
    return fresh;
  }

  private async applyRememberedMappings(records: FieldRecord[]) {
    // Prepared responses never override canonical facts, files, consent or challenge controls.
    const presetRecords = new Set<FieldRecord>();
    for (const rec of records) {
      if (isEmployerContact(rec.field)) continue;
      if (!['text', 'textarea'].includes(rec.field.kind) || !['free_response', 'unknown'].includes(rec.cls.kind)) continue;
      const answer = preparedResponse(this.deps.context.preset?.responses ?? [], rec.field.label);
      if (answer !== undefined) { rec.cls = { kind: 'saved_answer', answer }; presetRecords.add(rec); }
    }
    const eligible = records.filter(r => !presetRecords.has(r) && canRemember(r) &&
      !(r.cls.kind === 'profile' && ['portfolio', 'github', 'website'].includes(r.cls.key) &&
        this.deps.context.preset?.links?.[r.cls.key as 'portfolio' | 'github' | 'website'] !== undefined &&
        this.deps.context.preset.links[r.cls.key as 'portfolio' | 'github' | 'website'] !== null));
    if (!eligible.length || (!this.deps.rememberedMappings && !this.deps.matchSavedAnswers)) return;
    try {
      if (this.deps.matchSavedAnswers) {
        for (let i = 0; i < eligible.length; i += 200) {
          const batch = eligible.slice(i, i + 200);
          const matches = await this.deps.matchSavedAnswers(batch.map(r => ({ label: r.field.label, kind: r.field.kind, options: r.field.options.slice(0, 200), selectionMode: selectionMode(r.field) })));
          const current = new Map(scanFields(this.root()).map(f => [f.el, f]));
          batch.forEach((rec, index) => {
            const field = current.get(rec.field.el);
            if (!field || field.label !== rec.field.label) return;
            rec.field = field;
            const match = matches[index];
            rec.suggestionId = match?.suggestionId;
            if (match?.reason.includes('saved list')) { rec.selectionReason = match.reason; rec.flag = true; }
            if (!match?.mapping) return;
            rec.saved = match.mapping;
            rec.cls = match.mapping.target.kind === 'profile'
              ? { kind: 'profile', key: match.mapping.target.key, source: 'remembered' }
              : match.mapping.target.kind === 'answer' ? { kind: 'saved_answer', answer: match.mapping.target.value } : { kind: 'unknown', askAi: false };
          });
        }
        return;
      }
      // Fetch only mappings for these fields, including follow-ups that appear during filling.
      const mappings = new Map<number, RememberedMapping>();
      for (let i = 0; i < eligible.length; i += 200) {
        for (const mapping of await this.deps.rememberedMappings!(eligible.slice(i, i + 200).map((r) => r.field.label))) {
          mappings.set(mapping.id, mapping);
        }
      }
      // The form may rerender or change a question while the worker lookup is pending.
      const current = new Map(scanFields(this.root()).map((field) => [field.el, field]));
      for (const rec of eligible) {
        const field = current.get(rec.field.el);
        if (!field) continue;
        rec.field = field;
        rec.cls = classifyField(field, this.adapter.keys);
        if (!canRemember(rec)) continue;
        const mapping = resolveRememberedMapping([...mappings.values()], this.adapter.platform, rec.field.label);
        if (!mapping) continue;
        rec.saved = mapping;
        rec.cls = mapping.target.kind === 'profile'
          ? { kind: 'profile', key: mapping.target.key, source: 'remembered' }
          : mapping.target.kind === 'answer' ? { kind: 'saved_answer', answer: mapping.target.value } : { kind: 'unknown', askAi: false };
      }
    } catch {
      // A storage/worker failure must not stop profile filling or expose applicant answers in logs.
      this.aiNote = 'Remembered answers could not be loaded. Try filling again.';
    }
  }

  /** Fills fields not seen before. Returns how many new fields were found. */
  async processNew(watching = false): Promise<number> {
    if (this.busy || this.stopped) return 0;
    this.busy = true;
    try {
      // Add one work-experience / education entry per profile entry before reading the fields.
      await this.adapter.prepare?.(this.root(), this.deps.context.profile, this.expanded).catch((err) => console.warn('[Job Autofill] could not add entries', err));
      const fresh = this.collectFresh(watching);
      if (!fresh.length) return 0;
      await this.applyRememberedMappings(fresh);

      // Optional network matching is deferred until all locally known facts are filled.
      this.deps.onPhase?.('Filling profile and Memories');

      const watcher = this.watchForCleared();
      // Walk locally known fields in document order, deferring optional AI. A question
      // revealed by an answer (race after Hispanic/Latino) is slotted in right after the field that revealed it.
      let added = false;
      const grow = new MutationObserver((mutations) => {
        if (mutations.some((m) => Array.from(m.addedNodes).some((n) => n.nodeType === 1 && !(n as Element).closest('[data-jaf]')))) {
          added = true;
        }
      });
      grow.observe(this.root() as Node, { childList: true, subtree: true });
      const queue = [...fresh].sort(byDocumentOrder);
      const deferredResponses: FieldRecord[] = [];
      const deferredMappings: FieldRecord[] = [];
      try {
        for (let i = 0; i < queue.length; i++) {
          // A disconnected session (a newer Fill, or the page moved on) stops mid-pass.
          if (this.stopped) break;
          const rec = queue[i]!;
          // Fill profile and remembered facts across the form before calling AI for essays.
          if (rec.cls.kind === 'unknown' && rec.cls.askAi && !rec.saved && this.deps.context.hasGeminiKey) {
            deferredMappings.push(rec);
            continue;
          }
          if (rec.cls.kind === 'free_response') {
            deferredResponses.push(rec);
            continue;
          }
          added = false;
          await this.fillRecord(rec);
          const reveals = REVEALS_RE.test(rec.field.label);
          if (!added && !reveals) continue;
          // The follow-up can render a beat after the answer lands, so a known reveal question is
          // polled before moving on; other DOM changes get one short settle.
          const more = await this.waitForFresh(reveals ? timing.reveal : timing.settle);
          if (!more.length) continue;
          await this.applyRememberedMappings(more);
          // Unfamiliar fields join the deferred matching pass; known facts remain immediate.
          fresh.push(...more);
          // Fields that appeared above the current one (a page re-render) are not gone back for.
          // (When the page changed under the current field, everything new is below it.)
          const below = rec.field.el.isConnected ? more.filter((r) => byDocumentOrder(rec, r) < 0) : more;
          const rest = [...queue.slice(i + 1), ...below].sort(byDocumentOrder);
          queue.length = i + 1;
          queue.push(...rest);
        }
        if (deferredMappings.length && !this.stopped) {
          this.deps.onPhase?.('Matching unfamiliar questions');
          await this.mapUnknown(deferredMappings);
          for (const rec of deferredMappings) {
            if (this.stopped) break;
            await this.fillRecord(rec);
          }
        }
        if (deferredResponses.length && !this.stopped) this.deps.onPhase?.('Writing free responses');
        for (const rec of deferredResponses) {
          if (this.stopped) break;
          await this.fillRecord(rec);
        }
      } finally {
        grow.disconnect();
      }
      // Some forms reset a dropdown when a later field is touched; put back any that went blank.
      if (this.stopped) { watcher.disconnect(); return fresh.length; }
      this.deps.onPhase?.('Checking filled fields');
      this.traceDropdowns('before restore');
      await this.restoreDropdowns(fresh);
      await this.restoreYesNo(fresh);
      this.traceDropdowns('end of pass');
      watcher.disconnect();
      await this.closeOpenDropdowns();
      return fresh.length;
    } finally {
      this.markIdle();
    }
  }

  /**
   * Questions no rule recognised: AI picks which saved profile fact answers each (or none), and the value
   * itself still comes from the profile. Only labels and option texts are sent, never profile values.
   */
  private async mapUnknown(records: FieldRecord[]) {
    if (!this.deps.mapFields || !this.deps.context.hasGeminiKey) return;
    const pending = records.filter(
      (r) => r.cls.kind === 'unknown' && r.cls.askAi && !r.suggestionId && r.field.el.isConnected && r.field.kind !== 'file' && !fieldHasValue(r.field),
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
    await this.writeRecord(rec);
    if (rec.outcome === 'filled' && rec.field.el.isConnected) rec.writtenValue = fieldValueSignature(rec.field);
  }

  private async writeRecord(rec: FieldRecord) {
    if (this.stopped) return;
    if (rec.saved?.target.kind === 'answers') {
      try {
        const original = rec.field;
        const result = await fillRememberedSelections(() => {
          if (this.stopped) return undefined;
          const field = reacquireSelectionField(this.root(), original);
          if (field && field.el !== rec.field.el) { this.records.delete(rec.field.el); rec.field = field; this.records.set(field.el, rec); }
          return field;
        }, rec.saved.target.selections);
        rec.outcome = result.outcome; rec.selectionLabels = result.labels; rec.selectionReason = result.reason;
        rec.flag = result.outcome === 'failed' || result.outcome === 'nomatch';
      } catch { rec.outcome = 'failed'; rec.flag = true; rec.selectionReason = 'Could not verify every selected answer. Review this field.'; }
      return;
    }
    if (rec.cls.kind === 'free_response') return this.fillFreeResponse(rec);
    if (rec.cls.kind !== 'profile' && rec.cls.kind !== 'saved_answer') return;
    const before = openLists(this.doc);
    await this.fillProfileField(rec);
    if (this.stopped) return;
    // Whatever the outcome, leave no list open and the field unfocused before moving on.
    if (rec.field.el.isConnected) await closeListsOpenedBy(rec.field, before);
    if (rec.outcome !== 'filled') return;
    if (rec.cls.kind === 'profile' && rec.cls.source === 'ai') {
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
      if (this.stopped) return;
      const lost = records.filter(
        (r) => r.field.kind === 'combobox' && r.outcome === 'filled' && r.field.el.isConnected && !comboboxHasValue(r.field),
      );
      if (!lost.length) return;
      console.warn(`[Job Autofill] re-filling ${lost.length} dropdown(s) that went blank (round ${round + 1})`);
      for (const rec of lost) {
        rec.outcome = undefined;
        await this.fillRecord(rec);
      }
      await sleep(timing.settle);
    }
  }

  /** A site that re-renders or resets (Ashby after a resume is read) can clear a Yes/No we answered; answer it again. */
  private async restoreYesNo(records: FieldRecord[]) {
    for (let round = 0; round < 3; round++) {
      if (this.stopped) return;
      await sleep(timing.settle);
      const lost = records.filter(
        (r) => r.field.kind === 'yesno' && r.outcome === 'filled' && r.field.el.isConnected && yesNoExposesState(r.field) && !yesNoSelected(r.field),
      );
      if (!lost.length) return;
      console.warn(`[Job Autofill] re-answering ${lost.length} Yes/No question(s) the page cleared (round ${round + 1})`);
      for (const rec of lost) {
        rec.outcome = undefined;
        await this.fillRecord(rec);
      }
    }
  }

  private async fillProfileField(rec: FieldRecord) {
    if (this.stopped) return;
    if (rec.cls.kind !== 'profile' && rec.cls.kind !== 'saved_answer') return;
    const { field } = rec;
    this.activeLabel = field.label;
    const key = rec.cls.kind === 'profile' ? rec.cls.key : undefined;
    const savedAnswer = rec.cls.kind === 'saved_answer' ? rec.cls.answer : undefined;
    const profile = this.deps.context.profile;
    try {
      if (key === 'resume' || key === 'coverLetter' || key === 'transcript') {
        const file = key === 'resume' ? this.resumeFile : key === 'coverLetter' ? this.coverLetterFile : this.transcriptFile;
        if (field.kind !== 'file' || !file) { rec.outcome = 'nomatch'; return; }
        if (uploadedAlready(field.el as HTMLInputElement) || (field.el as HTMLInputElement).files?.length) {
          rec.outcome = 'already'; return;
        }
        if (this.attemptedDocuments.has(key)) { rec.outcome = 'failed'; return; }
        this.attemptedDocuments.add(key);
        rec.outcome = fillFile(field, file);
        return;
      }
      const hasCodeField = [...this.records.values()].some((r) => r.cls.kind === 'profile' && r.cls.key === 'phoneCountryCode');
      const hasPreferredNameField = [...this.records.values()].some((r) => r.cls.kind === 'profile' && (r.cls.key === 'preferredName' || r.cls.key === 'hasPreferredName'));
      // react-select style dropdowns expose no options up front, so a question-shaped label stands in.
      const yesNo = isYesNo(field.options) || (!field.options.length && field.kind !== 'text' && QUESTION_RE.test(field.label.trim()));
      // Salary answers follow the pay range posted in the job description when there is one.
      if (key === 'salary') await this.loadDescription();
      if (this.stopped) return;
      const values = savedAnswer !== undefined ? [savedAnswer] : key ? valueFor(key, profile, {
        description: key === 'salary' ? (this.description ?? '') : undefined,
        phoneWithCode: !hasCodeField && WITH_CODE_RE.test(field.label.toLowerCase()),
        yesNo: (key === 'workMode' || key === 'clearance') && yesNo,
        label: field.label,
        required: field.required,
        options: field.options,
        index: rec.cls.kind === 'profile' ? rec.cls.index : undefined,
        company: this.jobInfo.company,
        hasPreferredNameField,
      }) : null;
      // Two URL boxes ("Website", "Other website") never get the same link: skip any already in another link box.
      if (values && key !== undefined && LINK_KEYS.has(key)) {
        const norm = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
        const taken = new Set(
          [...this.records.values()]
            .filter((r) => r !== rec && r.cls.kind === 'profile' && LINK_KEYS.has(r.cls.key) && r.field.el.isConnected)
            .map((r) => norm(displayedValue(r.field)))
            .filter(Boolean),
        );
        const fresh = values.filter((v) => !taken.has(norm(v)));
        values.splice(0, values.length, ...fresh);
      }
      const choice: ChoiceOpts = {
        degree: key === 'degree',
        // "University of California" is not "University of California, Santa Cruz".
        strict: key !== undefined && STRICT_KEYS.has(key),
        remembered: savedAnswer !== undefined,
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
        for (const [i, skill] of profile.skills.entries()) {
          if (this.stopped) return;
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
            if (this.stopped) return;
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
      if (values?.[0] && rec.saved) {
        const remembered = rememberedChoice(rec.saved, values, field.label);
        values.splice(0, values.length, ...remembered.values);
        if (remembered.pick) choice.pick = remembered.pick;
      }
      if (key === 'gpa' && values) choice.pick = options => bestGpaOption(values!, options);
      if (key === 'location' || key === 'city' || key === 'cityState') {
        choice.pick = options => pickApplicantLocation(options, profile, key === 'location' && !/\b(city|current)\b/i.test(field.label));
        choice.search = true;
        choice.queries = applicantLocationQueries(profile);
      }
      const first = values?.[0];
      if (savedAnswer !== undefined && field.maxLength && savedAnswer.length > field.maxLength) {
        rec.outcome = 'nomatch';
        return;
      }
      if (!values || !first) {
        // The site's resume parser may have prefilled an employer the profile says is blank; clear it.
        if (key === 'currentCompany' && rec.cls.kind === 'profile' && rec.cls.source !== 'remembered' && field.kind === 'text' && !profile.currentCompany.trim()) {
          keepBlank(field.el as HTMLInputElement, this.blanking.signal);
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
          rec.outcome = isTypeahead ? await fillTypeahead(field, values, choice) : fillText(field, typed);
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
          rec.outcome = fillCheckboxGroup(field, values, { remembered: savedAnswer !== undefined });
          break;
        case 'yesno':
          rec.outcome = fillYesNo(field, values, { strict: savedAnswer !== undefined, pick: choice.pick });
          if (rec.outcome === 'filled' && !(await yesNoTook(field))) rec.outcome = 'failed';
          break;
        default:
          rec.outcome = 'nomatch';
      }
    } catch {
      console.warn('[Job Autofill] could not fill', field.label);
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
    // The person answers free responses themselves.
    if (this.deps.context.freeResponses === 'none') return;
    const chat = this.deps.context.chatProvider;
    if (chat) {
      // Drafted on the chat website only when the person asks, from the side panel.
      this.aiNote = chatDraftNote(chat);
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
      jobUrl: this.postingLink(),
    });
    if (!res.ok) {
      rec.flag = true;
      this.aiNote = res.error;
      clearOutline(field.outlineTarget);
      return;
    }
    if (this.stopped || fieldHasValue(field) || !field.el.isConnected) return;
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
    const missingQuestions: (string | null)[] = [];
    const reviewFields: ReviewField[] = [];
    const fieldFeedback: FieldFeedback[] = [];
    const memoryQuestions = new Set<string>();
    let drafts = 0;
    for (const [el, rec] of this.records) {
      if (!el.isConnected) {
        this.records.delete(el);
        continue;
      }
      const { field } = rec;
      if (canRemember(rec)) memoryQuestions.add(field.label);
      const weFilled = rec.outcome === 'filled';
      // File inputs and Yes/No buttons that do not expose their state (no aria-pressed) cannot be read back; trust our own fill there.
      const mode = selectionMode(field);
      const selected = mode === 'multiple' ? selectedValues(field) : [];
      // Workday keeps its upload box empty once a file is attached, so a file the page already lists counts as present.
      const has = mode === 'multiple' ? selected.length > 0 : fieldHasValue(field) || (weFilled && ((field.kind === 'yesno' && !yesNoExposesState(field)) || field.kind === 'file')) || (field.kind === 'file' && uploadedAlready(field.el as HTMLInputElement));
      // Only read back values this run wrote. Existing page answers need presence
      // feedback, not a value snapshot or capture.
      const currentValue = weFilled ? fieldValueSignature(field) : undefined;
      const changed = weFilled && rec.writtenValue !== undefined && currentValue !== rec.writtenValue;
      const incomplete = rec.saved?.target.kind === 'answers' && rec.outcome !== 'already' &&
        !changed && (rec.outcome !== 'filled' || !sameSelections(selected, rec.selectionLabels ?? []));
      const geographicChoice = rec.cls.kind === 'profile' && ['location', 'city', 'cityState'].includes(rec.cls.key) &&
        ['combobox', 'select', 'listbox', 'prompt'].includes(field.kind);
      const locationMismatch = geographicChoice && !changed && (weFilled || rec.outcome === 'failed') && has &&
        pickApplicantLocation([displayedValue(field)], this.deps.context.profile,
          rec.cls.kind === 'profile' && rec.cls.key === 'location' && !/\b(city|current)\b/i.test(field.label)) !== 0;
      let state: ReviewState | null = null;
      if (incomplete || locationMismatch) state = 'missing';
      else if (changed && has) state = 'entered';
      else if (rec.ai && has) state = 'ai';
      else if (weFilled && has) state = 'filled';
      else if (!has && (field.required || rec.flag)) state = 'missing';

      if (state === 'ai') aiAnswers++;
      if (state === 'filled') filledCount++;
      if (state === 'missing') {
        missingLabels.push(labelFor(field));
        missingQuestions.push(canRemember(rec) ? field.label : null);
        if (canRemember(rec)) rec.review = true;
      }
      const reviewReason = has && !incomplete && !locationMismatch && (changed || !weFilled) ? undefined : geographicChoice && (locationMismatch || !has)
        ? 'No unambiguous location matched your saved city, state and country. Choose the correct location on the page.' : rec.selectionReason;
      if (changed && has && canRemember(rec)) rec.review = true;
      if (rec.review && canRemember(rec)) reviewFields.push({ token: rec.token!, label: field.label, answered: has, selectionMode: mode, ...(mode === 'multiple' ? { selectedCount: selected.length } : {}), ...(reviewReason ? { reason: reviewReason } : {}), ...(rec.suggestionId ? { suggestionId: rec.suggestionId } : {}) });

      if (field.label.trim() && field.label.length <= 700) {
        const readable = currentValue !== undefined;
        // Any empty free response: the side panel offers drafting whenever a chat website is chosen, even after filling.
        const draftable = !has && this.isFreeResponse(rec);
        if (draftable) drafts++;
        const status: FieldFeedback['status'] = state === 'missing' ? 'missing' : !has ? 'optional' :
          changed || !weFilled ? 'entered' : rec.ai || !readable || rec.writtenValue === undefined ? 'review' : 'verified';
        const source: FieldFeedback['source'] = !has ? 'none' : status === 'entered' ? 'page' : rec.ai ? 'ai' :
          rec.saved ? 'memory' : rec.cls.kind === 'saved_answer' ? 'preset' : rec.cls.kind === 'profile' ? 'profile' : 'none';
        const reason = isEmployerContact(field) ? 'Enter the employer’s contact or address details on the website. Your personal details are never used here.' : reviewReason || (status === 'missing' || status === 'optional' ?
          field.kind === 'file' ? 'Upload this document on the application page.' : rec.cls.kind === 'consent' ? 'Read and confirm this agreement on the website.' :
          rec.suggestionId ? 'A similar Memory needs your confirmation before reuse.' :
          draftable && this.deps.context.chatProvider ? `Click Draft in ${this.deps.context.chatProvider} to write it there, or answer on the page.` :
          rec.cls.kind === 'profile' ? 'A saved Profile answer or a matching option was unavailable. Answer on the page, then confirm where to save it.' :
          'Answer this question on the page. Reusable answers can be confirmed and saved here.' :
          status === 'entered' ? 'Your page answer was preserved. It has not been verified against a saved answer.' :
          status === 'review' ? rec.ai ? 'Review this AI draft or interpretation before submitting.' : 'The widget does not expose enough information to verify the complete answer. Check it on the website.' :
          source === 'memory' ? 'An approved Memory was applied and its current selection was verified.' : source === 'preset' ? 'Your prepared preset response was applied and read back.' :
          'Your saved Profile answer was applied and read back. Check that the saved fact is current.');
        fieldFeedback.push({ token: rec.token!, label: field.label, required: field.required, status, source, reason, ...(draftable ? { draft: true as const } : {}) });
        if (status === 'review') state = rec.ai ? 'ai' : 'review';
        else if (status === 'entered') state = 'entered';
        else if (status === 'optional') state = 'optional';
      }

      if (state) outline(field.outlineTarget, state);
      else if (field.outlineTarget.hasAttribute('data-jaf-state')) clearOutline(field.outlineTarget);
    }
    return { filledCount, aiAnswers, missingLabels, missingQuestions, reviewFields: reviewFields.slice(0, 200), fieldFeedback: fieldFeedback.sort((a, b) => feedbackPriority(a) - feedbackPriority(b)).slice(0, 200), memoryQuestions: [...memoryQuestions].slice(0, 200),
      usedMappingIds: [...new Set([...this.records.values()].filter(r => r.saved && r.outcome === 'filled' && r.writtenValue !== undefined && fieldValueSignature(r.field) === r.writtenValue && fieldHasValue(r.field) && (r.saved.target.kind !== 'answers' || sameSelections(selectedValues(r.field), r.selectionLabels ?? []))).map(r => r.saved!.id))].slice(0, 200),
      // The drafting hint goes once every free response has an answer.
      aiNote: this.aiNote === chatDraftNote(this.deps.context.chatProvider) && !drafts ? undefined : this.aiNote };
  }
}

function fieldValueSignature(field: ScannedField): string | undefined {
  if (field.kind === 'file') {
    const files = (field.el as HTMLInputElement).files;
    return files?.length ? JSON.stringify([...files].map(f => [f.name, f.size, f.lastModified])) : undefined;
  }
  if (field.kind === 'checkbox' || field.kind === 'checkboxGroup' || field.kind === 'radio') return JSON.stringify(field.members.map(m => (m as HTMLInputElement).checked));
  if (field.kind === 'yesno' && !yesNoExposesState(field)) return undefined;
  const values = selectedValues(field);
  return values.length ? JSON.stringify([...values].sort()) : undefined;
}

/** The scanned label still names the question, or is just the answer the page now shows (Workday dropdowns relabel to "No"). */
function labelMatches(field: ScannedField, question: string): boolean {
  if (sameLabel(field.label, question)) return true;
  const shown = fieldHasValue(field) ? displayedValue(field).trim().toLowerCase() : '';
  const label = field.label.trim().toLowerCase();
  // The button's text may carry the question and "Required" around the answer, so the short label need only appear in it.
  if (shown && label && (label === shown || (label.length <= 40 && shown.includes(label)))) return true;
  return questionStillShown(field.el, question);
}

/**
 * The question is still written next to this control: in its <label>, its ARIA name or description, or the field
 * around it (stopping before a container that also holds another control). Covers dropdowns whose accessible name
 * becomes only the chosen answer ("No") while the question text stays on the page beside them.
 */
function questionStillShown(el: HTMLElement, question: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[*\s]+/g, ' ').trim();
  const q = norm(question);
  if (q.length < 4) return false;
  const doc = el.ownerDocument;
  const byId = (ids: string | null) => (ids ?? '').split(/\s+/).filter(Boolean).map(id => doc.getElementById(id)?.textContent ?? '');
  const texts = [el.getAttribute('aria-label') ?? '', ...byId(el.getAttribute('aria-labelledby')), ...byId(el.getAttribute('aria-describedby'))];
  if (el.id) texts.push(doc.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? '');
  for (let node = el.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
    if ([...node.querySelectorAll(OTHER_CONTROLS)].some(c => c !== el)) break;
    texts.push(node.textContent ?? '');
  }
  return texts.some(t => norm(t).includes(q));
}

const OTHER_CONTROLS = 'input:not([type="hidden"]), select, textarea, button[aria-haspopup]';

/** The answer a field shows. A Workday dropdown button's text can also hold its question and "Required"; those are removed. */
function answerOf(field: ScannedField, question: string): string {
  const shown = displayedValue(field).trim();
  if (field.kind !== 'listbox') return shown;
  const clean = shown.replace(new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ').replace(/\brequired\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return clean || shown;
}

/**
 * Labels match ignoring case, spacing and the required asterisk. A dropdown's accessible name can gain its selected
 * answer once answered ("Question? Select One" becomes "Question? No"), so a question ending in "?" is compared
 * up to that mark, and other labels by one being the start of the other.
 */
function sameLabel(a: string, b: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[*\s]+/g, ' ').trim();
  const [x, y] = [norm(a), norm(b)];
  if (x === y) return true;
  const qx = x.indexOf('?');
  const qy = y.indexOf('?');
  if (qx > 10 && qy > 10) return x.slice(0, qx) === y.slice(0, qy);
  return x.length > 20 && y.length > 20 && (x.includes(y) || y.includes(x));
}

function chatDraftNote(chat: string | undefined): string {
  return `Free responses are left for you: click Draft in ${chat} for each one.`;
}

function isTextBox(field: ScannedField): boolean {
  return field.kind === 'text' || field.kind === 'textarea';
}

function canRemember(rec: FieldRecord): boolean {
  return !isEmployerContact(rec.field) && !!rec.field.label.trim() && rec.field.label.length <= 700 &&
    (rec.field.section?.index ?? 0) === 0 &&
    (rec.field.kind !== 'checkboxGroup' || selectionMode(rec.field) === 'multiple') &&
    (rec.field.kind === 'combobox' || rec.field.el.getAttribute('aria-multiselectable') !== 'true') &&
    !['file', 'checkbox'].includes(rec.field.kind) &&
    rec.cls.kind !== 'challenge' && rec.cls.kind !== 'consent';
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
function keepBlank(input: HTMLInputElement, signal: AbortSignal, ms = 20000) {
  if (signal.aborted) return;
  let touched = false;
  let timer: ReturnType<typeof setInterval>, deadline: ReturnType<typeof setTimeout>;
  const stop = () => {
    touched = true;
    clearInterval(timer); clearTimeout(deadline);
    input.removeEventListener('keydown', stop); input.removeEventListener('focus', stop);
    signal.removeEventListener('abort', stop);
  };
  input.addEventListener('keydown', stop, { once: true });
  input.addEventListener('focus', stop, { once: true });
  signal.addEventListener('abort', stop, { once: true });
  const clear = () => {
    if (!touched && input.isConnected && input.value.trim()) setNativeValue(input, '');
  };
  clear();
  timer = setInterval(clear, 300);
  deadline = setTimeout(stop, ms);
}
