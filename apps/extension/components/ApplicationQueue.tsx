import { useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { db } from '@/lib/db';
import { parseQueueLinks, queueKey, settled, inFlight } from '@/lib/application-queue';
import { jobKey, detectPlatform, ALL_SITES } from '@/lib/platforms';
import { sendToBackground } from '@/lib/messages';
import { useLiveQuery } from './hooks';
import { Button, Notice, Select, Textarea } from './ui';
import { confirmDelete } from './confirm-delete';

export function ApplicationQueue({ presetId }: { presetId?: string }) {
  const [text, setText] = useState(''), [size, setSize] = useState(3);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const queue = useLiveQuery(() => db.applicationQueue.get('current'));
  const applications = useLiveQuery(() => db.applications.toArray()) ?? [];
  const preview = useMemo(() => {
    try { return { ...parseQueueLinks(text), error: '' }; }
    catch (e) { return { urls: [], duplicates: 0, rejected: [], noLinks: false, error: e instanceof Error ? e.message : 'Check your links.' }; }
  }, [text]);
  const existing = preview.urls.map(url => ({ url, app: applications.find(a => a.jobKey === jobKey(url) || queueKey(a.url) === queueKey(url)) }));
  const fresh = existing.filter(i => !i.app).map(i => i.url);
  const active = queue && !['stopped', 'complete'].includes(queue.status);
  const current = queue?.items.filter(i => i.batch === queue.batch && i.batch > 0) ?? [];
  const finished = queue?.items.filter(settled).length ?? 0;
  async function perform(work: () => Promise<{ ok: boolean; error?: string }>) {
    setError(''); setBusy(true);
    try { const res = await work(); if (!res.ok) throw new Error(res.error || 'Could not update the queue.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Try again.'); }
    finally { setBusy(false); }
  }
  async function start() {
    // Permission requests must run directly in the user's click.
    if (fresh.some(u => !detectPlatform(u))) {
      const allowed = await browser.permissions.request({ origins: ALL_SITES }).catch(() => false);
      if (!allowed) { setError('Allow access to these sites to fill the applications.'); return; }
    }
    await perform(async () => {
      const res = await sendToBackground('startQueue', { urls: fresh, batchSize: size, presetId });
      if (res.ok) setText('');
      return res;
    });
  }
  async function control(action: 'pause' | 'resume' | 'stop' | 'size', batchSize?: number) {
    if (action === 'stop' && !await confirmDelete('Stop this queue?', 'No more jobs will be filled. Already opened tabs and their answers stay open for you to review.', 'Stop queue')) return;
    await perform(() => sendToBackground('controlQueue', { action, batchSize }));
  }
  return <section aria-label="Application queue" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div><h2 className="font-semibold text-slate-900">Application queue</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">Paste your links. We fill one at a time, then wait for you to review and submit each batch.</p></div>
    {active && queue ? <>
      <div className="space-y-2 rounded-lg bg-indigo-50 p-3" role="status">
        <div className="flex justify-between gap-2 font-medium"><span>Batch {queue.batch || 1}</span><span>{queue.status === 'paused' ? 'Paused' : current.some(inFlight) ? 'Filling' : 'Your review'}</span></div>
        <p className="text-xs text-indigo-900">{finished} of {queue.items.length} finished · {queue.items.filter(i => i.batch === 0).length} waiting</p>
        <p className="break-words text-xs text-indigo-800">{queue.presetName} · {queue.resumeName || 'No resume selected'}</p>
        <p className="text-xs text-indigo-700">Preset locked for this queue. Selection changes apply to your next queue.</p>
        <progress className="h-2 w-full accent-indigo-600" aria-label="Queue progress" value={finished} max={queue.items.length} />
      </div>
      <p className="text-xs leading-relaxed text-slate-600">Submit on the website first. Then choose <strong>Submitted — close tab</strong> here. The next batch waits until every item below is submitted or skipped.</p>
      <ul className="space-y-2">{current.map((item, index) => {
        const app = applications.find(a => a.id === item.applicationId);
        const state = { queued: 'Waiting to fill', opening: 'Opening application', filling: 'Filling fields', review: 'Ready for review', 'needs-action': 'Needs your action', submitted: 'Submitted', skipped: 'Skipped' }[item.state];
        return <li key={item.id} data-queue-item={item.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
          <div className="flex items-start justify-between gap-2"><p className="min-w-0 break-words font-medium">{index + 1}. {app?.role || new URL(item.url).hostname}</p><span className="shrink-0 text-xs text-indigo-700">{state}</span></div>
          <p className="break-all text-xs text-slate-500">{app?.company || new URL(item.url).pathname}</p>
          {item.note && <p className="text-xs text-amber-800">{item.note}</p>}
          {app && item.state === 'review' && <p className="text-xs text-slate-600">{app.filledCount} filled · {app.missingCount} need you</p>}
          {!settled(item) && <div className="flex flex-wrap gap-2">
            {item.tabId !== undefined && <Button variant="secondary" disabled={busy} onClick={() => perform(async () => {
              const res = await sendToBackground('queueAction', { token: queue.token, itemId: item.id, action: 'open' });
              if (res.ok) requestAnimationFrame(() => document.getElementById('current-page-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
              return res;
            })}>Open application</Button>}
            {item.state === 'review' && <Button disabled={busy} onClick={() => perform(() => sendToBackground('queueAction', { token: queue.token, itemId: item.id, action: 'submitted' }))}>Submitted — close tab</Button>}
            {['review', 'needs-action'].includes(item.state) && <Button variant="secondary" disabled={busy || queue.status !== 'running'} onClick={() => perform(() => sendToBackground('queueAction', { token: queue.token, itemId: item.id, action: 'retry' }))}>{item.state === 'review' ? 'Fill this step' : 'Retry autofill'}</Button>}
            <Button variant="ghost" disabled={busy || inFlight(item)} onClick={async () => {
              if (!await confirmDelete('Skip this application?', 'Its queue tab will close. It will not be marked submitted or sent to Google Sheets.', 'Skip — close tab')) return;
              await perform(() => sendToBackground('queueAction', { token: queue.token, itemId: item.id, action: 'skip' }));
            }}>Skip — close tab</Button>
          </div>}
        </li>;
      })}</ul>
      <div className="flex gap-2"><Button variant="secondary" disabled={busy} onClick={() => control(queue.status === 'paused' ? 'resume' : 'pause')}>{queue.status === 'paused' ? 'Resume queue' : 'Pause queue'}</Button><Button variant="ghost" disabled={busy} onClick={() => control('stop')}>Stop queue</Button></div>
      <label className="block text-xs font-medium">Applications in the next batch
        <Select aria-label="Applications in the next batch" options={['1','2','3','4','5']} value={String(queue.batchSize)} disabled={busy} onChange={e => control('size', Number(e.target.value))} />
      </label>
      <p className="text-xs text-slate-500">One fill at a time. The current batch size stays unchanged.</p>
    </> : <>
      {queue && <Notice tone={queue.status === 'complete' ? 'success' : 'info'}>{queue.status === 'complete' ? 'Queue complete.' : 'Queue stopped. Opened applications were kept.'} {finished} of {queue.items.length} finished.</Notice>}
      <label htmlFor="job-links" className="block font-medium">Job links</label>
      <Textarea id="job-links" aria-describedby="queue-input-help" placeholder="Paste one or more full job application links" rows={4} value={text} maxLength={250000} onChange={e => setText(e.target.value)} />
      <p id="queue-input-help" className="text-xs text-slate-500">One per line, or paste a list. Up to 100 links.</p>
      {text.trim() && <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs" aria-live="polite">
        <p className="font-medium">{fresh.length} new application{fresh.length === 1 ? '' : 's'} ready</p>
        {preview.duplicates > 0 && <p>{preview.duplicates} duplicate link{preview.duplicates === 1 ? '' : 's'} removed.</p>}
        {existing.some(i => i.app) && <p>Already tracked jobs are excluded. Review them below instead of refilling.</p>}
        {preview.rejected.length > 0 && <p className="text-amber-800">{preview.rejected.length} unsupported link(s) excluded. {preview.rejected[0]}</p>}
        {(preview.noLinks || preview.error) && <p className="text-red-700">{preview.error || 'No full job URLs found. Include https:// in each link.'}</p>}
        {existing.length > 0 && <details><summary className="cursor-pointer font-medium">Review links ({existing.length})</summary><ul className="mt-2 max-h-52 space-y-2 overflow-auto">{existing.map(({ url, app }) => <li className="break-all" key={url}>{url}{app && <><span className="block text-slate-500">{app.status}</span><button className="font-medium text-indigo-700 underline" onClick={() => perform(async () => {
          if (app.tabId !== undefined && await browser.tabs.get(app.tabId).catch(() => undefined)) await browser.tabs.update(app.tabId, { active: true });
          else await browser.tabs.create({ url: app.url, active: true });
          return { ok: true };
        })}>Review existing application</button></>}</li>)}</ul></details>}
      </div>}
      <label className="block text-xs font-medium">Applications per batch
        <Select aria-label="Applications per batch" options={['1','2','3','4','5']} value={String(size)} onChange={e => setSize(Number(e.target.value))} />
      </label>
      <p className="text-xs text-slate-500">Opens up to {size} application tabs. Review them before the next batch opens.</p>
      <Button className="w-full" disabled={busy || !presetId || !fresh.length || !!preview.error} onClick={start}>{busy ? 'Starting…' : 'Start queue'}</Button>
    </>}
    {error && <Notice tone="error">{error}</Notice>}
  </section>;
}
