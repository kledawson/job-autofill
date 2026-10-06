import { useState } from 'react';
import { sendToBackground } from '@/lib/messages';
import { applicationKey, companyKey, scopeLabel, targetText, type CapturedAnswer, type MappingContext, type MappingScope } from '@/lib/remembered-mappings';
import { draftForCapture } from './KnowledgeBase';
import { Button, Field, Notice, Select } from './ui';

export function BatchRemember({ applicationId, captures, skipped, context, onSaved, onCancel }: {
  applicationId: number; captures: CapturedAnswer[]; skipped: { label: string; reason: string }[]; context: MappingContext;
  onSaved(note: string, count: number): void; onCancel(): void;
}) {
  const [rows, setRows] = useState(() => captures.map(capture => ({ capture, mapping: draftForCapture(capture, context), included: true })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const count = rows.filter(r => r.included).length;
  const scopes: MappingScope[] = ['all', ...(context.company && !/^(unknown|company)$/i.test(context.company) ? [`company:${companyKey(context.company)}` as MappingScope] : []), `application:${applicationKey(context.url)}`, `site:${new URL(context.url).origin}`];
  async function save() {
    setBusy(true); setError('');
    try {
      const result = await sendToBackground('savePageAnswers', { applicationId, entries: rows.filter(r => r.included).map(r => ({ token: r.capture.token, captureId: r.capture.captureId, mapping: r.mapping })) });
      if (!result.ok) throw new Error(result.error);
      onSaved(result.note, result.count);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the answers.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3" aria-label="Review answers to remember">
    <div><p className="font-semibold">Remember your answered questions</p><p className="mt-1 text-xs text-slate-600">Review the answers and where they apply. Uncheck anything you do not want to remember. Saving keeps your page answers.</p></div>
    <ul className="space-y-3">{rows.map((row, index) => <li key={row.capture.token} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <label className="flex items-start gap-2 text-sm font-medium"><input className="mt-1" type="checkbox" checked={row.included} disabled={busy} onChange={e => setRows(rows.map((r, i) => i === index ? { ...r, included: e.target.checked } : r))} /><span>{row.capture.label}</span></label>
      <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{targetText(row.mapping.target)}</p>
      <Field label="Where should this answer be reused?"><Select aria-label={`Reuse answers for question ${index + 1}`} disabled={busy || !row.included} value={row.mapping.scope} options={scopes.map(scope => [scope, scopeLabel(scope)])} onChange={e => setRows(rows.map((r, i) => i === index ? { ...r, mapping: { ...r.mapping, scope: e.target.value as MappingScope } } : r))} /></Field>
    </li>)}</ul>
    {!!skipped.length && <details className="text-xs text-slate-600"><summary>{skipped.length} questions could not be captured</summary><ul>{skipped.map((row, i) => <li key={i}>{row.label}: {row.reason}</li>)}</ul></details>}
    {!rows.length && <Notice tone="info">No committed answers could be read. Answer the questions on the page, then try again.</Notice>}
    {error && <div role="alert"><Notice tone="error">{error} No answers from this attempt were saved. Cancel and read them again if the page changed.</Notice></div>}
    <div className="flex flex-wrap gap-2"><Button disabled={busy || !count} onClick={() => void save()}>{busy ? 'Saving…' : `Remember ${count} answered question${count === 1 ? '' : 's'}`}</Button><Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button></div>
  </section>;
}
