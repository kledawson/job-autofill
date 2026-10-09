import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { db, getProfile } from '@/lib/db';
import { deletePreset, listPresets, savePreset, selectedPresetId, selectPreset } from '@/lib/preset-db';
import { defaultPreset, DEFAULT_PRESET_ID, type ApplicationPreset, type PresetDocument } from '@/lib/presets';
import { useLiveQuery } from './hooks';
import { Button, Card, Field, Input, Notice, Select, Textarea, cx } from './ui';
import { confirmDelete } from './confirm-delete';

export function PresetSelector({ onSelected }: { onSelected?: (id: string | undefined) => void }) {
  const data = useLiveQuery(async () => {
    const presets = await listPresets(), selected = await selectedPresetId();
    const preset = presets.find(p => p.id === selected) ?? defaultPreset();
    const file = preset.resume === 'profile' ? await db.files.get('resume') : preset.resume === 'none' ? null : await db.presetFiles.get(preset.resume);
    return { presets, selected, resumeName: file?.name, missing: preset.resume !== 'none' && preset.resume !== 'profile' && !file };
  });
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  useEffect(() => { if (data) onSelected?.(data.selected); }, [data?.selected]);
  return <section className="space-y-2 rounded-xl border border-indigo-200 bg-white p-4 shadow-sm" aria-label="Application preset">
    <div className="flex items-center justify-between gap-2">
      <label htmlFor="application-preset" className="font-semibold text-slate-800">Application preset</label>
      <button className="text-xs font-medium text-indigo-700 underline" onClick={() => browser.tabs.create({ url: browser.runtime.getURL('/options.html#presets' as never) })}>Manage presets</button>
    </div>
    <Select id="application-preset" value={data?.selected ?? DEFAULT_PRESET_ID} disabled={!data || saving}
      options={(data?.presets ?? [defaultPreset()]).map(p => [p.id, p.name])}
      onChange={async e => {
        setSaving(true); setError(''); onSelected?.(undefined);
        try { await selectPreset(e.target.value); onSelected?.(e.target.value); }
        catch (err) { setError(err instanceof Error ? err.message : 'Could not select this preset.'); onSelected?.(data?.selected); }
        finally { setSaving(false); }
      }} />
    <p className="break-words text-xs text-slate-600"><span className="font-medium">Resume: </span>{data?.resumeName ?? (data?.missing ? 'Missing — edit this preset' : 'No resume selected')}</p>
    <p className="text-xs text-slate-500">Used for your next fill. Existing page answers stay as they are.</p>
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
  </section>;
}

export function PresetsSection({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const rows = useLiveQuery(listPresets);
  const selected = useLiveQuery(selectedPresetId);
  const files = useLiveQuery(() => db.presetFiles.toArray()) ?? [];
  const sharedFiles = useLiveQuery(() => db.files.toArray()) ?? [];
  const profile = useLiveQuery(getProfile);
  const [editing, setEditing] = useState<{ draft: ApplicationPreset; expected?: number }>();
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  function start(p?: ApplicationPreset, duplicate = false) {
    setError(''); setNotice('');
    const draft = structuredClone(p ?? defaultPreset());
    if (!p || duplicate) { draft.id = crypto.randomUUID(); draft.name = p ? p.name + ' copy' : ''; draft.revision = 1; }
    setEditing({ draft, expected: p && !duplicate ? p.revision : undefined });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  const fileName = (choice: string, kind: string) => choice === 'none' ? 'None' :
    choice === 'profile' ? (sharedFiles.find(f => f.kind === kind)?.name ?? 'No shared document uploaded') :
    files.find(f => f.id === choice)?.name ?? 'Missing document — edit preset';
  if (editing) return <PresetEditor key={editing.draft.id} initial={editing.draft} expected={editing.expected}
    onDirtyChange={onDirtyChange} files={files} sharedFiles={sharedFiles} profileLinks={profile ? { portfolio: profile.portfolio, github: profile.github, website: profile.website } : { portfolio: '', github: '', website: '' }}
    onCancel={() => setEditing(undefined)} onSaved={p => { setEditing(undefined); setNotice(p.name + ' saved and selected for your next application.'); }} />;
  return <Card title="Application presets" description="Choose a resume and responses for each kind of role. Your personal Profile stays shared.">
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-sm text-slate-600">Create Software Engineer and Hardware Engineer presets, then switch between them in the sidebar.</p>
        <Button onClick={() => start()}>Create preset</Button>
      </div>
      <div className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        <strong className="text-slate-800">Shared from your Profile:</strong> name, contact details, education, work history, skills and eligibility answers. Personal Memories and transcript are shared too.
      </div>
      {notice && <div role="status"><Notice tone="success">{notice}</Notice></div>}
      {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
      <ul className="space-y-3">
        {rows?.map(p => <li key={p.id} className={cx('rounded-xl border p-4', p.id === selected ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200 bg-white')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-900">{p.name}</h3>
            {p.id === selected && <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-800">Selected for next fill</span>}
          </div>
          <dl className="my-3 space-y-1 break-words text-xs text-slate-600">
            <div><dt className="inline font-medium">Resume: </dt><dd className="inline">{fileName(p.resume, 'resume')}{p.resume === 'profile' ? ' · shared document' : ''}</dd></div>
            <div><dt className="inline font-medium">Cover letter: </dt><dd className="inline">{fileName(p.coverLetter, 'coverLetter')}</dd></div>
            <div><dt className="inline font-medium">Prepared responses: </dt><dd className="inline">{p.responses.length}</dd></div>
            {p.emphasis && <div><dt className="inline font-medium">Writing focus: </dt><dd className="inline">{p.emphasis.slice(0, 160)}{p.emphasis.length > 160 ? '…' : ''}</dd></div>}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button variant={p.id === selected ? 'secondary' : 'primary'} disabled={busy || p.id === selected} onClick={async () => {
              setBusy(true); setError('');
              try { await selectPreset(p.id); setNotice(p.name + ' selected for your next application.'); }
              catch (err) { setError((err as Error).message); } finally { setBusy(false); }
            }}>{p.id === selected ? 'Selected' : 'Use preset'}</Button>
            <Button variant="secondary" onClick={() => start(p)}>Edit</Button>
            <Button variant="secondary" onClick={() => start(p, true)}>Duplicate</Button>
            {p.id !== DEFAULT_PRESET_ID && <Button variant="ghost" disabled={busy} onClick={async () => {
              if (!await confirmDelete('Delete ' + p.name + '?', 'Applications already filled keep their preset details. Shared Profile and Memories are kept. If selected, Default becomes your next preset.', 'Delete preset')) return;
              setBusy(true); setError('');
              try { await deletePreset(p.id, p.revision); setNotice(p.name + ' deleted.'); }
              catch (err) { setError((err as Error).message); } finally { setBusy(false); }
            }}>Delete</Button>}
          </div>
        </li>)}
      </ul>
    </div>
  </Card>;
}

function PresetEditor({ initial, expected, files, sharedFiles, profileLinks, onCancel, onSaved, onDirtyChange }: {
  initial: ApplicationPreset; expected?: number; files: PresetDocument[];
  sharedFiles: { kind: string; name: string }[];
  profileLinks: Record<'portfolio' | 'github' | 'website', string>;
  onCancel: () => void; onSaved: (preset: ApplicationPreset) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(initial), [uploads, setUploads] = useState<PresetDocument[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || uploads.length > 0;
  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const update = (patch: Partial<ApplicationPreset>) => { setDraft(p => ({ ...p, ...patch })); setError(''); };
  function cancel() { if (!dirty || window.confirm('Discard your unsaved preset changes?')) onCancel(); }
  async function upload(file: File | undefined, kind: 'resume' | 'coverLetter') {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) || file.size === 0 || file.size > 10 * 1024 * 1024) { setError('Choose a PDF between 1 byte and 10 MB.'); return; }
    const document = { id: crypto.randomUUID(), name: file.name, type: 'application/pdf', blob: file, updatedAt: Date.now() };
    setUploads(current => [...current, document]); update({ [kind]: document.id });
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const used = new Set([draft.resume, draft.coverLetter]);
      const saved = await savePreset(draft, expected, uploads.filter(f => used.has(f.id)));
      await selectPreset(saved.id);
      onSaved(saved);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save this preset.'); }
    finally { setBusy(false); }
  }
  const documents = [...files, ...uploads];
  return <section className="space-y-4" aria-label="Edit application preset">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 ref={title} tabIndex={-1} className="text-xl font-semibold outline-none">{expected ? 'Edit preset' : 'Create preset'}</h2>
        <p className="mt-1 text-sm text-slate-500">Personal facts stay in your Profile. Customize what you present for this role.</p></div>
      <Button variant="secondary" disabled={busy} onClick={cancel}>Back to presets</Button>
    </div>
    <Card title="1. Name your preset" description="Use the role you are applying for.">
      <Field label="Preset name" required><Input value={draft.name} maxLength={80} onChange={e => update({ name: e.target.value })} placeholder="Software Engineer" /></Field>
    </Card>
    <Card title="2. Choose your documents" description="These files are used whenever you fill with this preset.">
      <div className="space-y-5">
        {(['resume', 'coverLetter'] as const).map(kind => {
          const label = kind === 'resume' ? 'Resume' : 'Cover letter';
          const shared = sharedFiles.find(f => f.kind === kind);
          return <div key={kind} className="space-y-2">
            <Field label={label} hint={draft[kind] === 'profile' ? 'Changes in Settings → Documents also update this shared choice.' : draft[kind] === 'none' ? 'Upload fields will be left for you.' : 'This preset keeps its own document choice.'}>
              <Select value={draft[kind]} onChange={e => update({ [kind]: e.target.value })} options={[
                ['profile', 'Use shared ' + label.toLowerCase() + (shared ? ' — ' + shared.name : ' — not uploaded')],
                ['none', 'No ' + label.toLowerCase()],
                ...documents.map(f => [f.id, f.name] as [string, string]),
              ]} />
            </Field>
            <label className="inline-flex cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-indigo-500">
              Upload {label.toLowerCase()} for this preset
              <input aria-label={'Upload ' + label.toLowerCase() + ' for this preset'} type="file" accept="application/pdf,.pdf" className="sr-only" disabled={busy}
                onChange={e => { void upload(e.target.files?.[0], kind); e.target.value = ''; }} />
            </label>
            <p className="text-xs text-slate-500">PDF · up to 10 MB · saved when you save the preset</p>
          </div>;
        })}
      </div>
    </Card>
    <Card title="3. Tailor your responses" description="Optional. Use a prepared answer directly, or guide Gemini when it writes a new answer.">
      <div className="space-y-5">
        <Field label="AI writing focus" hint="Only used if Gemini is connected. Describe what to emphasize from your existing Profile; this does not add skills or qualifications.">
          <Textarea rows={3} maxLength={4000} value={draft.emphasis} onChange={e => update({ emphasis: e.target.value })} placeholder="Emphasize my robotics and hardware experience. Connect my saved projects to the role." />
        </Field>
        <div className="space-y-3">
          <div><h3 className="text-sm font-semibold">Prepared responses</h3>
            <p className="mt-1 text-xs text-slate-500">Used before AI for matching text questions. They apply only to this preset and do not change personal Memories or Profile facts.</p></div>
          {draft.responses.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">No prepared responses yet. You can leave this empty.</p>}
          {draft.responses.map((r, index) => {
            const change = (patch: Partial<typeof r>) => update({ responses: draft.responses.map((row, i) => i === index ? { ...row, ...patch } : row) });
            return <div key={index} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-medium">Response {index + 1}</h4>
                <Button variant="ghost" aria-label={'Remove response ' + (index + 1)} onClick={() => update({ responses: draft.responses.filter((_, i) => i !== index) })}>Remove</Button></div>
              <Field label="Application question"><Input value={r.question} maxLength={700} onChange={e => change({ question: e.target.value })} placeholder="Tell us about your proudest accomplishment" /></Field>
              <Field label="Your prepared answer"><Textarea rows={4} value={r.answer} maxLength={10000} onChange={e => change({ answer: e.target.value })} /></Field>
              <details className="text-xs text-slate-600"><summary className="cursor-pointer font-medium text-indigo-700">Use this answer for another wording</summary>
                <p className="my-2">Add only questions you want answered with exactly this response. New wording is not guessed automatically.</p>
                {r.aliases.map((alias, i) => <div key={i} className="my-2 flex gap-2"><Input aria-label={'Alternate wording ' + (i + 1) + ' for response ' + (index + 1)} value={alias} maxLength={700}
                  onChange={e => change({ aliases: r.aliases.map((a, j) => j === i ? e.target.value : a) })} />
                  <Button variant="ghost" aria-label={'Remove wording ' + (i + 1)} onClick={() => change({ aliases: r.aliases.filter((_, j) => j !== i) })}>Remove</Button></div>)}
                <Button variant="secondary" disabled={r.aliases.length >= 10} onClick={() => change({ aliases: [...r.aliases, ''] })}>Add another wording</Button>
              </details>
            </div>;
          })}
          <Button variant="secondary" disabled={draft.responses.length >= 20} onClick={() => update({ responses: [...draft.responses, { question: '', answer: '', aliases: [] }] })}>Add prepared response</Button>
        </div>
      </div>
    </Card>
    <Card title="4. Portfolio links" description="Optional. Use your Profile links or choose different links for this preset.">
      <div className="space-y-4">{(['portfolio', 'github', 'website'] as const).map(key => <div key={key}>
        <label className="mb-2 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={draft.links[key] === null}
          onChange={e => update({ links: { ...draft.links, [key]: e.target.checked ? null : profileLinks[key] } })} />
          Use my Profile {key === 'github' ? 'GitHub' : key} link</label>
        <Field label={(key === 'github' ? 'GitHub' : key === 'website' ? 'Website' : 'Portfolio') + ' link'} hint={draft.links[key] === null ? 'Shared from Profile.' : 'Leave blank to skip this link for this preset.'}>
          <Input type="url" disabled={draft.links[key] === null} value={draft.links[key] ?? profileLinks[key]} onChange={e => update({ links: { ...draft.links, [key]: e.target.value } })} placeholder="https://…" />
        </Field>
      </div>)}</div>
    </Card>
    <div className="sticky bottom-0 space-y-2 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
      {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-600">{dirty || expected === undefined ? 'Unsaved changes' : 'No changes yet'} · applies to future fills</p>
        <div className="flex gap-2"><Button variant="secondary" disabled={busy} onClick={cancel}>Cancel</Button>
          <Button disabled={busy || !draft.name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save and use preset'}</Button></div>
      </div>
    </div>
  </section>;
}
