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
import { bestGpaOption, characterLimitFor } from './match';
import { composedCompare, isSignInPage, scanFields, type ScannedField } from './scan';
import { WITH_CODE_RE } from './classify';
import { pickLocationPreference, raceChoices, SEARCH_FIRST_RESULT_KEYS, TOP_OPTION_KEYS, valueFor } from './values';
import { isPlaceholderOption } from './match';
import { parseSelections, resolveRememberedMapping, type RememberedMapping, type SavedField, type SavedMatch, type ReviewField, type CapturedAnswer } from '../remembered-mappings';
import { rememberedChoice } from '../saved-answer-preview';
import { fillRememberedSelections, reacquireSelectionField, selectedValues, selectionMode } from './selections';
import { sameSelections } from '../selection-matching';

export interface EngineDeps {
  context: FillContext;
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
  private records = new Map<HTMLElement, FieldRecord>();
  private jobInfo: JobInfo;
  private description: string | null = null;
  private details: JobDetails = { location: '', workMode: '', pay: '' };
  private detailsFetched = false;
  private busy = false;
  private observer?: MutationObserver;
  private stopWatching?: () => void;
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
    this.jobInfo = adapter.jobInfo(doc);
    this.resumeFile = deps.context.resume ? payloadToFile(deps.context.resume) : null;
    this.coverLetterFile = deps.context.coverLetter ? payloadToFile(deps.context.coverLetter) : null;
    this.transcriptFile = deps.context.transcript ? payloadToFile(deps.context.transcript) : null;
  }

  get info(): JobInfo {
    return this.jobInfo;
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
    const read = () => merge(readJobDetails(this.doc, this.description ?? this.jobInfo.description, this.jobInfo.role));
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

  /** Only an explicit request reads an answer; unresolved metadata contains no values. */
  captureAnswer(token: string, question: string, reset = true): CapturedAnswer {
    if (this.busy || this.stopped) throw new Error('Wait for autofill to finish, then try again.');
    const rec = [...this.records.values()].find(r => r.token === token);
    const field = rec && scanFields(this.root()).find(f => f.el === rec.field.el);
    if (!rec || !field || field.label !== question || !canRemember({ ...rec, field })) throw new Error('This field changed. Click Fill this page to refresh it.');
    rec.field = field;
    const mode = selectionMode(field);
    const values = mode === 'multiple' ? selectedValues(field) : [];
    const value = mode === 'multiple' ? (values.length === 1 ? values[0]! : '') : fieldHasValue(field) ? displayedValue(field).trim() : '';
    if (mode !== 'multiple' && fieldHasValue(field) && !value) throw new Error('Choose an answer from the dropdown before saving. If the selected answer cannot be read, add it in Settings → Memories.');
    if (values.length) parseSelections(values.map(value => ({ value, aliases: [] })));
    const captureId = crypto.randomUUID();
    if (reset) this.captures.clear();
    this.captures.set(captureId, { rec, value, question, values, members: [...field.members], mode });
    return { token, captureId, section: field.section, label: field.label, kind: field.kind, options: field.options.filter(o => !isPlaceholderOption(o)).slice(0, 200), value, selectionMode: mode, ...(mode === 'multiple' ? { values } : {}) };
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
    if (!current || current.label !== snapshot.question || JSON.stringify(current.section) !== JSON.stringify(snapshot.rec.field.section) || selectionMode(current) !== snapshot.mode ||
      current.members.length !== snapshot.members.length || current.members.some((m, i) => m !== snapshot.members[i]) ||
      (snapshot.mode === 'multiple' ? !sameSelections(selectedValues(current), snapshot.values) : displayedValue(current).trim() !== snapshot.value)) throw new Error('The page answer changed after capture. Read the answers again.');
    snapshot.rec.field = current;
    return snapshot;
  }

  async applyAnswer(token: string, captureId: string, mapping: RememberedMapping): Promise<string> {
    const snapshot = this.checkedCapture(token, captureId);
    this.captures.delete(captureId);
    const { rec } = snapshot;
    const current = scanFields(this.root()).find(f => f.el === rec.field.el);
    if (!current) throw new Error('The page field changed. Capture it again.');
    rec.field = current;
    // Never replace an answer entered by the person. Saving and applying an empty field is sufficient.
    if (fieldHasValue(current)) { rec.review = false; rec.outcome = 'already'; rec.selectionReason = undefined; this.deps.onProgress?.(this.verify()); return 'Saved for future applications. Your page answer was kept.'; }
    this.busy = true;
    try {
      rec.saved = mapping;
      rec.cls = mapping.target.kind === 'profile' ? { kind: 'profile', key: mapping.target.key, source: 'remembered' } : mapping.target.kind === 'answer' ? { kind: 'saved_answer', answer: mapping.target.value } : { kind: 'unknown', askAi: false };
      await this.fillRecord(rec);
      if (rec.outcome === 'filled' && fieldHasValue(rec.field)) rec.review = false;
    } finally { this.busy = false; }
    this.deps.onProgress?.(this.verify());
    return rec.outcome === 'filled' ? 'Saved and applied to this field.' : 'Saved for future applications. Select the answer on this page; no unambiguous option matched.';
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
        const added = await this.processNew(true);
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
  /** Questions already handled in this session, so a redrawn copy is not filled again behind the user's back. */
  private seen = new Set<string>();

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
      if (watching && this.seen.has(sig)) {
        this.records.set(field.el, { field, cls: { kind: 'unknown', askAi: false }, token: crypto.randomUUID() });
        continue;
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
      const deferredResponses: FieldRecord[] = [];
      try {
        for (let i = 0; i < queue.length; i++) {
          // A disconnected session (a newer Fill, or the page moved on) stops mid-pass.
          if (this.stopped) break;
          const rec = queue[i]!;
          // Fill profile and remembered facts across the form before calling AI for essays.
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
          await this.mapUnknown(more);
          fresh.push(...more);
          // Fields that appeared above the current one (a page re-render) are not gone back for.
          // (When the page changed under the current field, everything new is below it.)
          const below = rec.field.el.isConnected ? more.filter((r) => byDocumentOrder(rec, r) < 0) : more;
          const rest = [...queue.slice(i + 1), ...below].sort(byDocumentOrder);
          queue.length = i + 1;
          queue.push(...rest);
        }
        for (const rec of deferredResponses) {
          if (this.stopped) break;
          await this.fillRecord(rec);
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
    if (rec.cls.kind !== 'profile' && rec.cls.kind !== 'saved_answer') return;
    const { field } = rec;
    this.activeLabel = field.label;
    const key = rec.cls.kind === 'profile' ? rec.cls.key : undefined;
    const savedAnswer = rec.cls.kind === 'saved_answer' ? rec.cls.answer : undefined;
    const profile = this.deps.context.profile;
    try {
      if (key === 'resume' || key === 'coverLetter' || key === 'transcript') {
        const file = key === 'resume' ? this.resumeFile : key === 'coverLetter' ? this.coverLetterFile : this.transcriptFile;
        rec.outcome = field.kind === 'file' && file ? fillFile(field, file) : 'nomatch';
        return;
      }
      const hasCodeField = [...this.records.values()].some((r) => r.cls.kind === 'profile' && r.cls.key === 'phoneCountryCode');
      const hasPreferredNameField = [...this.records.values()].some((r) => r.cls.kind === 'profile' && r.cls.key === 'preferredName');
      // react-select style dropdowns expose no options up front, so a question-shaped label stands in.
      const yesNo = isYesNo(field.options) || (!field.options.length && field.kind !== 'text' && QUESTION_RE.test(field.label.trim()));
      // Salary answers follow the pay range posted in the job description when there is one.
      if (key === 'salary') await this.loadDescription();
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
      const topOption = key !== undefined && TOP_OPTION_KEYS.has(key);
      const choice: ChoiceOpts = {
        topOption,
        degree: key === 'degree',
        // "University of California" is not "University of California, Santa Cruz".
        strict: key !== undefined && STRICT_KEYS.has(key),
        remembered: savedAnswer !== undefined,
        acceptFirstResult: key !== undefined && SEARCH_FIRST_RESULT_KEYS.has(key),
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
      if (values?.[0] && rec.saved) {
        const remembered = rememberedChoice(rec.saved, values, field.label);
        values.splice(0, values.length, ...remembered.values);
        if (remembered.pick) choice.pick = remembered.pick;
      }
      if (key === 'gpa' && values) choice.pick = options => bestGpaOption(values!, options);
      const first = values?.[0];
      if (savedAnswer !== undefined && field.maxLength && savedAnswer.length > field.maxLength) {
        rec.outcome = 'nomatch';
        return;
      }
      if (!values || !first) {
        // The site's resume parser may have prefilled an employer the profile says is blank; clear it.
        if (key === 'currentCompany' && rec.cls.kind === 'profile' && rec.cls.source !== 'remembered' && field.kind === 'text' && !profile.currentCompany.trim()) {
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
          rec.outcome = fillCheckboxGroup(field, values, { remembered: savedAnswer !== undefined });
          break;
        case 'yesno':
          rec.outcome = fillYesNo(field, values, { strict: savedAnswer !== undefined, pick: choice.pick });
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
    const missingQuestions: (string | null)[] = [];
    const reviewFields: ReviewField[] = [];
    const memoryQuestions = new Set<string>();
    for (const [el, rec] of this.records) {
      if (!el.isConnected) {
        this.records.delete(el);
        continue;
      }
      const { field } = rec;
      if (canRemember(rec)) memoryQuestions.add(field.label);
      const weFilled = rec.outcome === 'filled';
      // Yes/No buttons and file inputs do not always expose their state; trust our own fill there.
      const mode = selectionMode(field);
      const selected = mode === 'multiple' ? selectedValues(field) : [];
      const has = mode === 'multiple' ? selected.length > 0 : fieldHasValue(field) || (weFilled && (field.kind === 'yesno' || field.kind === 'file'));
      const incomplete = rec.saved?.target.kind === 'answers' && rec.outcome !== 'already' &&
        (rec.outcome !== 'filled' || !sameSelections(selected, rec.selectionLabels ?? []));
      let state: ReviewState | null = null;
      if (incomplete) state = 'missing';
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
      if (rec.review && canRemember(rec)) reviewFields.push({ token: rec.token!, label: field.label, answered: has, selectionMode: mode, ...(mode === 'multiple' ? { selectedCount: selected.length } : {}), ...(rec.selectionReason ? { reason: rec.selectionReason } : {}), ...(rec.suggestionId ? { suggestionId: rec.suggestionId } : {}) });

      if (state) outline(field.outlineTarget, state);
      else if (field.outlineTarget.hasAttribute('data-jaf-state')) clearOutline(field.outlineTarget);
    }
    return { filledCount, aiAnswers, missingLabels, missingQuestions, reviewFields: reviewFields.slice(0, 200), memoryQuestions: [...memoryQuestions].slice(0, 200),
      usedMappingIds: [...new Set([...this.records.values()].filter(r => r.saved && r.outcome === 'filled' && fieldHasValue(r.field) && (r.saved.target.kind !== 'answers' || sameSelections(selectedValues(r.field), r.selectionLabels ?? []))).map(r => r.saved!.id))].slice(0, 200), aiNote: this.aiNote };
  }
}

function canRemember(rec: FieldRecord): boolean {
  return !!rec.field.label.trim() && rec.field.label.length <= 700 &&
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
