import { useEffect, useMemo, useRef, useState } from 'react';
import { browseMemories, memoriesForPage, type MemoryFilter, type MemorySort } from '@/lib/memory-browser';
import { getProfile, getRememberedMappings } from '@/lib/db';
import { sendToBackground } from '@/lib/messages';
import { questionMeaning } from '@/lib/answer-semantics';
import { meaningDescription, previewContextFor, previewSavedAnswer, scopeDescription, type AnswerPreview } from '@/lib/saved-answer-preview';
import { platformFor } from '@/lib/platforms';
import { valueFor } from '@/lib/autofill/values';
import type { Profile } from '@/lib/types';
import { applicationKey, companyKey, scopeLabel, parseMappingDraft, REMEMBERABLE_PROFILE_FIELDS,
  targetText, type AnswerSelection, type CapturedAnswer, type MappingContext, type MappingDraft, type MappingScope, type RememberableProfileKey, type RememberedMapping } from '@/lib/remembered-mappings';
import { ReuseScope } from './ReuseScope';
import { confirmDelete } from './confirm-delete';
import { useLiveQuery } from './hooks';
import { Button, Field, Input, Notice, Select, Textarea } from './ui';

/** Named, editable entries instead of a hidden newline-delimited configuration format. */
function VariationList({ title, description, example, itemLabel, addLabel, values, onChange, children, limit = 20, maxLength = 700 }: {
  title: string; description: string; example?: string; itemLabel: string; addLabel: string;
  values: string[]; onChange(values: string[]): void; children?: React.ReactNode; limit?: number; maxLength?: number;
}) {
  return <fieldset className="min-w-0 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
    <legend className="px-1 text-sm font-semibold text-slate-800">{title}</legend>
    <p className="text-xs text-slate-600">{description}</p>
    {example && <p className="text-xs text-slate-500">{example}</p>}
    {values.map((value, index) => <div key={index} className="space-y-1 rounded-lg bg-slate-50 p-2">
      <Field label={`${itemLabel} ${index + 1}`}><Input value={value} maxLength={maxLength} onChange={e => onChange(values.map((v, i) => i === index ? e.target.value : v))} /></Field>
      <Button className="px-2 py-1 text-xs" variant="secondary" aria-label={`Remove ${itemLabel.toLowerCase()} ${index + 1}`} onClick={() => onChange(values.filter((_, i) => i !== index))}>Remove</Button>
    </div>)}
    <Button variant="secondary" disabled={values.length >= limit} onClick={() => onChange([...values, ''])}>{addLabel}</Button>
    {values.length >= limit && <p className="text-xs text-slate-500">Up to {limit} entries are supported.</p>}
    {children}
  </fieldset>;
}

export function defaultScope(question: string, context: MappingContext): MappingScope {
  const intent = questionMeaning(question)?.intent;
  if (intent && !['source', 'employmentHistory', 'relocation'].includes(intent)) return 'all';
  return context.company && !/^(unknown|company)$/i.test(context.company) ? `company:${companyKey(context.company)}` : `application:${applicationKey(context.url)}`;
}

export function draftForCapture(capture: CapturedAnswer, context: MappingContext): MappingDraft {
  const meaning = questionMeaning(capture.label);
  return { question: capture.label, aliases: [], scope: defaultScope(capture.label, context),
    target: capture.selectionMode === 'multiple' ? { kind: 'answers', selections: (capture.values ?? []).map(value => ({ value, aliases: [] })) } : { kind: 'answer', value: capture.value },
    ...(meaning ? { meaning } : {}) };
}

export function MappingEditor({ initial, id, capture, context, onSaved, onCancel }: {
  initial: MappingDraft; id?: number; capture?: CapturedAnswer; context?: MappingContext;
  onSaved(id: number): void | Promise<void>; onCancel(): void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    const control = form?.querySelector<HTMLElement>('textarea, input:not([type="checkbox"]), select');
    control?.focus({ preventScroll: true });
    const box = control?.getBoundingClientRect();
    if (box && (box.top < 0 || box.bottom > window.innerHeight)) control?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, []);
  const [question, setQuestion] = useState(initial.question);
  const [aliases, setAliases] = useState(initial.aliases);
  const [answerAliases, setAnswerAliases] = useState(initial.answerAliases ?? []);
  const [scope, setScope] = useState(initial.scope);
  const [kind, setKind] = useState(initial.target.kind);
  const [answer, setAnswer] = useState(initial.target.kind === 'answer' ? initial.target.value : '');
  const [selections, setSelections] = useState<AnswerSelection[]>(initial.target.kind === 'answers' ? initial.target.selections : []);
  const [profileKey, setProfileKey] = useState<RememberableProfileKey | ''>(initial.target.kind === 'profile' ? initial.target.key : '');
  const [equivalent, setEquivalent] = useState(id ? !!initial.meaning : !!questionMeaning(initial.question));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (error) formRef.current?.querySelector('[role="alert"]')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [error]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionQuestion, setSuggestionQuestion] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const profile = useLiveQuery(getProfile);
  const records = useLiveQuery(getRememberedMappings);
  const [testQuestion, setTestQuestion] = useState('');
  const [testDropdown, setTestDropdown] = useState(false);
  const [testMultiple, setTestMultiple] = useState(initial.target.kind === 'answers');
  const [testOptions, setTestOptions] = useState<string[]>([]);
  const [otherApplication, setOtherApplication] = useState(false);
  const sample = previewContextFor(scope, context);
  const [testCompany, setTestCompany] = useState(sample.company);
  const [testUrl, setTestUrl] = useState(sample.url);
  const [preview, setPreview] = useState<{ key: string; result: AnswerPreview; profile?: Profile; records: RememberedMapping[] }>();
  const meaning = questionMeaning(question);

  function draft() {
    return { question, aliases: aliases.map(q => q.trim()).filter(Boolean), scope,
      target: kind === 'profile' ? { kind, key: profileKey } : kind === 'answers' ? { kind, selections } : { kind, value: answer },
      ...(equivalent && meaning ? { meaning } : {}),
      // Custom labels describe a fixed answer. Profile links use the latest fact's local equivalents.
      answerAliases: kind === 'answer' ? answerAliases.map(q => q.trim()).filter(Boolean) : [] };
  }
  // Compare live data references rather than serialize the whole knowledge base on every keystroke.
  const previewKey = JSON.stringify([draft(), testQuestion, testDropdown, testMultiple, testOptions, otherApplication, testCompany, testUrl]);
  const profileValue = profile && profileKey ? valueFor(profileKey, profile, { label: question })?.[0] : undefined;

  async function save() {
    setBusy(true); setError('');
    try {
      const mapping = parseMappingDraft(draft());
      const res = await sendToBackground('saveRememberedMapping', { mapping, id });
      if (!res.ok) throw new Error(res.error);
      await onSaved(res.id);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save this answer.'); }
    finally { setBusy(false); }
  }
  const pageChoices = capture?.options ?? [];
  async function suggest() {
    setSuggestionQuestion(question);
    setSuggesting(true); setError(''); setSuggestions([]);
    try {
      const res = await sendToBackground('suggestAnswerWordings', { question });
      if (!res.ok) throw new Error(res.error);
      setSuggestions(res.aliases);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load suggestions.'); }
    finally { setSuggesting(false); }
  }
  function checkMatching() {
    if (records === undefined) return;
    const example = otherApplication ? { company: testCompany, url: testUrl, platform: platformFor(testUrl) } : sample;
    const result = previewSavedAnswer(draft() as MappingDraft, testQuestion, testDropdown ? testOptions.map(o => o.trim()).filter(Boolean) : null, example, profile, records, id, testMultiple);
    setPreview({ key: previewKey, result, profile, records });
  }
  function changeKind(linked: boolean) {
    if (!linked && !answer && profileValue) setAnswer(profileValue);
    setKind(linked ? 'profile' : 'answer');
  }
  const previewResult = preview?.key === previewKey && preview.profile === profile && preview.records === records ? preview.result : undefined;
  return (
    <form ref={formRef} aria-label={capture ? 'Confirm page answer' : id ? 'Edit memory' : 'New memory'} aria-busy={busy} className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3" onSubmit={e => { e.preventDefault(); if (!busy) void save(); }}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{capture ? 'Confirm your answer' : id ? 'Editing memory' : 'New memory'}</p>
        <p className="mt-1 font-medium text-slate-900 break-words">{capture?.label ?? (question || 'New question')}</p>
        {capture && <p className="mt-1 text-xs text-slate-600">{capture.value || capture.values?.length ? 'Read from the field you selected. Save only if this is reusable.' : 'Answer on the page and capture again, or choose an answer below.'}</p>}
        {capture && id && question !== capture.label && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-slate-700"><p className="font-semibold">Compare with your saved question:</p><p className="mt-1">{question}</p><p className="mt-1">Save only if both questions need the same answer. Saving approves the new wording for future use.</p></div>}
      </div>
      {!capture && id === undefined && <Field label="Question" required><Textarea value={question} maxLength={700} required onChange={e => setQuestion(e.target.value)} /></Field>}
      {!capture && kind !== 'profile' && <label className="flex gap-2 text-sm"><input type="checkbox" checked={kind === 'answers'} onChange={e => setKind(e.target.checked ? 'answers' : 'answer')} />Remember several selections for this question</label>}
      {kind === 'answers' ? <fieldset className="space-y-3"><legend className="font-medium">Your selected answers ({selections.length})</legend>
        {!!pageChoices.length && <div className="space-y-2">{pageChoices.map(option => <label key={option} className="flex gap-2 text-sm"><input type="checkbox" checked={selections.some(s => s.value === option)} onChange={e => setSelections(e.target.checked ? [...selections, { value: option, aliases: [] }] : selections.filter(s => s.value !== option))} />{option}</label>)}</div>}
        {selections.map((selection, i) => <div key={i} className="space-y-1 rounded-lg bg-white p-2"><Field label={`Selected answer ${i + 1}`}><Input value={selection.value} maxLength={1000} required onChange={e => setSelections(selections.map((s, j) => j === i ? { ...s, value: e.target.value } : s))} /></Field><Button variant="secondary" aria-label={`Remove selected answer ${i + 1}`} onClick={() => setSelections(selections.filter((_, j) => i !== j))}>Remove</Button></div>)}
        <Button variant="secondary" disabled={selections.length >= 20} onClick={() => setSelections([...selections, { value: '', aliases: [] }])}>Add selected answer</Button>
        <p className="text-xs text-slate-600">Each row is one selection. Existing page selections are kept when saving.</p>
      </fieldset> : kind === 'answer' ? (
        <Field label="Your answer" required>
          {pageChoices.length && (!answer || pageChoices.includes(answer)) ?
            <Select value={answer} required onChange={e => setAnswer(e.target.value)} options={[[ '', 'Choose an answer' ], ...pageChoices.map(o => [o, o] as [string, string])]} /> :
            <Textarea value={answer} maxLength={10000} required onChange={e => setAnswer(e.target.value)} />}
        </Field>
      ) : <div className="space-y-2">
        <Field label="Use this profile detail" required><Select required value={profileKey} onChange={e => setProfileKey(e.target.value as RememberableProfileKey)} options={[[ '', 'Choose a profile detail' ], ...Object.entries(REMEMBERABLE_PROFILE_FIELDS)]} /></Field>
        <p className="text-xs text-slate-600">Current value: <strong>{profile ? profileValue || 'Not set in your profile' : 'Loading…'}</strong></p>
        <p className="text-xs text-slate-500">Updates in Settings → Profile will be used the next time you fill.</p>
      </div>}
      <ReuseScope value={scope} onChange={setScope} context={context} disabled={busy} />
      <p className="text-xs text-slate-600">{meaning && equivalent ? `Also match recognized questions about ${meaningDescription(meaning)}. Different conditions stay separate.` : 'Match this question and variations you approve. Unfamiliar questions will ask you to confirm.'}</p>
      <details className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-slate-800">Improve future matching</summary>
        <div className="mt-3 space-y-4">
          <p className="text-xs text-slate-600">Optional. Your answer can be saved without adding variations.</p>
          {meaning && <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
            <input className="mt-0.5" type="checkbox" checked={equivalent} onChange={e => setEquivalent(e.target.checked)} />
            <span>Match recognized equivalent questions<span className="mt-1 block text-slate-600">About {meaningDescription(meaning)}. Different conditions stay separate; unfamiliar wording still needs your confirmation.</span></span>
          </label>}
          <VariationList title="Other ways this question is asked" description="Add another question that asks for the same information. Saving approves it for future use." example={'Example: “Are you a US citizen?” and “Can you confirm you are a US citizen?” Ask about the same person and conditions.'} itemLabel="Question wording" addLabel="Add wording" values={aliases} onChange={setAliases}>
            <details className="pt-2 text-xs">
              <summary className="cursor-pointer text-indigo-700">Get optional AI suggestions</summary>
              <p className="my-2 text-slate-600">Sends only this question to Gemini. Your answer and profile stay local. Select each suggestion you want to approve; nothing is added automatically.</p>
              <Button variant="secondary" disabled={suggesting || !question.trim()} onClick={() => void suggest()}>{suggesting ? 'Suggesting…' : 'Suggest question variations'}</Button>
              {suggestionQuestion === question && suggestions.length > 0 && <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2"><p className="font-medium">Approve only questions that mean the same thing:</p>{suggestions.map(q => <label key={q} className="flex items-start gap-2"><input type="checkbox" disabled={!aliases.includes(q) && aliases.length >= 20} checked={aliases.includes(q)} onChange={e => setAliases(e.target.checked ? [...new Set([...aliases.filter(Boolean), q])] : aliases.filter(a => a !== q))} /><span>{q}</span></label>)}</div>}
            </details>
          </VariationList>
          {kind === 'answers' ? selections.map((selection, index) => <VariationList key={index} title={`Other labels for ${selection.value || `answer ${index + 1}`}`} description="Add only labels that mean this one selection." itemLabel={`Answer ${index + 1} label`} addLabel={`Add label for answer ${index + 1}`} values={selection.aliases} maxLength={1000} onChange={aliases => setSelections(selections.map((s, i) => i === index ? { ...s, aliases } : s))} />) : kind === 'answer' ? <VariationList title="Other labels for this answer" description={`Add dropdown labels that mean exactly the same as “${answer || 'your answer'}”. These are answer choices, not questions.`} example={'Example: “BS” and “Bachelor of Science”. Don’t add “Bachelor of Arts” or a different answer.'} itemLabel="Answer label" addLabel="Add answer label" values={answerAliases} onChange={setAnswerAliases} /> : <p className="text-xs text-slate-600">Dropdown labels follow your current profile value. To add custom labels for a fixed answer, turn off the profile link below.</p>}
          {kind !== 'answers' && <fieldset className="min-w-0 space-y-2 rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold text-slate-800">Keep this answer linked to my profile</legend>
            <label className="flex items-start gap-2 text-xs text-slate-700"><input className="mt-0.5" type="checkbox" checked={kind === 'profile'} onChange={e => changeKind(e.target.checked)} /><span>Use a value from my profile<span className="mt-1 block text-slate-600">For details that may change, like your phone number. Pick the profile detail above; we’ll use its latest saved value.</span></span></label>
            {!!answerAliases.length && <p className="text-xs text-slate-500">Custom answer labels apply only to a fixed answer. A profile link uses current profile equivalents instead.</p>}
          </fieldset>}
          {(capture || id !== undefined) && <details className="text-xs"><summary className="cursor-pointer font-medium text-slate-700">Edit original question</summary><div className="mt-2"><Field label="Original question" required hint="Changes which question this memory matches. Add a wording above to keep the original question too."><Textarea value={question} maxLength={700} required onChange={e => { setQuestion(e.target.value); setSuggestions([]); }} /></Field></div></details>}
        </div>
      </details>
      <details className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-slate-800">Try a variation</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-600">Check an example before saving. This stays on your device and does not fill a page.</p>
          <Field label="Question to try"><Input value={testQuestion} maxLength={700} placeholder="Paste a question from another application" onChange={e => setTestQuestion(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={testDropdown} onChange={e => setTestDropdown(e.target.checked)} />This question has a dropdown</label>
          {testDropdown && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={testMultiple} onChange={e => setTestMultiple(e.target.checked)} />This question allows several selections</label>}
          {testDropdown && <VariationList title="Choices in the example dropdown" description="Include all choices so we can check for ambiguity. These choices are for testing; they won't be saved as variations." itemLabel="Dropdown choice" addLabel="Add dropdown choice" values={testOptions} onChange={setTestOptions} limit={200} maxLength={1000} />}
          <p className="text-xs text-slate-600 break-words">{context ? 'Application:' : 'Example application:'} {sample.company || 'Unnamed company'} · {sample.url}</p>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={otherApplication} onChange={e => { setOtherApplication(e.target.checked); if (e.target.checked) { setTestCompany(sample.company); setTestUrl(sample.url); } }} />Test another company or application</label>
          {otherApplication && <div className="space-y-2"><Field label="Example company"><Input value={testCompany} maxLength={200} onChange={e => setTestCompany(e.target.value)} /></Field><Field label="Example application URL"><Input inputMode="url" value={testUrl} maxLength={2000} onChange={e => setTestUrl(e.target.value)} /></Field></div>}
          <Button variant="secondary" disabled={records === undefined || !testQuestion.trim()} onClick={checkMatching}>Check matching</Button>
          {previewResult && <div role="status" aria-live="polite"><Notice tone={previewResult.outcome === 'fill' ? 'success' : previewResult.outcome === 'confirm' ? 'warn' : 'info'}><p className="font-semibold">{previewResult.outcome === 'fill' ? 'Would autofill' : previewResult.outcome === 'confirm' ? 'Would ask you to confirm' : 'Would skip'}</p>{previewResult.answer && <p className="mt-1 whitespace-pre-wrap break-words">Answer: {previewResult.answer}</p>}<p className="mt-1">{previewResult.reason}</p></Notice></div>}
          <p className="text-xs text-slate-500">Checks this memory’s matching rules. A real page still needs a supported field, no existing answer, and successful verification.</p>
        </div>
      </details>
      <p className="text-xs text-slate-500">Saved locally. Existing page answers are kept.</p>
      {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
      <div className="sticky bottom-0 flex flex-wrap gap-2 rounded-lg border border-indigo-100 bg-white p-2 shadow-sm">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : capture ? 'Save & apply' : 'Save memory'}</Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/** Settings owns browsing and management; the sidebar owns capture and confirmation. */
export function MemoryLibrary({ context, questions = [] }: { context?: MappingContext; questions?: string[] }) {
  const mappings = useLiveQuery(getRememberedMappings);
  const root = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState<RememberedMapping | 'new' | null>(null);
  const [removing, setRemoving] = useState<number>();
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MemoryFilter>('all');
  const [sort, setSort] = useState<MemorySort>('updated');
  const [all, setAll] = useState(!context);

  const questionKey = JSON.stringify(questions);
  const pageRecords = useMemo(() => context ? memoriesForPage(mappings ?? [], questions, context) : mappings ?? [],
    [mappings, context?.platform, context?.company, context?.url, questionKey]);
  const available = all ? mappings ?? [] : pageRecords;
  const filtered = useMemo(() => browseMemories(available, search, filter, sort), [available, search, filter, sort]);
  // Another open extension window can change/delete a record. Keep the draft reachable until Cancel.
  const visible = editing && editing !== 'new' && !filtered.some(m => m.id === editing.id) ? [...filtered, editing] : filtered;
  const locked = !!editing || removing !== undefined;
  function focusAction(id?: number) {
    requestAnimationFrame(() => {
      const action = id === undefined ? null : root.current?.querySelector<HTMLElement>(`[data-memory-id="${id}"] [data-memory-edit]`);
      (action ?? root.current?.querySelector<HTMLElement>('[data-memory-search]'))?.focus({ preventScroll: true });
    });
  }
  function beginEdit(memory: RememberedMapping | 'new') {
    setEditing(memory); setError(''); setFeedback('');
  }
  function cancelEdit() {
    const id = editing && editing !== 'new' ? editing.id : undefined;
    setEditing(null); setFeedback('Changes canceled. Your memory was kept.'); focusAction(id);
  }
  async function remove(memory: RememberedMapping) {
    setRemoving(memory.id); setError(''); setFeedback('');
    try {
      const res = await sendToBackground('removeRememberedMapping', { id: memory.id });
      if (!res.ok) throw new Error(res.error);
      setFeedback('Memory deleted. The answer on your page was kept.'); focusAction();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete this memory.'); }
    finally { setRemoving(undefined); }
  }
  function editor(memory: RememberedMapping | 'new') {
    return <MappingEditor key={memory === 'new' ? 'new' : memory.id} id={memory === 'new' ? undefined : memory.id}
      initial={memory === 'new' ? { question: '', aliases: [], scope: 'all', target: { kind: 'answer', value: '' } } : memory}
      onCancel={cancelEdit} onSaved={id => { setEditing(null); setFeedback(context ? 'Memory saved for future fills. Your page answer was kept.' : 'Memory saved.'); focusAction(id); }} />;
  }
  return <section ref={root} aria-label={context ? 'Page memories' : 'Memory library'} className={`min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white shadow-sm ${context ? 'p-4' : 'p-5'}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1"><h2 className={context ? 'font-semibold text-slate-900' : 'text-base font-semibold text-slate-900'}>{context ? 'Memories for This Page' : 'Memories'}</h2>
        <p className={context ? 'mt-1 text-xs text-slate-600' : 'mt-0.5 text-sm text-slate-500'}>{context ? 'Edit or delete a remembered answer here. Changes apply to future fills.' : 'Answers you confirmed for future applications. Search, edit or delete them here.'}</p></div>
      {!context && <Button variant="secondary" disabled={locked} onClick={() => beginEdit('new')}>Add memory</Button>}
    </div>
    {context && <div className="flex flex-wrap gap-2" role="group" aria-label="Memories to show">
      <Button variant={!all ? 'primary' : 'secondary'} aria-pressed={!all} disabled={locked} onClick={() => { setAll(false); }}>This page ({pageRecords.length})</Button>
      <Button variant={all ? 'primary' : 'secondary'} aria-pressed={all} disabled={locked} onClick={() => { setAll(true); }}>All memories ({mappings?.length ?? 0})</Button>
    </div>}
    <div className="space-y-3">
      <Field label="Search memories"><Input data-memory-search value={search} disabled={locked} onChange={e => { setSearch(e.target.value); }} placeholder="Search questions, answers or companies" /></Field>
      <div className="flex flex-wrap items-end gap-2">
        <Field className="min-w-0 flex-1" label="Answer type"><Select disabled={locked} value={filter} onChange={e => { setFilter(e.target.value as MemoryFilter); }} options={[[ 'all', 'All types' ], [ 'answer', 'One answer' ], [ 'answers', 'Several selections' ], [ 'profile', 'Linked to profile' ]]} /></Field>
        {!context && <Field className="min-w-0 flex-1" label="Sort by"><Select disabled={locked} value={sort} onChange={e => setSort(e.target.value as MemorySort)} options={[[ 'updated', 'Recently updated' ], [ 'question', 'Question A–Z' ], [ 'used', 'Recently used' ]]} /></Field>}
        {(search || filter !== 'all') && <Button variant="ghost" disabled={locked} onClick={() => { setSearch(''); setFilter('all'); focusAction(); }}>Clear filters</Button>}
      </div>
      <p role="status" className="text-xs text-slate-500">{mappings === undefined ? 'Loading memories…' : `${filtered.length} of ${available.length} ${available.length === 1 ? 'memory' : 'memories'}${context && !all ? ' for this page' : ''}`}{editing ? ' · Finish editing to change filters.' : ''}</p>
    </div>
    {editing === 'new' && editor('new')}
    {mappings !== undefined && available.length === 0 && !editing && <p className="text-sm text-slate-600">{context && !all ? 'No memories match this page yet. Remember an answer above, or browse All memories.' : 'No memories yet. Answer a missing question on an application, then select Remember answer in the sidebar.'}</p>}
    {!!available.length && !visible.length && <p className="text-sm text-slate-600">No memories match these filters. Try fewer words or clear the filters.</p>}
    <ul aria-label="Memories" className="space-y-3">{visible.map(m => <li key={m.id} data-memory-id={m.id} className="min-w-0 rounded-xl border border-slate-200 p-3 text-sm">
      {editing !== 'new' && editing?.id === m.id ? editor(editing) : <>
        <p className="font-semibold text-slate-900 break-words">{m.question}</p>
        <div className="mt-2 rounded-lg bg-slate-50 p-2"><p className="text-xs font-medium text-slate-500">{m.target.kind === 'profile' ? 'Linked profile detail' : m.target.kind === 'answers' ? `${m.target.selections.length} remembered selections` : 'Remembered answer'}</p><p className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words text-slate-800">{targetText(m.target)}</p></div>
        <p className="mt-2 break-words text-xs font-medium text-indigo-700">{scopeLabel(m.scope)}</p>
        <p className="mt-1 text-xs text-slate-500">{m.meaning ? 'Recognized variations' : 'Approved wording'} · {m.lastUsed ? `Last used ${new Date(m.lastUsed).toLocaleDateString()}` : 'Not applied yet'}</p>
        {!!m.aliases.length && <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer">Approved variations ({m.aliases.length})</summary><ul className="mt-2 space-y-1">{m.aliases.map(q => <li key={q} className="break-words">{q}</li>)}</ul></details>}
        <div className="mt-3 flex gap-2"><Button data-memory-edit variant="secondary" disabled={locked} onClick={() => beginEdit(m)}>Edit</Button><Button variant="secondary" disabled={locked} onClick={async () => { if (await confirmDelete('Delete this memory?', m.question + ' — It will no longer autofill. Your current page answer will stay.', 'Delete memory')) await remove(m); else { setFeedback('Deletion canceled. Your memory was kept.'); focusAction(m.id); } }}>Delete</Button></div>
      </>}
    </li>)}</ul>
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
    {feedback && <div className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-sm rounded-lg bg-white shadow-lg"><Notice tone="success"><div className="flex items-start gap-2"><p role="status" aria-live="polite" className="flex-1">{feedback}</p><button aria-label="Dismiss memory notification" className="rounded px-1 font-semibold focus-visible:ring-2 focus-visible:ring-indigo-500" onClick={() => setFeedback('')}>×</button></div></Notice></div>}
  </section>;
}

export function KnowledgeSection() { return <MemoryLibrary />; }
