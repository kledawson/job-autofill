import { useState } from 'react';
import { getProfile, getRememberedMappings } from '@/lib/db';
import { sendToBackground } from '@/lib/messages';
import { questionMeaning } from '@/lib/answer-semantics';
import { meaningDescription, previewContextFor, previewSavedAnswer, scopeDescription, type AnswerPreview } from '@/lib/saved-answer-preview';
import { platformFor } from '@/lib/platforms';
import { valueFor } from '@/lib/autofill/values';
import type { Profile } from '@/lib/types';
import { applicationKey, companyKey, scopeLabel, parseMappingDraft, REMEMBERABLE_PROFILE_FIELDS,
  type CapturedAnswer, type MappingContext, type MappingDraft, type MappingScope, type RememberableProfileKey, type RememberedMapping } from '@/lib/remembered-mappings';
import { useLiveQuery } from './hooks';
import { Button, Card, Field, Input, Notice, Select, Textarea } from './ui';

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
      <Button className="px-2 py-1 text-xs" variant="ghost" aria-label={`Remove ${itemLabel.toLowerCase()} ${index + 1}`} onClick={() => onChange(values.filter((_, i) => i !== index))}>Remove</Button>
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

export function MappingEditor({ initial, id, capture, context, onSaved, onCancel }: {
  initial: MappingDraft; id?: number; capture?: CapturedAnswer; context?: MappingContext;
  onSaved(id: number): void | Promise<void>; onCancel(): void;
}) {
  const [question, setQuestion] = useState(initial.question);
  const [aliases, setAliases] = useState(initial.aliases);
  const [answerAliases, setAnswerAliases] = useState(initial.answerAliases ?? []);
  const [scope, setScope] = useState(initial.scope);
  const [kind, setKind] = useState(initial.target.kind);
  const [answer, setAnswer] = useState(initial.target.kind === 'answer' ? initial.target.value : '');
  const [profileKey, setProfileKey] = useState<RememberableProfileKey | ''>(initial.target.kind === 'profile' ? initial.target.key : '');
  const [equivalent, setEquivalent] = useState(id ? !!initial.meaning : !!questionMeaning(initial.question));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionQuestion, setSuggestionQuestion] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const profile = useLiveQuery(getProfile);
  const records = useLiveQuery(getRememberedMappings);
  const [testQuestion, setTestQuestion] = useState('');
  const [testDropdown, setTestDropdown] = useState(false);
  const [testOptions, setTestOptions] = useState<string[]>([]);
  const [otherApplication, setOtherApplication] = useState(false);
  const sample = previewContextFor(scope, context);
  const [testCompany, setTestCompany] = useState(sample.company);
  const [testUrl, setTestUrl] = useState(sample.url);
  const [preview, setPreview] = useState<{ key: string; result: AnswerPreview; profile?: Profile; records: RememberedMapping[] }>();
  const meaning = questionMeaning(question);
  const choices: MappingScope[] = ['all'];
  if (context) {
    if (context.company && !/^(unknown|company)$/i.test(context.company)) choices.push(`company:${companyKey(context.company)}`);
    choices.push(`application:${applicationKey(context.url)}`, `site:${new URL(context.url).origin}`);
  } else {
    choices.push('company:', 'application:', 'site:');
  }
  const scopeSelection = !context && /^(company|application|site):/.test(scope) ? `${scope.split(':')[0]}:` as MappingScope : scope;
  if (!choices.includes(scopeSelection)) choices.push(scopeSelection);

  function draft() {
    return { question, aliases: aliases.map(q => q.trim()).filter(Boolean), scope,
      target: kind === 'profile' ? { kind, key: profileKey } : { kind, value: answer },
      ...(equivalent && meaning ? { meaning } : {}),
      // Custom labels describe a fixed answer. Profile links use the latest fact's local equivalents.
      answerAliases: kind === 'answer' ? answerAliases.map(q => q.trim()).filter(Boolean) : [] };
  }
  // Compare live data references rather than serialize the whole knowledge base on every keystroke.
  const previewKey = JSON.stringify([draft(), testQuestion, testDropdown, testOptions, otherApplication, testCompany, testUrl]);
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
    const result = previewSavedAnswer(draft() as MappingDraft, testQuestion, testDropdown ? testOptions.map(o => o.trim()).filter(Boolean) : null, example, profile, records, id);
    setPreview({ key: previewKey, result, profile, records });
  }
  function changeKind(linked: boolean) {
    if (!linked && !answer && profileValue) setAnswer(profileValue);
    setKind(linked ? 'profile' : 'answer');
  }
  const previewResult = preview?.key === previewKey && preview.profile === profile && preview.records === records ? preview.result : undefined;
  return (
    <form className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3" onSubmit={e => { e.preventDefault(); void save(); }}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{capture ? 'Confirm your answer' : 'Saved answer'}</p>
        <p className="mt-1 font-medium text-slate-900 break-words">{capture?.label ?? (question || 'New question')}</p>
        {capture && <p className="mt-1 text-xs text-slate-600">{capture.value ? 'Read from the field you selected. Save only if this is reusable.' : 'Answer on the page and capture again, or choose an answer below.'}</p>}
        {capture && id && question !== capture.label && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-slate-700"><p className="font-semibold">Compare with your saved question:</p><p className="mt-1">{question}</p><p className="mt-1">Save only if both questions need the same answer. Saving approves the new wording for future use.</p></div>}
      </div>
      {!capture && id === undefined && <Field label="Question" required><Textarea value={question} maxLength={700} required onChange={e => setQuestion(e.target.value)} /></Field>}
      {kind === 'answer' ? (
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
      <Field label="Where should this answer be reused?" hint={scopeDescription(scope)}>
        <Select value={scopeSelection} onChange={e => setScope(e.target.value as MappingScope)} options={choices.map(s => [s, s === 'company:' ? 'Specific company' : s === 'application:' ? 'Specific application' : s === 'site:' ? 'Specific site' : scopeLabel(s)])} />
      </Field>
      {!context && /^(company|application|site):/.test(scope) && <Field label={scope.startsWith('company:') ? 'Company name' : scope.startsWith('site:') ? 'Site URL' : 'Application URL'} required>
        <Input required type={scope.startsWith('company:') ? 'text' : 'url'} value={scope.slice(scope.indexOf(':') + 1)} onChange={e => setScope(`${scope.split(':')[0]}:${e.target.value}` as MappingScope)} />
      </Field>}
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
          {kind === 'answer' ? <VariationList title="Other labels for this answer" description={`Add dropdown labels that mean exactly the same as “${answer || 'your answer'}”. These are answer choices, not questions.`} example={'Example: “BS” and “Bachelor of Science”. Don’t add “Bachelor of Arts” or a different answer.'} itemLabel="Answer label" addLabel="Add answer label" values={answerAliases} onChange={setAnswerAliases} /> : <p className="text-xs text-slate-600">Dropdown labels follow your current profile value. To add custom labels for a fixed answer, turn off the profile link below.</p>}
          <fieldset className="min-w-0 space-y-2 rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold text-slate-800">Keep this answer linked to my profile</legend>
            <label className="flex items-start gap-2 text-xs text-slate-700"><input className="mt-0.5" type="checkbox" checked={kind === 'profile'} onChange={e => changeKind(e.target.checked)} /><span>Use a value from my profile<span className="mt-1 block text-slate-600">For details that may change, like your phone number. Pick the profile detail above; we’ll use its latest saved value.</span></span></label>
            {!!answerAliases.length && <p className="text-xs text-slate-500">Custom answer labels apply only to a fixed answer. A profile link uses current profile equivalents instead.</p>}
          </fieldset>
          {(capture || id !== undefined) && <details className="text-xs"><summary className="cursor-pointer font-medium text-slate-700">Edit original question</summary><div className="mt-2"><Field label="Original question" required hint="Changes which question this saved answer matches. Add a wording above to keep the original question too."><Textarea value={question} maxLength={700} required onChange={e => { setQuestion(e.target.value); setSuggestions([]); }} /></Field></div></details>}
        </div>
      </details>
      <details className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-slate-800">Try a variation</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-600">Check an example before saving. This stays on your device and does not fill a page.</p>
          <Field label="Question to try"><Input value={testQuestion} maxLength={700} placeholder="Paste a question from another application" onChange={e => setTestQuestion(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={testDropdown} onChange={e => setTestDropdown(e.target.checked)} />This question has a dropdown</label>
          {testDropdown && <VariationList title="Choices in the example dropdown" description="Include all choices so we can check for ambiguity. These choices are for testing; they won't be saved as variations." itemLabel="Dropdown choice" addLabel="Add dropdown choice" values={testOptions} onChange={setTestOptions} limit={200} maxLength={1000} />}
          <p className="text-xs text-slate-600 break-words">{context ? 'Application:' : 'Example application:'} {sample.company || 'Unnamed company'} · {sample.url}</p>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={otherApplication} onChange={e => { setOtherApplication(e.target.checked); if (e.target.checked) { setTestCompany(sample.company); setTestUrl(sample.url); } }} />Test another company or application</label>
          {otherApplication && <div className="space-y-2"><Field label="Example company"><Input value={testCompany} maxLength={200} onChange={e => setTestCompany(e.target.value)} /></Field><Field label="Example application URL"><Input inputMode="url" value={testUrl} maxLength={2000} onChange={e => setTestUrl(e.target.value)} /></Field></div>}
          <Button variant="secondary" disabled={records === undefined || !testQuestion.trim()} onClick={checkMatching}>Check matching</Button>
          {previewResult && <div role="status" aria-live="polite"><Notice tone={previewResult.outcome === 'fill' ? 'success' : previewResult.outcome === 'confirm' ? 'warn' : 'info'}><p className="font-semibold">{previewResult.outcome === 'fill' ? 'Would autofill' : previewResult.outcome === 'confirm' ? 'Would ask you to confirm' : 'Would skip'}</p>{previewResult.answer && <p className="mt-1 whitespace-pre-wrap break-words">Answer: {previewResult.answer}</p>}<p className="mt-1">{previewResult.reason}</p></Notice></div>}
          <p className="text-xs text-slate-500">Checks this saved answer’s matching rules. A real page still needs a supported field, no existing answer, and successful verification.</p>
        </div>
      </details>
      <p className="text-xs text-slate-500">Saved locally. Existing page answers are kept.</p>
      {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : capture ? 'Save & apply' : 'Save answer'}</Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function KnowledgeSection() {
  const mappings = useLiveQuery(getRememberedMappings);
  const [editing, setEditing] = useState<RememberedMapping | 'new' | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState('');
  const [removing, setRemoving] = useState<number>();
  async function remove(id: number) {
    setRemoving(id); setError(''); setSaved(false);
    try {
      const res = await sendToBackground('removeRememberedMapping', { id });
      if (!res.ok) throw new Error(res.error);
      if (editing !== 'new' && editing?.id === id) setEditing(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not remove this answer.'); }
    finally { setRemoving(undefined); }
  }
  const visible = mappings?.filter(m => `${m.question} ${m.aliases.join(' ')} ${scopeLabel(m.scope)} ${m.target.kind === 'answer' ? m.target.value : m.target.key}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <Card title="Saved answers" description="Your personal knowledge base. Capture a page answer, confirm where it applies, and reuse it."
      actions={<Button variant="secondary" onClick={() => { setEditing('new'); setSaved(false); }}>Add answer</Button>}>
      <div className="space-y-4">
        <Field label="Search saved answers"><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Question, answer, or company" /></Field>
        {saved && <div role="status"><Notice tone="success">Answer saved.</Notice></div>}
        {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
        {editing && <MappingEditor key={editing === 'new' ? 'new' : editing.id} id={editing === 'new' ? undefined : editing.id}
          initial={editing === 'new' ? { question: '', aliases: [], scope: 'all', target: { kind: 'answer', value: '' } } : editing}
          onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setSaved(true); }} />}
        {mappings === undefined ? <p>Loading answers…</p> : mappings.length === 0 ?
          <p className="text-sm text-slate-500">No saved answers yet. Fill a form, answer a missing question, then select Remember answer in the side panel.</p> :
          <ul className="space-y-3">{visible?.map(m => <li key={m.id} className="rounded-xl border border-slate-200 p-4 text-sm">
            <div className="flex items-start justify-between gap-2"><p className="font-medium text-slate-900 break-words">{m.question}</p><span className="shrink-0 rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-700">{m.meaning ? 'Recognized variations' : 'Approved wording'}</span></div>
            <p className="mt-2 whitespace-pre-wrap break-words text-slate-700">{m.target.kind === 'profile' ? `Profile → ${REMEMBERABLE_PROFILE_FIELDS[m.target.key]}` : m.target.value}</p>
            <p className="mt-2 text-xs text-slate-500">{scopeLabel(m.scope)} · {m.aliases.length} approved wordings · {m.lastUsed ? `Last used ${new Date(m.lastUsed).toLocaleDateString()}` : 'Not applied yet'}</p>
            {!!m.aliases.length && <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer">Approved variations</summary><ul>{m.aliases.map(q => <li key={q}>{q}</li>)}</ul></details>}
            <div className="mt-3 flex gap-2"><Button variant="secondary" onClick={() => { setEditing(m); setSaved(false); }}>Edit</Button><Button variant="danger" disabled={removing !== undefined} onClick={() => void remove(m.id)}>{removing === m.id ? 'Removing…' : 'Remove'}</Button></div>
          </li>)}</ul>}
        {visible?.length === 0 && !!mappings?.length && <p className="text-sm text-slate-500">No answers match your search.</p>}
      </div>
    </Card>
  );
}
