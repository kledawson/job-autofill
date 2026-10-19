import { useSidebarVisibility } from '@/components/SidebarPreferences';
import { readSidebarVisibility, SIDEBAR_VISIBILITY_KEY, type SidebarId } from '@/lib/sidebar-layout';
import { SidebarLayout } from '@/components/SidebarLayout';
import { SidebarSection } from '@/components/SidebarSection';
import { ApplicationQueue } from '@/components/ApplicationQueue';
import { PresetSelector } from '@/components/Presets';
import { ProfileAnswer } from '@/components/ProfileAnswer';
import { useEffect, useRef, useState } from 'react';
import { FieldReviewList } from '@/components/FieldReviewList';
import { browser } from 'wxt/browser';
import { useLiveQuery, usePublicSettings } from '@/components/hooks';
import { Button, cx, Input, Notice, Select } from '@/components/ui';
import { db, getProfile } from '@/lib/db';
import { missingRequired } from '@/components/ProfileSections';
import { pageStatusKey, sendToBackground, type PageStatus } from '@/lib/messages';
import { ALL_SITES, detectPlatform, jobKey } from '@/lib/platforms';
import type { Application, ApplicationStatus } from '@/lib/types';
import { draftForCapture, MappingEditor } from '@/components/KnowledgeBase';
import { confirmDelete } from '@/components/confirm-delete';
import { BatchRemember } from '@/components/BatchRemember';
import type { CapturedAnswer, MappingDraft, ReviewField } from '@/lib/remembered-mappings';
import { applicationWorkflow } from '@/lib/application-workflow';
import type { QueueItem } from '@/lib/application-queue';

const STATUS_STYLE: Record<ApplicationStatus, string> = {
  Filling: 'bg-blue-50 text-blue-700 ring-blue-200',
  'Ready for review': 'bg-amber-50 text-amber-800 ring-amber-200',
  Submitted: 'bg-green-50 text-green-700 ring-green-200',
  Abandoned: 'bg-slate-100 text-slate-600 ring-slate-200',
};

function StatusPill({ status }: { status: ApplicationStatus }) {
  return (
    <span className={cx('inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', STATUS_STYLE[status])}>
      {status}
    </span>
  );
}

function useActiveTab() {
  const [tab, setTab] = useState<{ id?: number; url?: string }>({});
  useEffect(() => {
    let mounted = true, revision = 0;
    const refresh = async () => {
      const request = ++revision;
      const [t] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      if (mounted && request === revision) setTab({ id: t?.id, url: t?.url });
    };
    void refresh();
    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onUpdated.addListener(refresh);
    browser.windows.onFocusChanged.addListener(refresh);
    return () => {
      mounted = false;
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(refresh);
      browser.windows.onFocusChanged.removeListener(refresh);
    };
  }, []);
  return tab;
}

/** What the content script last reported for a tab, while the tab is still on the site that reported it. */
function usePageStatus(tabId: number | undefined, tabUrl: string | undefined) {
  type Stored = PageStatus & { origin: string; url?: string };
  const [stored, setStored] = useState<Stored | null>(null);
  useEffect(() => {
    setStored(null);
    if (tabId === undefined) return;
    let mounted = true, revision = 0;
    const key = pageStatusKey(tabId);
    void browser.storage.session.get(key).then((r) => {
      if (mounted && revision === 0) setStored((r[key] as Stored | undefined) ?? null);
    }).catch(() => undefined);
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'session' && key in changes) { revision++; setStored((changes[key]!.newValue as Stored | undefined) ?? null); }
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => { mounted = false; browser.storage.onChanged.removeListener(onChanged); };
  }, [tabId]);
  let origin = '';
  try {
    origin = tabUrl ? new URL(tabUrl).origin : '';
  } catch {}
  return stored && stored.origin === origin && (!stored.url || stored.url === tabUrl) ? stored : null;
}

/**
 * Pages outside the known job sites need the optional all-sites permission. Chrome only shows its prompt
 * during a click, so this must be the first thing a click handler awaits.
 */
async function ensureAccess(url: string | undefined): Promise<boolean> {
  if (url && detectPlatform(url)) return true;
  try {
    return await browser.permissions.request({ origins: ALL_SITES });
  } catch {
    return false;
  }
}

const ACCESS_DENIED = 'To fill applications outside Greenhouse, Lever, Ashby, and Workday, allow Job Autofill to read the site.';

const when = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

type HistoryFilter = 'all' | 'review' | 'submitted';
const HISTORY_FILTERS: [HistoryFilter, string, ApplicationStatus?][] = [
  ['all', 'All'], ['review', 'Ready for review', 'Ready for review'], ['submitted', 'Submitted', 'Submitted'],
];

export default function SidePanel() {
  const { settings } = usePublicSettings();
  const visibility = useSidebarVisibility();
  const profile = useLiveQuery(() => getProfile());
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const applications = useLiveQuery(() => {
    const status = HISTORY_FILTERS.find(f => f[0] === historyFilter)?.[2];
    const all = db.applications.orderBy('filledAt').reverse();
    return (status ? all.filter(a => a.status === status) : all).limit(50).toArray();
  }, [historyFilter]) ?? [];
  const { id: tabId, url: tabUrl } = useActiveTab();
  // History is intentionally bounded; the active job must survive more than 50 later fills.
  const tabApplications = useLiveQuery(() => tabId === undefined ? Promise.resolve([]) : db.applications.where('tabId').equals(tabId).sortBy('filledAt'), [tabId]);
  const current = tabApplications?.findLast(a => a.status !== 'Submitted') ?? tabApplications?.at(-1);
  const pageStatus = usePageStatus(tabId, tabUrl);
  const queue = useLiveQuery(() => db.applicationQueue.get('current'));
  const [presetId, setPresetId] = useState<string>();
  const preset = useLiveQuery(() => presetId ? db.presets.get(presetId) : Promise.resolve(undefined), [presetId]);
  const queueItem = queue && ['running', 'paused'].includes(queue.status) ? queue.items.find(i => i.tabId === tabId && !['submitted', 'skipped'].includes(i.state)) : undefined;
  const workflow = applicationWorkflow(current, queueItem);

  const [error, setError] = useState('');
  /** The tab and job where Fill this page was clicked. Its details show only there: another tab or application starts hidden. */
  const [shown, setShown] = useState<{ tabId: number; key: string }>();
  /** Set by Open and fill, whose new tab has no id yet: its details open once the application exists. */
  const [opened, setOpened] = useState(false);
  const here = tabId !== undefined && tabUrl ? { tabId, key: jobKey(tabUrl) } : undefined;
  const showing = !!here && ((shown?.tabId === here.tabId && shown.key === here.key) || !!queue?.items.some(i => i.tabId === here.tabId && i.applicationId === current?.id) || !!current && ['Ready for review', 'Submitted'].includes(current.status));
  useEffect(() => {
    if (opened && current && here) {
      setShown(here);
      setOpened(false);
    }
  }, [opened, current, here?.tabId, here?.key]);
  // A fill started by anything other than this panel's button (a message, shortcut or another panel) reports status while it runs.
  useEffect(() => {
    if (!here) return;
    const key = pageStatusKey(here.tabId);
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'session' && changes[key]?.newValue) setShown(here);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [here?.tabId, here?.key]);

  // Reveal attention once a new fill finishes, without reopening it on every manual edit.
  useEffect(() => {
    if (showing && workflow.canRemember && (current?.missingCount || current?.reviewFields?.length || current?.fieldFeedback?.some(f => f.status === 'review'))) {
      void browser.storage.local.set({ 'sidebarSection:review': true }).catch(() => undefined);
    }
  }, [showing, current?.id, workflow.canRemember]);

  async function revealSection(id: SidebarId) {
    const stored = await browser.storage.local.get(SIDEBAR_VISIBILITY_KEY);
    const next = readSidebarVisibility(stored[SIDEBAR_VISIBILITY_KEY]);
    if (!next[id]) await browser.storage.local.set({ [SIDEBAR_VISIBILITY_KEY]: { version: 1, categories: { ...next, [id]: true } } });
    const toggle = document.getElementById('sidebar-' + id + '-toggle');
    if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
    requestAnimationFrame(() => { toggle?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); toggle?.focus({ preventScroll: true }); });
  }

  async function fillThisPage() {
    setError('');
    if (!presetId) return;
    if (!(await ensureAccess(tabUrl))) return setError(ACCESS_DENIED);
    if (here) setShown(here);
    const res = queueItem && queue
      ? await sendToBackground('queueAction', { token: queue.token, itemId: queueItem.id, action: queueItem.waitingFor ? 'open' : 'retry' })
      : await sendToBackground('fillActiveTab', { presetId });
    if (!res.ok) {
      setShown(undefined);
      setError(res.error);
    }
  }

  return (
    <div className="flex min-h-screen flex-col gap-2 p-3 text-sm">
      <div id="sidebar-fill" className="sticky top-0 z-20 -mx-3 -mt-3 space-y-2 border-b border-slate-200 bg-slate-50 px-3 pb-3 pt-3">
      <header className="flex items-center gap-2">
        <img src="/icon/32.png" alt="" className="size-6" />
        <h1 className="flex-1 text-base font-semibold">Job Autofill</h1>
        <Button variant="ghost" className="px-2 py-1" onClick={() => browser.runtime.openOptionsPage()}>
          Settings
        </Button>
      </header>

      <section aria-label="Fill this page" className="space-y-2">
        {settings && !settings.onboardingComplete && <p className="text-xs text-slate-600">New here? <button className="font-medium text-indigo-700 underline" onClick={() => browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') })}>Continue setup</button> to add your profile.</p>}
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500"><span className="truncate">Preset: {queueItem ? queue?.presetName + ' · locked' : preset?.name || 'Default'}</span>
          <button className="shrink-0 text-indigo-700 underline" onClick={() => {
            if (visibility.presets) void revealSection('presets');
            else void browser.tabs.create({ url: browser.runtime.getURL('/options.html#presets' as never) });
          }}>Change preset</button></div>
        <Button className="w-full" disabled={!presetId} onClick={fillThisPage}>
          {queueItem && ['opening', 'filling'].includes(queueItem.state) ? 'Restart autofill' : 'Fill this page'}
        </Button>
        {error && <Notice tone="error">{error}</Notice>}
      </section>
      </div>
      <section id="current-page-review" aria-label="Current page review" className="scroll-mt-40 rounded-xl border border-slate-200 bg-white p-3 shadow-sm" hidden={!showing}>
        {showing &&
          (queueItem?.state === 'needs-action' && !current ? <PageStatusBox status={{ title: workflow.title, lines: [queueItem.note || 'Finish this step on the website, then retry autofill.'], tone: 'attention' }} /> : current ? (
            <ApplicationSummary key={current.id} app={current} pageStatus={pageStatus} sheetUrl={settings?.sheetUrl}
              queueItem={queueItem}
              queueEntry={queueItem && queue ? { token: queue.token, itemId: queueItem.id, ready: queueItem.state === 'review', autoDetectSubmission: queue.autoDetectSubmission } : undefined} onReview={() => void revealSection('review')} />
          ) : (
            <PageStatusBox status={pageStatus ?? { title: 'Filling application…', lines: ['Looking for the form.'], tone: 'working' }} />
          ))}
      </section>
      <SidebarLayout>
      <SidebarSection id="queue" title="Application queue" defaultOpen summary={queue && !['stopped','complete'].includes(queue.status) ? queue.mode === 'continuous' ? 'Next job after each finish' : 'Batch ' + (queue.batch || 1) : undefined}>
        <ApplicationQueue presetId={presetId} activeTabId={tabId} />
      </SidebarSection>
      <SidebarSection id="review" title="Review & remember" summary={showing && current ? current.status === 'Submitted' ? 'Completed' : (current.reviewFields?.filter(field => field.answered).length || 0) + ' ready to save · ' + current.missingCount + ' need you' : undefined}>
        {showing && current ? <ApplicationReview key={current.id} app={current} canRemember={workflow.canRemember} /> : <p className="text-xs text-slate-500">Fill an application to review missing questions and remember answers here.</p>}
      </SidebarSection>
      <SidebarSection id="setup" title="Setup & connections">
        <div className="space-y-2 text-xs text-slate-600">
          <p>{settings?.onboardingComplete ? profile && missingRequired(profile).length ? missingRequired(profile).length + ' required profile fields missing.' : 'Your profile is ready.' : 'Finish setup to add your profile.'}</p>
          {!settings?.onboardingComplete && <button className="text-indigo-700 underline" onClick={() => browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') })}>Continue setup</button>}
          <a className="block text-indigo-700 underline" href={browser.runtime.getURL('/options.html#profile' as never)} target="_blank" rel="noreferrer">Edit profile</a>
          <p>AI responses: {settings?.hasGeminiKey ? 'Connected' : 'Not connected'}</p>
          <p>Google Sheets: {settings?.sheetUrl ? 'Connected' : 'Not connected'}</p>
          <a className="block text-indigo-700 underline" href={browser.runtime.getURL('/options.html#connections' as never)} target="_blank" rel="noreferrer">Manage connections</a>
        </div>
      </SidebarSection>
      <SidebarSection id="track" title="Track without autofill">
        <TrackOnly tabUrl={tabUrl} sheetUrl={settings?.sheetUrl} />
      </SidebarSection>

      <SidebarSection id="history" title="Applications" summary={String(applications.length)}>
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            Show
            <Select className="w-auto" aria-label="Filter applications by status" options={HISTORY_FILTERS.map(f => [f[0], f[1]] as [string, string])} value={historyFilter} onChange={e => setHistoryFilter(e.target.value as HistoryFilter)} />
          </label>
          <div className="flex shrink-0 items-center gap-3">
            {applications.length > 0 && (
              <button
                type="button"
                className="whitespace-nowrap text-xs font-medium text-red-700 underline focus-visible:ring-2 focus-visible:ring-indigo-500"
                onClick={async () => {
                  const filter = HISTORY_FILTERS.find(f => f[0] === historyFilter);
                  const status = filter?.[2];
                  const total = status ? await db.applications.where('status').equals(status).count() : await db.applications.count();
                  const noun = `application${total === 1 ? '' : 's'}`;
                  const [title, detail] = status
                    ? [`Delete ${total} "${filter![1]}" ${noun}?`, `Only "${filter![1]}" applications will be removed, including older ones that are not shown. Other statuses are kept. Your Google Sheet is not changed.`]
                    : [`Delete all ${total} ${noun}?`, 'Every application will be removed from this list, including older ones that are not shown. Your Google Sheet is not changed.'];
                  if (!(await confirmDelete(title, detail, 'Delete all'))) return;
                  const res = await sendToBackground('clearApplications', { status });
                  if (!res.ok) setError(res.error);
                }}
              >
                Clear all
              </button>
            )}
            {settings?.sheetUrl && (
              <a className="whitespace-nowrap text-xs font-medium text-indigo-700 underline" href={settings.sheetUrl} target="_blank" rel="noreferrer">
                Open sheet
              </a>
            )}
          </div>
        </div>
        {applications.length === 0 ? (
          <p className="text-slate-500">{historyFilter === 'all' ? 'Applications you fill show up here.' : 'No applications match this filter.'}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {applications.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <a className="block truncate font-medium text-slate-800 hover:underline" href={a.url} target="_blank" rel="noreferrer">
                    {a.role || 'Untitled role'}
                  </a>
                  <p className="flex text-xs text-slate-500">
                    <span className="min-w-0 truncate">{a.company}{a.presetName ? ` · ${a.presetName}` : ''}</span>
                    <span className="shrink-0 whitespace-pre"> · {when(a.filledAt)}</span>
                  </p>
                  {a.sheetSyncPending && <p role="status" className="text-xs text-slate-500">Updating sheet…</p>}
                  {a.sheetError && <div className="text-xs text-amber-700"><p>Submitted · Sheet sync needs retry: {a.sheetError}</p><button className="font-medium underline" onClick={async () => { const res = await sendToBackground('retrySheet', { applicationId: a.id! }); if (!res.ok) setError(res.error); }}>Retry sheet sync</button></div>}
                </div>
                <StatusPill status={a.status} />
                <button
                  type="button"
                  className="shrink-0 rounded-md px-1.5 py-1 text-slate-400 hover:bg-red-50 hover:text-red-700 focus-visible:ring-2 focus-visible:ring-indigo-500"
                  aria-label={`Delete ${a.role || 'application'} at ${a.company} from this list`}
                  title="Delete from this list"
                  onClick={async () => {
                    if (!(await confirmDelete('Delete this application?', `${a.role || 'Untitled role'} at ${a.company} will be removed from this list. Your Google Sheet is not changed.`, 'Delete'))) return;
                    const res = await sendToBackground('deleteApplication', { applicationId: a.id! });
                    if (!res.ok) setError(res.error);
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      </SidebarSection>
      <SidebarSection id="presets" title="Application preset" summary={preset?.name || 'Default'}>
        <PresetSelector onSelected={setPresetId} />
      </SidebarSection>
      </SidebarLayout>
    </div>
  );
}

/** For postings with no form to fill (e.g. a one-click apply): log the link as submitted and add it to the sheet. */
function TrackOnly({ tabUrl, sheetUrl }: { tabUrl?: string; sheetUrl?: string }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ note: string; sheetRow?: number; sheetError?: string } | null>(null);

  async function submit() {
    setError('');
    setDone(null);
    // Reading the open posting needs site access; tracking still works if it is declined. Must be the first await in the click.
    await ensureAccess(link.trim()).catch(() => false);
    setBusy(true);
    const res = await sendToBackground('trackApplication', { url: link });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setDone({ note: res.note, sheetRow: res.sheetRow, sheetError: res.sheetError });
    setLink('');
  }

  const usable = tabUrl && /^https?:\/\//i.test(tabUrl) ? tabUrl : '';
  return (
    <section className="space-y-2">
      <p className="text-xs text-slate-500">For postings with just an Apply button. Log the link as submitted and add it to your sheet.</p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) void submit();
        }}
      >
        <div className="flex gap-2">
          <Input aria-label="Application Link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Application Link" />
          {usable && !link && (
            <Button type="button" variant="secondary" className="shrink-0" onClick={() => setLink(usable)}>
              This tab
            </Button>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={busy || !link.trim()}>
          Mark as submitted
        </Button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {done && (
        <>
          <Notice tone="info">Marked as submitted. {done.note}</Notice>
          {done.sheetRow && sheetUrl ? (
            <Notice tone="success">
              Added to your sheet (row {done.sheetRow}).{' '}
              <a className="underline" href={`${sheetUrl}#range=A${done.sheetRow}`} target="_blank" rel="noreferrer">
                Open sheet
              </a>
            </Notice>
          ) : done.sheetError ? (
            <Notice tone="warn">Sheet not updated: {done.sheetError}</Notice>
          ) : null}
        </>
      )}
    </section>
  );
}

function PageStatusBox({ status, hideTitle }: { status: PageStatus; hideTitle?: boolean }) {
  if (hideTitle && !status.lines.length) return null;
  return (
    <div className="space-y-0.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700" role="status">
      {!hideTitle && (
        <p className="flex items-center gap-2 font-semibold text-slate-800">
          <span className={cx('size-2 shrink-0 rounded-full', status.tone === 'working' ? 'bg-blue-600' : status.tone === 'attention' ? 'bg-amber-500' : 'bg-green-600')} />
          {status.title}
        </p>
      )}
      {status.lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </div>
  );
}

function ApplicationSummary({ app, pageStatus, sheetUrl, queueItem, queueEntry, onReview }: { app: Application; pageStatus: PageStatus | null; sheetUrl?: string; queueItem?: QueueItem; queueEntry?: { token: string; itemId: string; ready: boolean; autoDetectSubmission?: boolean }; onReview(): void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const workflow = applicationWorkflow(app, queueItem);
  const toCheck = app.fieldFeedback?.filter(f => f.status === 'review').length ?? app.aiAnswers;
  const attentionCount = app.fieldFeedback?.filter(f => ['missing', 'review', 'optional'].includes(f.status) || app.reviewFields?.some(r => r.token === f.token)).length ?? (app.reviewFields?.length || app.missingCount);
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{app.role || 'Application'}</p>
          <p className="truncate text-slate-500">{app.company}</p>

        </div>
        <span className={cx('inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', workflow.writing ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700')}>{workflow.title}</span>
      </div>

      {!workflow.writing && app.status !== 'Submitted' && <p className="text-xs text-slate-600">{[app.missingCount ? `${app.missingCount} missing` : '', toCheck ? `${toCheck} to review` : ''].filter(Boolean).join(' · ') || 'Review the filled answers on the website.'}</p>}
      {/* The pill already names the status, so a matching title is left out. */}
      {workflow.writing && pageStatus?.tone === 'working' && <PageStatusBox status={pageStatus} hideTitle={pageStatus.title === app.status} />}
      {!workflow.writing && <details className="text-xs text-slate-500"><summary className="cursor-pointer">Fill details</summary><p>{app.filledCount} filled in the latest attempt{app.aiAnswers > 0 && ` · ${app.aiAnswers} AI-written`}</p>{pageStatus && <PageStatusBox status={pageStatus} hideTitle={pageStatus.title === app.status} />}{app.resumeName && <p className="mt-1">Resume: {app.resumeName}</p>}</details>}

      {app.status !== 'Submitted' && (app.missingCount > 0 || !!app.reviewFields?.length || !!app.fieldFeedback?.length) && <button className="text-xs font-medium text-indigo-700 underline" onClick={onReview}>{attentionCount ? `Review & remember (${attentionCount})` : 'Review filled answers'}</button>}
      {app.submissionIssue === 'validation' && <Notice tone="warn">Submission needs attention. Fix the website’s missing or invalid answers, then submit again. This application has stayed open.</Notice>}
      {workflow.canConfirmSubmission && (
        <>
          <p className="text-xs text-slate-500">{queueEntry?.autoDetectSubmission && ['greenhouse', 'lever', 'ashby'].includes(app.platform) ? 'Save Memories before submitting on the website. Recognized success confirmations close this tab; use Submitted below if detection misses it.' : 'Submit on the website. If the result is not detected, confirm successful submission below.'}</p>
          <Button
            className="w-full" disabled={busy}
            onClick={async () => {
              setBusy(true); setError('');
              try { const res = await sendToBackground('markSubmitted', { applicationId: app.id! }); if (!res.ok) setError(res.error); }
              catch { setError('Could not confirm submission. Try again.'); } finally { setBusy(false); }
            }}
          >
            {busy ? 'Confirming…' : queueEntry ? 'Submitted — close tab' : 'I submitted this application'}
          </Button>
        </>
      )}
      {workflow.writing && <p className="text-xs text-slate-500">Known answers fill first. Optional AI responses may take longer.</p>}
      {workflow.phase === 'blocked' && queueItem?.note && <Notice tone="warn">{queueItem.note} Use the queue's Retry autofill action to continue.</Notice>}
      {app.status === 'Submitted' && <div role="status" className="space-y-2 rounded-lg bg-green-50 p-2 text-xs text-green-800"><p>{app.submissionSource && app.submissionSource !== 'user' ? 'Successful submission detected.' : 'Submission confirmed by you.'}</p>{!queueEntry && app.tabId !== undefined && <Button variant="secondary" disabled={busy} onClick={async () => { setBusy(true); const res = await sendToBackground('closeSubmittedTab', { applicationId: app.id! }); if (!res.ok) setError(res.error); setBusy(false); }}>Close application tab</Button>}</div>}
      {app.sheetSyncPending && <p role="status" className="text-xs text-slate-600">Submitted · Updating your sheet…</p>}
      {app.status === 'Submitted' && app.sheetRow && sheetUrl && (
        <Notice tone="success">
          Added to your sheet (row {app.sheetRow}).{' '}
          <a className="underline" href={`${sheetUrl}#range=A${app.sheetRow}`} target="_blank" rel="noreferrer">
            Open sheet
          </a>
        </Notice>
      )}
      {app.sheetError && (
        <>
          <Notice tone="warn">Sheet not updated: {app.sheetError}</Notice>
          {app.status === 'Submitted' && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={async () => {
                const res = await sendToBackground('retrySheet', { applicationId: app.id! });
                if (!res.ok) setError(res.error);
              }}
            >
              Retry adding to sheet
            </Button>
          )}
        </>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function ApplicationReview({ app, canRemember }: { app: Application; canRemember: boolean }) {
  const [showMissing, setShowMissing] = useState(true);
  const [error, setError] = useState('');
  const [teaching, setTeaching] = useState<{ capture: CapturedAnswer; initial: MappingDraft; id?: number }>();
  const [remembered, setRemembered] = useState('');
  const [capturing, setCapturing] = useState<string>();
  const [batch, setBatch] = useState<{ captures: CapturedAnswer[]; skipped: { label: string; reason: string }[] }>();
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!teaching && !batch) return;
    requestAnimationFrame(() => { editor.current?.scrollIntoView({ block: 'nearest' }); editor.current?.focus({ preventScroll: true }); });
  }, [teaching?.capture.captureId, batch]);
  const context = { platform: app.platform, company: app.company, url: app.url };
  async function showField(token: string) {
    setError('');
    try {
      const result = await sendToBackground('showApplicationField', { applicationId: app.id!, token });
      if (!result.ok) throw new Error(result.error);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not locate the field.'); }
  }
  async function remember(field: ReviewField, suggestion = false) {
    setCapturing(field.token); setError(''); setRemembered('');
    try {
      const res = await sendToBackground('capturePageAnswer', { applicationId: app.id!, token: field.token,
        ...(suggestion ? { suggestionId: field.suggestionId } : {}) });
      if (!res.ok) throw new Error(res.error);
      setTeaching({ capture: res.capture, id: res.suggestion?.id, initial: res.suggestion ?
        { ...res.suggestion, aliases: [...new Set([...res.suggestion.aliases, res.capture.label])] } :
        draftForCapture(res.capture, context) });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not capture this answer.'); }
    finally { setCapturing(undefined); }
  }
  const reviewFields = app.reviewFields ?? [];
  const answered = reviewFields.filter(f => f.answered);
  async function rememberAll() {
    setCapturing('all'); setError(''); setRemembered('');
    try {
      const result = await sendToBackground('capturePageAnswers', { applicationId: app.id!, tokens: answered.slice(0, 100).map(f => f.token) });
      if (!result.ok) throw new Error(result.error);
      setBatch({ captures: result.captures, skipped: result.skipped });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not read the answered questions.'); }
    finally { setCapturing(undefined); }
  }
  return (
    <div className="space-y-2">
      <p className="truncate text-xs text-slate-500" title={app.role}>{app.role} · {app.company}</p>
      {app.status === 'Submitted' && <p className="text-xs text-slate-600">Application submitted. Save reusable answers before submitting your next application.</p>}
      {app.status !== 'Submitted' && !teaching && !batch && (app.missingLabels.length > 0 || reviewFields.length > 0 || !!app.fieldFeedback?.length) && (
        <div>
          <Button className="mb-3 w-full" variant={answered.length ? 'primary' : 'secondary'} disabled={!answered.length || !!capturing || !canRemember} onClick={() => void rememberAll()}>{capturing === 'all' ? 'Reading answered questions…' : `Save all answered questions (${Math.min(answered.length, 100)})`}</Button>
          <p className="mb-2 text-xs text-slate-500">Answer on the website → review the captured answer → confirm Save to Profile or Memory.{answered.length > 100 ? ' Save up to 100 questions per batch.' : ''}</p>
          <button className="text-xs font-medium text-slate-600 underline" onClick={() => setShowMissing((s) => !s)}>
            {showMissing ? 'Hide' : 'Show'} questions to review
          </button>
          {showMissing && (
            <FieldReviewList app={app} disabled={!canRemember} capturing={capturing} onShow={token => void showField(token)} onRemember={(field, suggestion) => void remember(field, suggestion)} />
          )}
        </div>
      )}

      {(batch || teaching) && <div ref={editor} tabIndex={-1} role="region" aria-label="Review save destination" className="rounded-lg focus-visible:ring-2 focus-visible:ring-indigo-500">
      {batch && <BatchRemember applicationId={app.id!} context={context} {...batch} onCancel={() => setBatch(undefined)} onSaved={(note, count) => { setBatch(undefined); setRemembered(note); }} />}
      {teaching && (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          {teaching.capture.profileUpdate ? <ProfileAnswer capture={teaching.capture} applicationId={app.id!} onCancel={() => setTeaching(undefined)} onSaved={note => { setTeaching(undefined); setRemembered(note); }} /> : <MappingEditor key={teaching.capture.captureId} id={teaching.id} capture={teaching.capture} context={context} initial={teaching.initial}
            onCancel={() => setTeaching(undefined)} onSaved={async mappingId => {
              const res = await sendToBackground('applySavedAnswer', { applicationId: app.id!, token: teaching.capture.token, captureId: teaching.capture.captureId, mappingId });
              setTeaching(undefined);
              if (!res.ok) { setError(`Answer saved, but could not apply: ${res.error}`); return; }
              setRemembered(res.note);
            }} />}
        </div>
      )}
      </div>}
      {remembered && <div role="status"><Notice tone="success">{remembered}</Notice></div>}

      <a className="text-xs text-indigo-700 underline" href={browser.runtime.getURL('/options.html#memories' as never)} target="_blank" rel="noreferrer">Manage Memories in Settings</a>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
