import { ReuseScope } from './ReuseScope';
import { ProfileDestination } from './ProfileAnswer';
import { useState } from 'react';
import { sendToBackground } from '@/lib/messages';
import { targetText, type CapturedAnswer, type MappingContext } from '@/lib/remembered-mappings';
import { draftForCapture } from './KnowledgeBase';
import { Button, Notice } from './ui';

export function BatchRemember({ applicationId, captures, skipped, context, onSaved, onCancel }: {
  applicationId: number; captures: CapturedAnswer[]; skipped: { label: string; reason: string }[]; context: MappingContext;
  onSaved(note: string, count: number): void; onCancel(): void;
}) {
  const [rows, setRows] = useState(() => captures.map(capture => ({ capture, mapping: draftForCapture(capture, context), included: true, replace: false })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const count = rows.filter(r => r.included).length;

  async function save() {
    setBusy(true); setError('');
    try {
      const result = await sendToBackground('savePageAnswers', { applicationId, entries: rows.filter(r => r.included).map(r => ({ token: r.capture.token, captureId: r.capture.captureId, ...(r.capture.profileUpdate ? { profile: { value: r.capture.profileUpdate.value, expected: r.capture.profileUpdate, replace: r.replace } } : { mapping: r.mapping }) })) });
      if (!result.ok) throw new Error(result.error);
      onSaved(result.profileCount ? result.note : result.count + ' question' + (result.count === 1 ? '' : 's') + ' remembered. ' + result.note, result.count + result.profileCount);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the answers.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3" aria-label="Review answers to remember">
    <div><p className="font-semibold">Confirm where to save</p><p className="mt-1 text-xs text-slate-600">{rows.filter(r => r.included && r.capture.profileUpdate).length} Profile updates · {rows.filter(r => r.included && !r.capture.profileUpdate).length} Memories. Review each answer below. Uncheck anything you do not want to save.</p></div>
    <ul className="space-y-3">{rows.map((row, index) => <li key={row.capture.token} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <label className="flex items-start gap-2 text-sm font-medium"><input className="mt-1" type="checkbox" checked={row.included} disabled={busy} onChange={e => setRows(rows.map((r, i) => i === index ? { ...r, included: e.target.checked } : r))} /><span>{row.capture.label}</span></label>
      {row.capture.profileUpdate ? <ProfileDestination update={row.capture.profileUpdate} replace={row.replace} disabled={busy || !row.included} onReplace={replace => setRows(rows.map((r, i) => i === index ? { ...r, replace } : r))} /> : <><p className="text-xs font-semibold text-indigo-800">Destination: Memory</p><p className="text-xs text-slate-600">Remember this question with the reuse limit you choose below.</p><p className="whitespace-pre-wrap break-words text-sm text-slate-700">{targetText(row.mapping.target)}</p><ReuseScope ariaLabel={`Reuse answers for question ${index + 1}`} value={row.mapping.scope} context={context} disabled={busy || !row.included} onChange={scope => setRows(rows.map((r, i) => i === index ? { ...r, mapping: { ...r.mapping, scope } } : r))} /></>}
    </li>)}</ul>
    {!!skipped.length && <details className="text-xs text-slate-600"><summary>{skipped.length} questions could not be captured</summary><ul>{skipped.map((row, i) => <li key={i}>{row.label}: {row.reason}</li>)}</ul></details>}
    {!rows.length && <Notice tone="info">No committed answers could be read. Answer the questions on the page, then try again.</Notice>}
    {error && <div role="alert"><Notice tone="error">{error} No answers from this attempt were saved. Cancel and read them again if the page changed.</Notice></div>}
    <div className="sticky bottom-0 flex flex-wrap gap-2 rounded-lg border border-indigo-100 bg-white p-2 shadow-sm"><Button disabled={busy || !count || rows.some(r => r.included && r.capture.profileUpdate?.previous && r.capture.profileUpdate.previous !== r.capture.profileUpdate.value && !r.replace)} onClick={() => void save()}>{busy ? 'Saving…' : `${rows.some(r => r.included && r.capture.profileUpdate) ? 'Save' : 'Remember'} ${count} answered question${count === 1 ? '' : 's'}`}</Button><Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button></div>
  </section>;
}
