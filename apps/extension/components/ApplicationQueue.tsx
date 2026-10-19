import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { db } from '@/lib/db';
import type { Application } from '@/lib/types';
import type { QueueItem, QueueRecord } from '@/lib/application-queue';
import { parseQueueLinks, queueKey, queueLinkChoices, queueOccupancy, settled, inFlight, type QueueLinkChoice } from '@/lib/application-queue';
import { detectPlatform, ALL_SITES } from '@/lib/platforms';
import { pageStatusKey, sendToBackground } from '@/lib/messages';
import { useLiveQuery } from './hooks';
import { Button, Notice, Select, Textarea } from './ui';
import { confirmDelete } from './confirm-delete';
import { applicationWorkflow } from '@/lib/application-workflow';

const QUEUE_NOTICE_KEY = 'dismissedQueueNotice';
function readDismissedNotice(value: unknown): string {
  const record = value as { version?: unknown; token?: unknown; status?: unknown } | undefined;
  return record?.version === 1 && typeof record.token === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(record.token) &&
    (record.status === 'stopped' || record.status === 'complete') ? record.token + ':' + record.status : '';
}

export function ApplicationQueue({ presetId, activeTabId }: { presetId?: string; activeTabId?: number }) {
  const [text, setText] = useState(''), [size, setSize] = useState(3);
  const [continuous, setContinuous] = useState(true), [detectSubmission, setDetectSubmission] = useState(true);
  const edited = useRef(false);
  useEffect(() => {
    let mounted = true;
    void browser.storage.session.get('queueDraft').then(({ queueDraft }) => {
      const draft = queueDraft as { text?: unknown; size?: unknown; continuous?: unknown; detectSubmission?: unknown } | undefined;
      if (!mounted || edited.current || !draft || typeof draft.text !== 'string' || draft.text.length > 250000 || typeof draft.size !== 'number' || !Number.isInteger(draft.size) || draft.size < 1 || draft.size > 5) return;
      setText(draft.text); setSize(draft.size);
      if (typeof draft.continuous === 'boolean') setContinuous(draft.continuous);
      if (typeof draft.detectSubmission === 'boolean') setDetectSubmission(draft.detectSubmission);
    });
    return () => { mounted = false; };
  }, []);
  function draft(nextText: string, nextSize: number, nextContinuous = continuous, nextDetection = detectSubmission) {
    edited.current = true; setText(nextText); setSize(nextSize);
    setContinuous(nextContinuous); setDetectSubmission(nextDetection);
    void browser.storage.session.set({ queueDraft: { text: nextText, size: nextSize, continuous: nextContinuous, detectSubmission: nextDetection } }).catch(() => setError('Could not keep your link draft. Copy the links before closing the panel.'));
  }
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [feedback, setFeedback] = useState(''), [resumeIds, setResumeIds] = useState<number[]>([]);
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
  const active = queue && !['stopped', 'complete'].includes(queue.status);
  const choices = queueLinkChoices(preview.urls, applications, active ? queue : undefined);
  const selected = choices.filter(c => c.kind === 'new' || (['unfinished', 'abandoned'].includes(c.kind) && c.app?.id !== undefined && resumeIds.includes(c.app.id)));
  const fresh = selected.map(c => c.url), selectedResumeIds = selected.flatMap(c => c.app?.id === undefined ? [] : [c.app.id]);
  useEffect(() => { setResumeIds([]); }, [text, queue?.token]);
  const current = queue?.items.filter(i => i.batch > 0 && (queue.mode === 'continuous' ? !settled(i) || i.tabId !== undefined : i.batch === queue.batch)) ?? [];
  const occupied = queue ? queueOccupancy(queue) : 0;
  const waiting = queue?.items.filter(i => i.state === 'queued' && i.tabId === undefined).length ?? 0;
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
    setError(''); setFeedback(''); setBusy(true);
    try { const res = await work(); if (!res.ok) throw new Error(res.error || 'Could not update the queue.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Try again.'); }
    finally { setBusy(false); }
  }
  async function start(adding = false) {
    // Permission requests must run directly in the user's click.
    if (fresh.some(u => !detectPlatform(u))) {
      const allowed = await browser.permissions.request({ origins: ALL_SITES }).catch(() => false);
      if (!allowed) { setError('Allow access to these sites to fill the applications.'); return; }
    }
    await perform(async () => {
      if (adding && queue) {
        const res = await sendToBackground('addQueueLinks', { token: queue.token, urls: fresh, resumeApplicationIds: selectedResumeIds });
        if (res.ok) { draft('', size); setFeedback(`${res.added} job${res.added === 1 ? '' : 's'} added.${res.excluded ? ` ${res.excluded} already queued or tracked link(s) excluded.` : ''}${queue.status === 'paused' ? ' They will open after you resume.' : ' Available slots are filling now.'}`); }
        return res;
      }
      const res = await sendToBackground('startQueue', { urls: fresh, batchSize: size, presetId, mode: continuous ? 'continuous' : 'batch', autoDetectSubmission: detectSubmission, resumeApplicationIds: selectedResumeIds });
      if (res.ok) draft('', size);
      return res;
    });
  }
  async function control(action: 'pause' | 'resume' | 'stop' | 'size', batchSize?: number) {
    if (action === 'stop' && !await confirmDelete('Stop this queue?', 'No more jobs will be filled. Already opened tabs and their answers stay open for you to review.', 'Stop queue')) return;
    if (!queue) return;
    await perform(async () => {
      const result = await sendToBackground('controlQueue', { token: queue.token, action, batchSize });
      if (result.ok && action === 'size') setFeedback(queue.mode !== 'continuous' ? 'The next batch will use this limit.' : queue.status === 'paused' ? 'Limit updated. Resume the queue to open waiting jobs.' : !waiting ? 'Limit updated. No more jobs are waiting; add links below.' : batchSize! <= occupied ? 'Limit updated. Existing tabs stay open; replacements wait for a free slot.' : `Limit updated. Opening up to ${Math.min(batchSize! - occupied, waiting)} more job${Math.min(batchSize! - occupied, waiting) === 1 ? '' : 's'} now.`);
      return result;
    });
  }
  const linkInput = <div className="space-y-2">
    <label htmlFor="job-links" className="block font-medium">{active ? 'More job links' : 'Job links'}</label>
    <Textarea id="job-links" aria-describedby="queue-input-help" placeholder="Paste one or more full job application links" rows={3} value={text} maxLength={250000} onChange={e => draft(e.target.value, size)} />
    <p id="queue-input-help" className="text-xs text-slate-500">One per line, or paste a list. {active ? `${100 - queue.items.length} spaces left in this queue.` : 'Up to 100 links.'}</p>
    {text.trim() && <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs" aria-live="polite">
      <p className="font-medium">{fresh.length} {selectedResumeIds.length ? 'applications selected' : `new application${fresh.length === 1 ? '' : 's'} ready`}</p>
      {preview.duplicates > 0 && <p>{preview.duplicates} duplicate link{preview.duplicates === 1 ? '' : 's'} removed.</p>}
      {choices.some(c => c.kind === 'queued') && <p>Already in this queue — open the existing entry below.</p>}
      {choices.some(c => c.kind === 'submitted') && <p>Previously submitted jobs are excluded to prevent applying twice.</p>}
      {preview.rejected.length > 0 && <p className="text-amber-800">{preview.rejected.length} unsupported link(s) excluded. {preview.rejected[0]}</p>}
      {(preview.noLinks || preview.error) && <p className="text-red-700">{preview.error || 'No full job URLs found. Include https:// in each link.'}</p>}
      <LinkChoices choices={choices} selected={selectedResumeIds} busy={busy} onSelect={(id, checked) => setResumeIds(ids => checked ? [...ids, id] : ids.filter(i => i !== id))} onOpen={choice => perform(async () => {
        if (choice.item && queue) return sendToBackground('queueAction', { token: queue.token, itemId: choice.item.id, action: 'open' });
        const tab = choice.app?.tabId === undefined ? undefined : await browser.tabs.get(choice.app.tabId).catch(() => undefined);
        let sameJob = false; try { sameJob = !!tab?.url && queueKey(tab.url) === queueKey(choice.url); } catch { /* Closed or unsupported destination. */ }
        if (sameJob && tab?.id !== undefined) { await browser.tabs.update(tab.id, { active: true }); if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true }); }
        else await browser.tabs.create({ url: choice.url, active: true });
        return { ok: true };
      })} />
    </div>}
  </div>;
  return <section aria-label="Application queue" className="space-y-2">
    <p className="text-xs leading-relaxed text-slate-500">Autofill → finish missing answers → save Memories → submit on the website.</p>
    {active && queue ? <>
      <div className="space-y-1 rounded-lg bg-slate-50 p-2.5" role="status">
        <div className="flex justify-between gap-2 font-medium"><span>{queue.mode === 'continuous' ? 'Your queue' : 'Batch ' + (queue.batch || 1)}</span><span>{queue.status === 'paused' ? 'Paused' : current.some(inFlight) ? 'Filling' : current.some(i => i.state === 'needs-action') ? 'Needs your action' : 'Ready to review'}</span></div>
        <p className="text-xs text-indigo-900">{finished} of {queue.items.length} finished · {waiting} waiting</p>
        <p className="truncate text-xs text-slate-500" title={queue.resumeName}>Using {queue.presetName} · locked</p>
        <progress className="h-1.5 w-full accent-indigo-600" aria-label="Queue progress" value={finished} max={queue.items.length} />
      </div>
      <div className="rounded-lg border border-slate-200 p-2.5 space-y-1">
        <label className="flex items-center justify-between gap-3 text-xs font-medium">{queue.mode === 'continuous' ? 'Open application limit' : 'Next batch size'}
          <span className="w-20 shrink-0"><Select aria-label={queue.mode === 'continuous' ? 'Open application limit' : 'Next batch size'} options={['1','2','3','4','5']} value={String(queue.batchSize)} disabled={busy} onChange={e => control('size', Number(e.target.value))} /></span>
        </label>
        <p className="text-xs text-slate-500">{occupied} slot{occupied === 1 ? '' : 's'} in use.{queue.status === 'paused' ? ' Paused: open applications can finish; new jobs wait.' : occupied > queue.batchSize ? ' Above the new limit. Tabs stay open until you finish them.' : !waiting ? ' No more jobs waiting. Add links below.' : queue.mode === 'continuous' ? ' Increasing the limit opens more jobs now.' : ' Changes apply to the next batch.'}</p>
      </div>
      <p className="text-xs leading-relaxed text-slate-600">Save answers before submitting. {queue.autoDetectSubmission ? 'Supported Greenhouse, Lever or Ashby success closes the tab automatically; otherwise use Submitted.' : 'Choose Submitted here after success on the website.'}</p>
      <ul className="space-y-2">{current.map((item, index) => <QueueCard key={item.id} item={item} index={index} queue={queue}
        app={applications.find(app => app.id === item.applicationId)} active={item.tabId !== undefined && item.tabId === activeTabId} busy={busy} perform={perform} />)}</ul>
      <div className="flex gap-2"><Button variant="secondary" disabled={busy} onClick={() => control(queue.status === 'paused' ? 'resume' : 'pause')}>{queue.status === 'paused' ? 'Resume queue' : 'Pause queue'}</Button><details className="relative text-sm"><summary className="cursor-pointer rounded-lg px-3 py-2 text-slate-600">Queue options</summary><div className="mt-1 rounded-lg border border-slate-200 bg-white p-2"><Button variant="ghost" disabled={busy} onClick={() => control('stop')}>Stop queue</Button><p className="max-w-44 text-xs text-slate-500">Stops autofill; keeps opened tabs and their answers.</p></div></details></div>
      <details className="rounded-lg border border-slate-200 p-2.5"><summary className="cursor-pointer text-sm font-medium">Add job links</summary><div className="mt-3 space-y-2">{linkInput}<p className="text-xs text-slate-500">New jobs use this queue’s {queue.presetName} preset. Existing progress stays saved.</p><Button className="w-full" disabled={busy || !fresh.length || !!preview.error} onClick={() => start(true)}>Add to queue{fresh.length ? ` (${fresh.length})` : ''}</Button></div></details>
    </> : <>
      {queue && noticeLoaded && dismissedNotice !== queue.token + ':' + queue.status && <Notice tone={queue.status === 'complete' ? 'success' : 'info'} onDismiss={dismissNotice} dismissLabel="Dismiss queue notification">{queue.status === 'complete' ? 'Queue complete.' : 'Queue stopped. Opened applications were kept.'} {finished} of {queue.items.length} finished.</Notice>}
      {linkInput}
      <label className="block text-xs font-medium">{continuous ? 'Applications open at once' : 'Applications per batch'}
        <Select aria-label={continuous ? 'Applications open at once' : 'Applications per batch'} options={['1','2','3','4','5']} value={String(size)} onChange={e => draft(text, Number(e.target.value))} />
      </label>
      <p className="text-xs text-slate-500">Opens up to {size} tabs. {continuous ? 'Finishing one makes room for the next job.' : 'Review the whole batch before the next batch opens.'}</p>
      <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" className="mt-0.5 accent-indigo-600" checked={continuous} onChange={e => draft(text, size, e.target.checked)} />Open the next job when an application finishes</label>
      <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" className="mt-0.5 accent-indigo-600" checked={detectSubmission} onChange={e => draft(text, size, continuous, e.target.checked)} />Close confirmed submissions automatically</label>
      <p className="text-xs text-slate-500">You submit every application yourself. A click or validation error never counts as success.</p>
      <Button className="w-full" disabled={busy || !presetId || !fresh.length || !!preview.error} onClick={() => start()}>{busy ? 'Starting…' : 'Start queue'}</Button>
    </>}
    {feedback && <Notice tone="success" onDismiss={() => setFeedback('')}>{feedback}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
  </section>;
}

function LinkChoices({ choices, selected, busy, onSelect, onOpen }: {
  choices: QueueLinkChoice[]; selected: number[]; busy: boolean;
  onSelect(id: number, checked: boolean): void; onOpen(choice: QueueLinkChoice): void;
}) {
  const tracked = choices.filter(c => c.kind !== 'new');
  return <>
    {tracked.length > 0 && <ul aria-label="Previously seen jobs" className="max-h-64 space-y-3 overflow-auto">{tracked.map(choice => <li key={choice.url} className="space-y-1 border-t border-slate-200 pt-2">
      <p className="break-words font-medium">{choice.app?.role || new URL(choice.url).pathname}</p>
      <p className="text-slate-500">{choice.kind === 'queued' ? `Already queued · ${applicationWorkflow(undefined, choice.item).title}` : choice.app?.status}</p>
      {(choice.kind === 'unfinished' || choice.kind === 'abandoned') && choice.app?.id !== undefined && <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 accent-indigo-600" disabled={busy} checked={selected.includes(choice.app.id)} onChange={e => onSelect(choice.app!.id!, e.target.checked)} />{choice.kind === 'abandoned' ? 'Retry in queue' : 'Resume in queue'} (new tab)</label>}
      {choice.kind === 'queued' && choice.item?.tabId === undefined ? <p>{choice.item?.state === 'submitted' ? 'Submitted jobs stay excluded.' : choice.item?.state === 'skipped' ? 'Abandoned in this queue. Finish or stop the queue before starting a new one to retry.' : choice.item?.batch === 0 ? 'Waiting to open; no duplicate will be added.' : 'Use Retry autofill on its queue card; no duplicate will be added.'}</p> : <button type="button" disabled={busy} className="text-indigo-700 underline disabled:opacity-50" onClick={() => onOpen(choice)}>{choice.kind === 'queued' ? 'Open existing queue tab' : 'View application'}</button>}
      {(choice.kind === 'unfinished' || choice.kind === 'abandoned') && <p className="text-slate-500">Saved Profile and Memories refill a new tab. Unsaved answers stay in the original tab.</p>}
    </li>)}</ul>}
    {choices.some(c => c.kind === 'new') && <details><summary className="cursor-pointer font-medium">Review new links ({choices.filter(c => c.kind === 'new').length})</summary><ul className="mt-2 max-h-40 space-y-2 overflow-auto">{choices.filter(c => c.kind === 'new').map(c => <li className="break-all" key={c.url}>{c.url}</li>)}</ul></details>}
  </>;
}

function QueueCard({ item, index, queue, app, active, busy, perform }: {
  item: QueueItem; index: number; queue: QueueRecord; app?: Application; active: boolean; busy: boolean;
  perform(work: () => Promise<{ ok: boolean; error?: string }>): Promise<void>;
}) {
  const [more, setMore] = useState(false);
  const workflow = applicationWorkflow(app, item);
  const state = workflow.title;
  const statusColor = item.state === 'needs-action' || workflow.phase === 'needs-answers' ? 'bg-amber-50 text-amber-800' : item.state === 'review' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600';
  const finished = settled(item);
  function action(action: 'open' | 'retry' | 'review' | 'submitted' | 'skip') {
    return perform(async () => {
      const result = await sendToBackground('queueAction', { token: queue.token, itemId: item.id, action });
      if (result.ok) {
        setMore(false);
        if ((action === 'open' && item.state === 'review' && app?.missingCount) || action === 'review') await browser.storage.local.set({ 'sidebarSection:review': true });
        if (action === 'open') requestAnimationFrame(() => {
          document.getElementById('current-page-review')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
      return result;
    });
  }
  return <li data-queue-item={item.id} className={'space-y-2 rounded-lg border p-2.5 ' + (active ? 'border-indigo-300 bg-indigo-50/30' : 'border-slate-200 bg-white')}>
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500">{queue.mode === 'continuous' ? queue.items.findIndex(i => i.id === item.id) + 1 : index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900" title={app?.role || item.url}>{app?.role || new URL(item.url).hostname}</p>
        <p className="truncate text-xs text-slate-500">{app?.company || new URL(item.url).hostname}{active ? ' · Viewing' : ''}</p>
      </div>
      <span className={'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ' + statusColor}>{state}</span>
    </div>
    {item.state === 'filling' && item.tabId !== undefined && <FillPhase tabId={item.tabId} />}
    {item.note && <p className="text-xs text-amber-800">{item.note}</p>}
    {app && item.state === 'review' && <p className="text-xs text-slate-500">{app.filledCount} filled · {app.missingCount} need you</p>}
    {finished && item.tabId !== undefined && <div className="space-y-1"><p className="text-xs text-amber-800">Outcome saved. This tab still occupies a slot.</p><Button variant="secondary" disabled={busy} onClick={() => action(item.state === 'submitted' ? 'submitted' : 'skip')}>Retry closing tab</Button></div>}
    {!finished && <div className="flex items-center gap-2">
      {item.tabId !== undefined && <button type="button" disabled={busy} className={'rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ' + (item.state === 'review' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'border border-slate-300 text-slate-700 hover:bg-slate-50')} onClick={() => action('open')}>{item.waitingFor === 'login' || item.waitingFor === 'account' ? 'Open to sign in' : item.waitingFor ? 'Open application' : 'Review'}</button>}
      {workflow.canConfirmSubmission && <button type="button" disabled={busy} aria-label="Submitted — close tab" title="Confirm successful submission and close this tab" className="rounded-md border border-green-200 px-3 py-1.5 text-xs font-medium text-green-800 hover:bg-green-50 disabled:opacity-50" onClick={() => action('submitted')}>✓ Submitted</button>}
      {item.state === 'needs-action' && !item.waitingFor && <button type="button" disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50" onClick={() => action('retry')}>Retry autofill</button>}
      {workflow.canFinishManually && <button type="button" disabled={busy} className="rounded-md border border-indigo-200 px-2 py-1.5 text-xs font-medium text-indigo-700 disabled:opacity-50" onClick={() => action('review')}>Stop autofill & review</button>}
      <button type="button" className="ml-auto rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100" aria-expanded={more} aria-controls={'queue-more-' + item.id} onClick={() => setMore(value => !value)}>{more ? 'Less' : 'More'} <span aria-hidden>{more ? '▴' : '▾'}</span></button>
    </div>}
    {!finished && <div id={'queue-more-' + item.id} hidden={!more} className="space-y-2 border-t border-slate-100 pt-2">
      <div className="flex flex-wrap gap-2">
        {(['review','opening','filling'].includes(item.state) || item.waitingFor) && <button type="button" disabled={busy} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50" onClick={() => action('retry')}>{inFlight(item) || item.waitingFor ? 'Restart autofill' : 'Fill this step'}</button>}
        <button type="button" disabled={busy} className="rounded-md px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50" onClick={async () => {
          if (await confirmDelete('Abandon this application?', 'Autofill will stop and its queue tab will close. The application is recorded as Abandoned, never Submitted. Save any answers you want to keep first.', 'Abandon — close tab')) await action('skip');
        }}>Abandon — close tab</button>
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
