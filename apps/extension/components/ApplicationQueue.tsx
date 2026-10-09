import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { db } from '@/lib/db';
import type { Application } from '@/lib/types';
import type { QueueItem, QueueRecord } from '@/lib/application-queue';
import { parseQueueLinks, queueKey, settled, inFlight } from '@/lib/application-queue';
import { jobKey, detectPlatform, ALL_SITES } from '@/lib/platforms';
import { pageStatusKey, sendToBackground } from '@/lib/messages';
import { useLiveQuery } from './hooks';
import { Button, Notice, Select, Textarea } from './ui';
import { confirmDelete } from './confirm-delete';

const QUEUE_NOTICE_KEY = 'dismissedQueueNotice';
function readDismissedNotice(value: unknown): string {
  const record = value as { version?: unknown; token?: unknown; status?: unknown } | undefined;
  return record?.version === 1 && typeof record.token === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(record.token) &&
    (record.status === 'stopped' || record.status === 'complete') ? record.token + ':' + record.status : '';
}

export function ApplicationQueue({ presetId, activeTabId }: { presetId?: string; activeTabId?: number }) {
  const [text, setText] = useState(''), [size, setSize] = useState(3);
  const edited = useRef(false);
  useEffect(() => {
    let mounted = true;
    void browser.storage.session.get('queueDraft').then(({ queueDraft }) => {
      const draft = queueDraft as { text?: unknown; size?: unknown } | undefined;
      if (!mounted || edited.current || !draft || typeof draft.text !== 'string' || draft.text.length > 250000 || typeof draft.size !== 'number' || !Number.isInteger(draft.size) || draft.size < 1 || draft.size > 5) return;
      setText(draft.text); setSize(draft.size);
    });
    return () => { mounted = false; };
  }, []);
  function draft(nextText: string, nextSize: number) {
    edited.current = true; setText(nextText); setSize(nextSize);
    void browser.storage.session.set({ queueDraft: { text: nextText, size: nextSize } }).catch(() => setError('Could not keep your link draft. Copy the links before closing the panel.'));
  }
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [dismissedNotice, setDismissedNotice] = useState(''), [noticeLoaded, setNoticeLoaded] = useState(false);
  useEffect(() => {
    let mounted = true, revision = 0;
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && QUEUE_NOTICE_KEY in changes) {
        revision++; setDismissedNotice(readDismissedNotice(changes[QUEUE_NOTICE_KEY]!.newValue)); setNoticeLoaded(true);
      }
    };
    browser.storage.onChanged.addListener(changed);
    void browser.storage.local.get(QUEUE_NOTICE_KEY).then(data => {
      if (mounted && !revision) setDismissedNotice(readDismissedNotice(data[QUEUE_NOTICE_KEY]));
    }).catch(() => undefined).finally(() => { if (mounted) setNoticeLoaded(true); });
    return () => { mounted = false; browser.storage.onChanged.removeListener(changed); };
  }, []);
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
  function dismissNotice() {
    if (!queue || !['stopped', 'complete'].includes(queue.status)) return;
    const previous = dismissedNotice, signature = queue.token + ':' + queue.status;
    setDismissedNotice(signature); setError('');
    void browser.storage.local.set({ [QUEUE_NOTICE_KEY]: { version: 1, token: queue.token, status: queue.status } }).catch(() => {
      setDismissedNotice(current => current === signature ? previous : current);
      setError('Could not dismiss this notification. Please try again.');
    });
  }
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
      if (res.ok) draft('', size);
      return res;
    });
  }
  async function control(action: 'pause' | 'resume' | 'stop' | 'size', batchSize?: number) {
    if (action === 'stop' && !await confirmDelete('Stop this queue?', 'No more jobs will be filled. Already opened tabs and their answers stay open for you to review.', 'Stop queue')) return;
    await perform(() => sendToBackground('controlQueue', { action, batchSize }));
  }
  return <section aria-label="Application queue" className="space-y-2">
    <p className="text-xs leading-relaxed text-slate-500">Each batch fills in the background while you review. Submit applications yourself.</p>
    {active && queue ? <>
      <div className="space-y-1 rounded-lg bg-slate-50 p-2.5" role="status">
        <div className="flex justify-between gap-2 font-medium"><span>Batch {queue.batch || 1}</span><span>{queue.status === 'paused' ? 'Paused' : current.some(inFlight) ? 'Filling' : 'Review your batch'}</span></div>
        <p className="text-xs text-indigo-900">{finished} of {queue.items.length} finished · {queue.items.filter(i => i.batch === 0).length} waiting</p>
        <p className="truncate text-xs text-slate-500" title={queue.resumeName}>Using {queue.presetName} · locked</p>
        <progress className="h-1.5 w-full accent-indigo-600" aria-label="Queue progress" value={finished} max={queue.items.length} />
      </div>
      <p className="text-xs leading-relaxed text-slate-600">Review each page, submit on the website, then choose Submitted here. Finish or skip the batch to continue.</p>
      <ul className="space-y-2">{current.map((item, index) => <QueueCard key={item.id} item={item} index={index} queue={queue}
        app={applications.find(app => app.id === item.applicationId)} active={item.tabId !== undefined && item.tabId === activeTabId} busy={busy} perform={perform} />)}</ul>
      <div className="flex gap-2"><Button variant="secondary" disabled={busy} onClick={() => control(queue.status === 'paused' ? 'resume' : 'pause')}>{queue.status === 'paused' ? 'Resume queue' : 'Pause queue'}</Button><Button variant="ghost" disabled={busy} onClick={() => control('stop')}>Stop queue</Button></div>
      <details className="text-xs"><summary className="cursor-pointer text-slate-500">Batch settings</summary><label className="mt-2 block font-medium">Applications in the next batch
        <Select aria-label="Applications in the next batch" options={['1','2','3','4','5']} value={String(queue.batchSize)} disabled={busy} onChange={e => control('size', Number(e.target.value))} />
      </label>
      <p className="mt-1 text-xs text-slate-500">The current batch size stays unchanged.</p></details>
    </> : <>
      {queue && noticeLoaded && dismissedNotice !== queue.token + ':' + queue.status && <Notice tone={queue.status === 'complete' ? 'success' : 'info'} onDismiss={dismissNotice} dismissLabel="Dismiss queue notification">{queue.status === 'complete' ? 'Queue complete.' : 'Queue stopped. Opened applications were kept.'} {finished} of {queue.items.length} finished.</Notice>}
      <label htmlFor="job-links" className="block font-medium">Job links</label>
      <Textarea id="job-links" aria-describedby="queue-input-help" placeholder="Paste one or more full job application links" rows={3} value={text} maxLength={250000} onChange={e => draft(e.target.value, size)} />
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
        <Select aria-label="Applications per batch" options={['1','2','3','4','5']} value={String(size)} onChange={e => draft(text, Number(e.target.value))} />
      </label>
      <p className="text-xs text-slate-500">Opens up to {size} application tabs. Review them before the next batch opens.</p>
      <Button className="w-full" disabled={busy || !presetId || !fresh.length || !!preview.error} onClick={start}>{busy ? 'Starting…' : 'Start queue'}</Button>
    </>}
    {error && <Notice tone="error">{error}</Notice>}
  </section>;
}

function QueueCard({ item, index, queue, app, active, busy, perform }: {
  item: QueueItem; index: number; queue: QueueRecord; app?: Application; active: boolean; busy: boolean;
  perform(work: () => Promise<{ ok: boolean; error?: string }>): Promise<void>;
}) {
  const [more, setMore] = useState(false);
  const state = { queued: 'Waiting', opening: 'Opening', filling: 'Filling', review: 'Ready for review', 'needs-action': 'Needs your action', submitted: 'Submitted', skipped: 'Skipped' }[item.state];
  const statusColor = item.state === 'needs-action' ? 'bg-amber-50 text-amber-800' : item.state === 'review' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600';
  const finished = settled(item);
  function action(action: 'open' | 'retry' | 'submitted' | 'skip') {
    return perform(async () => {
      const result = await sendToBackground('queueAction', { token: queue.token, itemId: item.id, action });
      if (result.ok) {
        setMore(false);
        if (action === 'open') requestAnimationFrame(() => {
          const toggle = document.getElementById('sidebar-fill-toggle');
          if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
          document.getElementById('current-page-review')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
      return result;
    });
  }
  return <li data-queue-item={item.id} className={'space-y-2 rounded-lg border p-2.5 ' + (active ? 'border-indigo-300 bg-indigo-50/30' : 'border-slate-200 bg-white')}>
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900" title={app?.role || item.url}>{app?.role || new URL(item.url).hostname}</p>
        <p className="truncate text-xs text-slate-500">{app?.company || new URL(item.url).hostname}{active ? ' · Viewing' : ''}</p>
      </div>
      <span className={'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ' + statusColor}>{state}</span>
    </div>
    {item.state === 'filling' && item.tabId !== undefined && <FillPhase tabId={item.tabId} />}
    {item.note && <p className="text-xs text-amber-800">{item.note}</p>}
    {app && item.state === 'review' && <p className="text-xs text-slate-500">{app.filledCount} filled · {app.missingCount} need you</p>}
    {!finished && <div className="flex items-center gap-2">
      {item.tabId !== undefined && <button type="button" disabled={busy} className={'rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ' + (item.state === 'review' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'border border-slate-300 text-slate-700 hover:bg-slate-50')} onClick={() => action('open')}>Review</button>}
      {item.state === 'review' && <button type="button" disabled={busy} aria-label="Submitted — close tab" title="Confirm successful submission and close this tab" className="rounded-md border border-green-200 px-3 py-1.5 text-xs font-medium text-green-800 hover:bg-green-50 disabled:opacity-50" onClick={() => action('submitted')}>✓ Submitted</button>}
      {item.state === 'needs-action' && <button type="button" disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50" onClick={() => action('retry')}>Retry autofill</button>}
      <button type="button" className="ml-auto rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100" aria-expanded={more} aria-controls={'queue-more-' + item.id} onClick={() => setMore(value => !value)}>{more ? 'Less' : 'More'} <span aria-hidden>{more ? '▴' : '▾'}</span></button>
    </div>}
    {!finished && <div id={'queue-more-' + item.id} hidden={!more} className="space-y-2 border-t border-slate-100 pt-2">
      <div className="flex flex-wrap gap-2">
        {['review','opening','filling'].includes(item.state) && <button type="button" disabled={busy} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50" onClick={() => action('retry')}>{inFlight(item) ? 'Restart autofill' : 'Fill this step'}</button>}
        <button type="button" disabled={busy || inFlight(item)} className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50" onClick={async () => {
          if (await confirmDelete('Skip this application?', 'Its queue tab will close without recording a submission.', 'Skip — close tab')) await action('skip');
        }}>Skip — close tab</button>
      </div>
      <p className="break-all text-xs text-slate-500">{item.url}</p>
      <p className="text-xs text-slate-500">Resume: {queue.resumeName || 'None'}</p>
    </div>}
  </li>;
}

function FillPhase({ tabId }: { tabId: number }) {
  const [phase, setPhase] = useState('');
  useEffect(() => {
    const key = pageStatusKey(tabId); let mounted = true;
    const read = (value: unknown) => {
      const status = value as { lines?: unknown } | undefined;
      const first = Array.isArray(status?.lines) ? status.lines[0] : undefined;
      if (mounted) setPhase(typeof first === 'string' ? first.slice(0, 200) : '');
    };
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'session' && key in changes) read(changes[key]!.newValue);
    };
    browser.storage.onChanged.addListener(changed);
    void browser.storage.session.get(key).then(data => read(data[key])).catch(() => undefined);
    return () => { mounted = false; browser.storage.onChanged.removeListener(changed); };
  }, [tabId]);
  return phase ? <p className="text-xs text-indigo-700" role="status">{phase}</p> : null;
}
