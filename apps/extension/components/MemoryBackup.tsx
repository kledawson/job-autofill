import { useRef, useState } from 'react';
import { getProfile } from '@/lib/db';
import { exportMemoryBackup, previewMemoryRestore, restoreMemoryBackup } from '@/lib/memory-backup-db';
import { MEMORY_BACKUP_MAX_BYTES, type RestoreChoice, type RestorePreview, type RestoreRow } from '@/lib/memory-backup';
import { scopeLabel, targetText, type MappingDraft } from '@/lib/remembered-mappings';
import { valueFor } from '@/lib/autofill/values';
import { meaningDescription } from '@/lib/saved-answer-preview';
import { useLiveQuery } from './hooks';
import { Button, Notice } from './ui';

const counted = (n: number, singular: string, plural = singular + 's') => n + ' ' + (n === 1 ? singular : plural);

export function MemoryBackupControls({ disabled, count, onActiveChange, onReviewChange }: {
  disabled: boolean; count: number; onActiveChange(active: boolean): void; onReviewChange(reviewing: boolean): void;
}) {
  const input = useRef<HTMLInputElement>(null), previewRoot = useRef<HTMLElement>(null), root = useRef<HTMLDivElement>(null);
  const profile = useLiveQuery(getProfile);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [contents, setContents] = useState(''), [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<RestorePreview>(), [choices, setChoices] = useState<Record<number, RestoreChoice>>({});
  const [error, setError] = useState(''), [feedback, setFeedback] = useState('');
  function active(value: boolean) { setBusy(value); onActiveChange(value || !!preview); }
  async function backup() {
    active(true); setProgress('Preparing your backup…'); setError(''); setFeedback('');
    try {
      const backup = await exportMemoryBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      if (blob.size > MEMORY_BACKUP_MAX_BYTES) throw new Error('This backup exceeds the 5 MB restore limit.');
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'job-autofill-memories-' + new Date().toISOString().slice(0, 10) + '.json';
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setFeedback('Backup downloaded: ' + counted(backup.memories.length, 'Memory', 'Memories') + '. Keep this file to restore them later.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create the backup.'); }
    finally { active(false); }
  }
  async function readPreview(text: string, name = fileName) {
    setBusy(true); onActiveChange(true); setProgress('Comparing this backup with your saved Memories…'); setError(''); setFeedback('');
    try {
      const result = await previewMemoryRestore(text);
      setContents(text); setFileName(name); setPreview(result); onReviewChange(true);
      setChoices(Object.fromEntries(result.rows.filter(row => row.kind !== 'duplicate').map(row => [row.key, row.kind === 'new' ? 'backup' : 'keep'])));
      requestAnimationFrame(() => { previewRoot.current?.focus(); previewRoot.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not read the backup.'); onActiveChange(!!preview); }
    finally { setBusy(false); }
  }
  async function chooseFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MEMORY_BACKUP_MAX_BYTES) { setError('Choose a Memories backup smaller than 5 MB.'); return; }
    setBusy(true); onActiveChange(true); setProgress('Reading your backup file…');
    try { await readPreview(await file.text(), file.name); }
    catch { setError('Could not read this file. Choose the backup again.'); setBusy(false); onActiveChange(!!preview); }
  }
  function finish() {
    setPreview(undefined); setContents(''); setChoices({}); setFileName(''); onActiveChange(false); onReviewChange(false);
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[data-memory-restore-button]')?.focus());
  }
  async function restore() {
    if (!preview) return;
    setBusy(true); setProgress('Saving your restore choices…'); setError('');
    try {
      const s = await restoreMemoryBackup(contents, preview.token, choices);
      const parts: string[] = [];
      if (s.added) parts.push(counted(s.added, 'new Memory', 'new Memories') + ' added');
      if (s.removed) parts.push(counted(s.removed, 'saved Memory', 'saved Memories') + ' replaced with ' + counted(s.replacements, 'backup Memory', 'backup Memories'));
      if (s.kept) parts.push(counted(s.kept, 'saved Memory', 'saved Memories') + ' kept');
      if (s.duplicates) parts.push(counted(s.duplicates, 'duplicate') + ' skipped');
      if (s.skipped) parts.push(counted(s.skipped, 'new Memory', 'new Memories') + ' not selected');
      finish();
      setFeedback((s.added || s.removed ? 'Restore complete. ' : 'No changes made. ') + (parts.length ? parts.join(' · ') + '.' : 'Your saved Memories were kept.'));
    } catch (err) { setError((err instanceof Error ? err.message : 'Could not restore the backup.') + ' No Memories were changed.'); }
    finally { setBusy(false); }
  }
  function memoryDetails(memory: MappingDraft, index: number, showQuestion = false, showRules = false) {
    const linkedValue = memory.target.kind === 'profile' && profile ? valueFor(memory.target.key, profile, { label: memory.question })?.join(' · ') : '';
    return <div key={index} className="min-w-0 space-y-2">
      {showQuestion && <p className="text-sm font-medium break-words">{memory.question}</p>}
      {memory.target.kind === 'answers' ? <ul aria-label="Selected answers" className="flex flex-wrap gap-1">{memory.target.selections.map((selection, i) => <li key={i} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm break-words">{selection.value}</li>)}</ul>
        : <p className="whitespace-pre-wrap break-words text-sm font-medium text-slate-900">{memory.target.kind === 'profile' ? 'Use my current Profile → ' + targetText(memory.target) : targetText(memory.target)}</p>}
      <p className="text-xs text-slate-600 break-words"><span className="font-medium">Reuse for: </span>{scopeLabel(memory.scope)}</p>
      {memory.target.kind === 'profile' && <p className={'text-xs ' + (linkedValue ? 'text-slate-600' : 'text-amber-800')}>{linkedValue ? 'Current Profile answer: ' + linkedValue : 'This Profile answer is empty. Fill it in Profile before using this Memory.'}</p>}
      <details open={showRules} className="text-xs text-slate-600"><summary className="cursor-pointer">Question variations and matching details</summary>
        <p className="mt-2">{memory.meaning ? 'Recognized question meaning: ' + meaningDescription(memory.meaning) : 'Matches this question and the variations listed here.'}</p>
        <p>{memory.aliases.length ? 'Question variations: ' + memory.aliases.join(' · ') : 'No extra question variations saved.'}</p>
        <p>{memory.answerAliases?.length ? 'Other dropdown labels: ' + memory.answerAliases.join(' · ') : 'No extra dropdown labels saved.'}</p>
        {memory.target.kind === 'answers' && <ul>{memory.target.selections.map((selection, i) => <li className="break-words" key={i}>{selection.value}{selection.aliases.length ? ' — Also accepts: ' + selection.aliases.join(', ') : ''}</li>)}</ul>}
      </details>
    </div>;
  }
  const newRows = preview?.rows.filter(row => row.kind === 'new') ?? [];
  const conflictRows = preview?.rows.filter(row => row.kind === 'conflict') ?? [];
  const duplicateRows = preview?.rows.filter(row => row.kind === 'duplicate') ?? [];
  const added = newRows.filter(row => choices[row.key] === 'backup').reduce((n, row) => n + row.incoming.length, 0);
  const replaced = conflictRows.filter(row => choices[row.key] === 'backup').reduce((n, row) => n + row.current.length, 0);
  const kept = conflictRows.filter(row => choices[row.key] === 'keep').reduce((n, row) => n + row.current.length, 0);
  const skipped = newRows.filter(row => choices[row.key] === 'keep').reduce((n, row) => n + row.incoming.length, 0);
  const changeNew = (choice: RestoreChoice) => setChoices({ ...choices, ...Object.fromEntries(newRows.map(row => [row.key, choice])) });

  function conflictCard(row: RestoreRow) {
    const sameAnswer = row.current.length === 1 && row.incoming.length === 1 && JSON.stringify(row.current[0]!.target) === JSON.stringify(row.incoming[0]!.target);
    return <li key={row.key} data-restore-key={row.key} className="rounded-xl border border-amber-200 bg-white p-4 space-y-3">
      <p className="font-semibold text-slate-900 break-words">{row.incoming.map(m => m.question).join(' · ')}</p>
      <p className="text-sm text-slate-600">{sameAnswer ? 'The answer is the same, but the saved question variations or matching rules differ.' : 'You already have an answer for this question. Choose which version to use on future applications.'}</p>
      {(row.current.length > 1 || row.incoming.length > 1) && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">These questions share matching rules, so they stay together: keep {counted(row.current.length, 'saved Memory', 'saved Memories')}, or replace them with {counted(row.incoming.length, 'backup Memory', 'backup Memories')}.</p>}
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Choose the answer for {row.incoming[0]!.question}</legend>
        {(['keep', 'backup'] as const).map(choice => <div key={choice} className={'min-w-0 rounded-xl border-2 p-3 space-y-3 ' + (choices[row.key] === choice ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white')}>
          <label className="flex items-start gap-2 text-sm font-semibold cursor-pointer">
            <input type="radio" className="mt-1 shrink-0 accent-indigo-600" name={'restore-choice-' + row.key} checked={choices[row.key] === choice} onChange={() => setChoices({ ...choices, [row.key]: choice })} />
            <span>{choice === 'keep' ? 'Keep my saved answer' : 'Use the backup answer'}</span>
          </label>
          <p className="text-xs text-slate-500">{choice === 'keep' ? 'Saved in this browser now' : 'From the file you selected'}</p>
          <div className="space-y-3">{(choice === 'keep' ? row.current : row.incoming).map((memory, i) => memoryDetails(memory, i, row.current.length > 1 || row.incoming.length > 1 || row.current[0]?.question !== row.incoming[0]?.question, sameAnswer))}</div>
        </div>)}
      </fieldset>
      <p className="text-xs font-medium text-indigo-800">{choices[row.key] === 'keep' ? 'Will keep your saved answer and its question variations.' : 'Will replace the saved version with the backup answer and its question variations.'}</p>
    </li>;
  }
  return <div ref={root} className={'space-y-4 rounded-xl border p-4 ' + (preview ? 'border-indigo-200 bg-slate-50' : 'border-slate-200 bg-slate-50')}>
    {!preview && <>
      <h3 className="text-sm font-semibold text-slate-900">Backup and restore</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2"><p className="text-sm font-medium">Save a backup file</p><p className="text-xs text-slate-600">Download all {counted(count, 'saved Memory', 'saved Memories')} to keep or move to another browser.</p><Button variant="secondary" disabled={disabled || busy || !count} onClick={() => void backup()}>Backup Memories</Button></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2"><p className="text-sm font-medium">Restore from a file</p><p className="text-xs text-slate-600">Choose a backup, then review which answers to add or keep.</p><Button data-memory-restore-button variant="secondary" disabled={disabled || busy} onClick={() => input.current?.click()}>Restore Memories</Button></div>
      </div>
      <details className="text-xs text-slate-600"><summary className="cursor-pointer">What does a backup include?</summary><p className="mt-2">Your answers, question variations and reuse limits. Profile links use the Profile in the destination browser. Your Profile, documents and connection credentials are separate. <a className="underline text-indigo-700" href="#data">Back up your Profile in Data.</a> Keep backup files private because they contain your answers.</p></details>
    </>}
    <input ref={input} aria-label="Choose Memories backup" type="file" accept="application/json,.json" className="hidden" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void chooseFile(file); }} />
    {busy && <p role="status" className="text-sm text-indigo-700">{progress}</p>}
    {preview && <section ref={previewRoot} tabIndex={-1} aria-label="Review Memories restore" className="space-y-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg">
      <div className="space-y-1"><p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Restore a backup · Review before saving</p><h3 className="text-lg font-semibold text-slate-900">Choose what to restore</h3><p className="text-sm text-slate-600">Nothing changes until you apply your choices. Your saved answers are kept unless you choose the backup version.</p><p className="text-xs text-slate-500 break-words">File: {fileName} · Created {new Date(preview.createdAt).toLocaleString()}</p></div>
      <dl className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><dt className="text-xs font-semibold text-amber-900">Different versions</dt><dd className="mt-1 text-xl font-semibold text-amber-950">{conflictRows.length}</dd><p className="mt-1 text-xs text-amber-900">Choose which answer to keep</p></div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3"><dt className="text-xs font-semibold text-emerald-900">New Memories</dt><dd className="mt-1 text-xl font-semibold text-emerald-950">{newRows.length}</dd><p className="mt-1 text-xs text-emerald-900">Available to add from this backup</p></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><dt className="text-xs font-semibold text-slate-700">Already saved</dt><dd className="mt-1 text-xl font-semibold text-slate-900">{duplicateRows.length}</dd><p className="mt-1 text-xs text-slate-600">Identical — nothing to restore</p></div>
      </dl>
      {!!preview.duplicatesInFile && <p className="text-xs text-slate-600">{counted(preview.duplicatesInFile, 'repeated entry', 'repeated entries')} inside this file ignored.</p>}
      {!!conflictRows.length && <section aria-label="Different versions to review" className="space-y-3">
        <div><h4 className="font-semibold text-slate-900">1. Different versions — choose an answer</h4><p className="mt-1 text-sm text-slate-600">These are conflicts: a saved Memory matches a backup Memory, but the answer or matching rules differ.</p></div>
        <ul aria-label="Conflicting Memories" className="space-y-3">{conflictRows.map(conflictCard)}</ul>
      </section>}
      {!!newRows.length && <section aria-label="New Memories to add" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold text-slate-900">{conflictRows.length ? '2. ' : ''}New Memories — add what you need</h4><p className="mt-1 text-sm text-slate-600">These are not saved in this browser yet. Uncheck anything you don’t want to add.</p></div><div className="flex gap-1"><Button variant="ghost" disabled={busy} onClick={() => changeNew('backup')}>Select all new</Button><Button variant="ghost" disabled={busy} onClick={() => changeNew('keep')}>Skip all new</Button></div></div>
        <ul aria-label="New Memories" className="space-y-2">{newRows.map(row => <li key={row.key} data-restore-key={row.key} className={'rounded-xl border p-3 space-y-2 ' + (choices[row.key] === 'backup' ? 'border-emerald-200 bg-white' : 'border-slate-200 bg-slate-100')}>
          <label className="flex items-start gap-2 cursor-pointer"><input type="checkbox" className="mt-1 shrink-0 accent-indigo-600" disabled={busy} checked={choices[row.key] === 'backup'} onChange={e => setChoices({ ...choices, [row.key]: e.target.checked ? 'backup' : 'keep' })} /><span className="text-sm font-semibold break-words">{row.incoming[0]!.question}</span></label>
          <p className={'text-xs font-medium ' + (choices[row.key] === 'backup' ? 'text-emerald-800' : 'text-slate-600')}>{choices[row.key] === 'backup' ? 'Will be added to your Memories' : 'Skipped — will not be added'}</p>
          <div className="pl-5">{row.incoming.map((memory, i) => memoryDetails(memory, i))}</div>
        </li>)}</ul>
      </section>}
      {!!duplicateRows.length && <details className="rounded-lg border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">Already saved ({duplicateRows.length}) — no action needed</summary>
        <p className="mt-2 text-sm text-slate-600">These match your saved answers and question variations exactly. They will be skipped.</p>
        <ul aria-label="Already saved Memories" className="mt-2 divide-y divide-slate-100">{duplicateRows.map(row => <li key={row.key} className="py-2 space-y-1"><p className="text-sm font-medium break-words">{row.incoming[0]!.question}</p><p className="text-xs text-slate-600 break-words">{targetText(row.incoming[0]!.target)} · {scopeLabel(row.incoming[0]!.scope)}</p></li>)}</ul>
      </details>}
      {!preview.rows.length && <Notice tone="info">This backup has no Memories to restore.</Notice>}
      {!newRows.length && !conflictRows.length && !!duplicateRows.length && <Notice tone="info">You already have every Memory in this backup. Nothing needs restoring.</Notice>}
      <div aria-label="Restore changes summary" className="space-y-3 rounded-xl border border-indigo-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">What will happen when you confirm</p>
        <p role="status" aria-live="polite" className="text-sm text-slate-700">{counted(added, 'new Memory', 'new Memories')} will be added · {counted(replaced, 'saved Memory', 'saved Memories')} will be replaced</p>
        {!!kept && <p className="text-xs text-slate-600">{counted(kept, 'saved Memory', 'saved Memories')} will be kept.</p>}
        {!!skipped && <p className="text-xs text-slate-600">{counted(skipped, 'new Memory', 'new Memories')} will be skipped.</p>}
        <p className="text-xs text-slate-500">Other saved Memories stay as they are. Your Profile and current application answers stay as they are.</p>
        <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void restore()}>{busy ? 'Saving…' : added || replaced ? 'Apply these choices' : 'Finish without changes'}</Button><Button variant="secondary" disabled={busy} onClick={() => { setError(''); setFeedback('Restore canceled. Your saved Memories were kept.'); finish(); }}>Cancel restore</Button><Button variant="ghost" disabled={busy} onClick={() => void readPreview(contents)}>Refresh preview</Button></div>
      </div>
    </section>}
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
    {feedback && <div role="status"><Notice tone="success">{feedback}</Notice></div>}
  </div>;
}
