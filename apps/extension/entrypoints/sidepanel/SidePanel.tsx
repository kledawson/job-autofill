import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { useLiveQuery, usePublicSettings } from '@/components/hooks';
import { missingRequired } from '@/components/ProfileSections';
import { Button, cx, Input, Notice } from '@/components/ui';
import { db, getProfile } from '@/lib/db';
import { pageStatusKey, sendToBackground, type PageStatus } from '@/lib/messages';
import { ALL_SITES, detectPlatform, PLATFORM_NAMES } from '@/lib/platforms';
import type { Application, ApplicationStatus } from '@/lib/types';
import { defaultScope, MappingEditor } from '@/components/KnowledgeBase';
import type { CapturedAnswer, MappingDraft, ReviewField } from '@/lib/remembered-mappings';

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
    const refresh = async () => {
      const [t] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      setTab({ id: t?.id, url: t?.url });
    };
    void refresh();
    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onUpdated.addListener(refresh);
    browser.windows.onFocusChanged.addListener(refresh);
    return () => {
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(refresh);
      browser.windows.onFocusChanged.removeListener(refresh);
    };
  }, []);
  return tab;
}

/** What the content script last reported for a tab, while the tab is still on the site that reported it. */
function usePageStatus(tabId: number | undefined, tabUrl: string | undefined) {
  type Stored = PageStatus & { origin: string };
  const [stored, setStored] = useState<Stored | null>(null);
  useEffect(() => {
    setStored(null);
    if (tabId === undefined) return;
    const key = pageStatusKey(tabId);
    void browser.storage.session.get(key).then((r) => setStored((r[key] as Stored | undefined) ?? null));
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'session' && key in changes) setStored((changes[key]!.newValue as Stored | undefined) ?? null);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [tabId]);
  let origin = '';
  try {
    origin = tabUrl ? new URL(tabUrl).origin : '';
  } catch {}
  return stored && stored.origin === origin ? stored : null;
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

export default function SidePanel() {
  const { settings } = usePublicSettings();
  const profile = useLiveQuery(() => getProfile());
  const applications = useLiveQuery(() => db.applications.orderBy('filledAt').reverse().limit(50).toArray()) ?? [];
  const { id: tabId, url: tabUrl } = useActiveTab();
  const current = applications.find((a) => a.tabId === tabId && a.status !== 'Submitted') ?? applications.find((a) => a.tabId === tabId);
  const pageStatus = usePageStatus(tabId, tabUrl);
  const resume = useLiveQuery(() => db.files.get('resume'));

  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [duplicate, setDuplicate] = useState<{ filledAt: number; status: string } | null>(null);

  const setupGaps = profile ? missingRequired(profile) : [];

  async function openAndFill(force = false) {
    setError('');
    setDuplicate(null);
    if (!(await ensureAccess(link.trim()))) return setError(ACCESS_DENIED);
    setBusy(true);
    const res = await sendToBackground('startFill', { url: link, force });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    if (res.duplicate) return setDuplicate(res.duplicate);
    setLink('');
  }

  async function fillThisPage() {
    setError('');
    if (!(await ensureAccess(tabUrl))) return setError(ACCESS_DENIED);
    const res = await sendToBackground('fillActiveTab', {});
    if (!res.ok) setError(res.error);
  }

  return (
    <div className="flex min-h-screen flex-col gap-4 p-4 text-sm">
      <header className="flex items-center gap-2">
        <img src="/icon/32.png" alt="" className="size-6" />
        <h1 className="flex-1 text-base font-semibold">Job Autofill</h1>
        <Button variant="ghost" className="px-2 py-1" onClick={() => browser.runtime.openOptionsPage()}>
          Settings
        </Button>
      </header>

      {settings && !settings.onboardingComplete ? (
        <Notice tone="info">
          Finish setup to start filling applications.{' '}
          <button className="font-medium underline" onClick={() => browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') })}>
            Continue setup
          </button>
        </Notice>
      ) : (
        <>
          {setupGaps.length > 0 && (
            <Notice tone="warn">
              Your profile is missing {setupGaps.join(', ')}.{' '}
              <button className="font-medium underline" onClick={() => browser.runtime.openOptionsPage()}>
                Edit profile
              </button>
            </Notice>
          )}
          {resume === null && (
            <Notice tone="warn">No resume uploaded, so upload fields will be left for you.</Notice>
          )}
          {settings && !settings.hasGeminiKey && (
            <Notice tone="info">Add a Gemini key in Settings to get AI-written free responses.</Notice>
          )}
        </>
      )}

      <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block font-medium text-slate-800" htmlFor="job-link">
          Job link
        </label>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim()) void openAndFill();
          }}
        >
          <Input
            id="job-link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste any job application link"
          />
          <Button type="submit" disabled={busy || !link.trim()} className="shrink-0">
            Open and fill
          </Button>
        </form>
        <Button variant="secondary" className="w-full" onClick={fillThisPage}>
          Fill this page
        </Button>
        {error && <Notice tone="error">{error}</Notice>}
        {duplicate && (
          <Notice tone="warn">
            You already filled this job on {when(duplicate.filledAt)} ({duplicate.status}).{' '}
            <button className="font-medium underline" onClick={() => openAndFill(true)}>
              Fill it again
            </button>
          </Notice>
        )}
      </section>

      {current ? (
        <CurrentApplication key={current.id} app={current} pageStatus={pageStatus} />
      ) : (
        pageStatus && (
          <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-indigo-700">This tab</p>
            <PageStatusBox status={pageStatus} />
          </section>
        )
      )}

      <section className="flex-1">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Applications</h2>
          {settings?.sheetUrl && (
            <a className="text-xs font-medium text-indigo-700 underline" href={settings.sheetUrl} target="_blank" rel="noreferrer">
              Open sheet
            </a>
          )}
        </div>
        {applications.length === 0 ? (
          <p className="text-slate-500">Applications you fill show up here.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {applications.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <a className="block truncate font-medium text-slate-800 hover:underline" href={a.url} target="_blank" rel="noreferrer">
                    {a.role || 'Untitled role'}
                  </a>
                  <p className="truncate text-xs text-slate-500">
                    {a.company} · {PLATFORM_NAMES[a.platform]} · {when(a.filledAt)}
                  </p>
                </div>
                <StatusPill status={a.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PageStatusBox({ status, hideTitle }: { status: PageStatus; hideTitle?: boolean }) {
  if (hideTitle && !status.lines.length) return null;
  return (
    <div className="space-y-0.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700" role="status">
      {!hideTitle && (
        <p className="flex items-center gap-2 font-semibold text-slate-800">
          <span className={cx('size-2 shrink-0 rounded-full', status.tone === 'working' ? 'bg-blue-600' : 'bg-green-600')} />
          {status.title}
        </p>
      )}
      {status.lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </div>
  );
}

function CurrentApplication({ app, pageStatus }: { app: Application; pageStatus: PageStatus | null }) {
  const [showMissing, setShowMissing] = useState(true);
  const [error, setError] = useState('');
  const [teaching, setTeaching] = useState<{ capture: CapturedAnswer; initial: MappingDraft; id?: number }>();
  const [remembered, setRemembered] = useState('');
  const [capturing, setCapturing] = useState<string>();
  const context = { platform: app.platform, company: app.company, url: app.url };
  async function remember(field: ReviewField, suggestion = false) {
    setCapturing(field.token); setError(''); setRemembered('');
    try {
      const res = await sendToBackground('capturePageAnswer', { applicationId: app.id!, token: field.token,
        ...(suggestion ? { suggestionId: field.suggestionId } : {}) });
      if (!res.ok) throw new Error(res.error);
      setTeaching({ capture: res.capture, id: res.suggestion?.id, initial: res.suggestion ?
        { ...res.suggestion, aliases: [...new Set([...res.suggestion.aliases, res.capture.label])] } :
        { question: res.capture.label, aliases: [], scope: defaultScope(res.capture.label, context), target: { kind: 'answer', value: res.capture.value } } });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not capture this answer.'); }
    finally { setCapturing(undefined); }
  }
  const reviewFields = app.reviewFields ?? [];
  return (
    <section className="space-y-3 rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-700">This tab</p>
          <p className="truncate font-semibold text-slate-900">{app.role || 'Application'}</p>
          <p className="truncate text-slate-500">{app.company}</p>
        </div>
        <StatusPill status={app.status} />
      </div>

      {app.status !== 'Filling' && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat value={app.filledCount} label="Profile / saved" color="text-green-700" />
          <Stat value={app.aiAnswers} label="AI-written" color="text-blue-700" />
          <Stat value={app.missingCount} label="Need you" color={app.missingCount ? 'text-red-700' : 'text-slate-400'} />
        </div>
      )}

      {/* The pill already names the status, so a matching title is left out. */}
      {pageStatus && <PageStatusBox status={pageStatus} hideTitle={pageStatus.title === app.status} />}

      {!teaching && (app.missingLabels.length > 0 || reviewFields.length > 0) && (
        <div>
          <button className="text-xs font-medium text-slate-600 underline" onClick={() => setShowMissing((s) => !s)}>
            {showMissing ? 'Hide' : 'Show'} questions to review
          </button>
          {showMissing && (
            <ul className="mt-2 space-y-2">
              {reviewFields.map(field => <li key={field.token} className={cx('rounded-lg border p-3 text-xs text-slate-700', field.answered ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white')}>
                <p className="font-medium break-words">{field.label}</p>
                <p className="mt-1 text-slate-600">{field.answered ? 'Answer entered — ready to save for next time.' : field.suggestionId ? 'A similar saved question is available. Confirm it before reuse.' : 'Answer on the page, then remember it here.'}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button className="px-2 py-1 text-xs" variant={field.answered ? 'primary' : 'secondary'} disabled={!!capturing || app.status === 'Filling'} onClick={() => void remember(field)}>{capturing === field.token ? 'Reading field…' : field.answered ? 'Save this answer' : 'Remember answer'}</Button>
                  {field.suggestionId && !field.answered && <Button className="px-2 py-1 text-xs" variant="secondary" disabled={!!capturing} onClick={() => void remember(field, true)}>Review suggestion</Button>}
                </div>
              </li>)}
              {app.missingLabels.filter((_, i) => !app.missingQuestions?.[i] || !reviewFields.some(f => f.label === app.missingQuestions?.[i])).map((label, i) => <li key={`manual-${i}`} className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{label}<p className="mt-1 text-slate-500">{app.reviewFields ? 'Complete this field on the page.' : 'Click Fill this page to refresh these results and enable answer capture.'}</p></li>)}
            </ul>
          )}
        </div>
      )}

      {teaching && (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          <MappingEditor key={teaching.capture.captureId} id={teaching.id} capture={teaching.capture} context={context} initial={teaching.initial}
            onCancel={() => setTeaching(undefined)} onSaved={async mappingId => {
              const res = await sendToBackground('applySavedAnswer', { applicationId: app.id!, token: teaching.capture.token, captureId: teaching.capture.captureId, mappingId });
              setTeaching(undefined);
              if (!res.ok) { setError(`Answer saved, but could not apply: ${res.error}`); return; }
              setRemembered(res.note);
            }} />
        </div>
      )}
      {remembered && <div role="status"><Notice tone="success">{remembered} Manage it in Settings → Saved answers.</Notice></div>}

      {app.status === 'Ready for review' && (
        <>
          <p className="text-xs text-slate-500">Review every field, submit on the page yourself, then mark it here.</p>
          <Button
            className="w-full"
            onClick={async () => {
              const res = await sendToBackground('markSubmitted', { applicationId: app.id! });
              if (!res.ok) setError(res.error);
            }}
          >
            Mark as submitted
          </Button>
        </>
      )}
      {app.status === 'Filling' && <p className="text-slate-500">Filling… AI answers can take a few seconds each.</p>}
      {app.sheetError && <Notice tone="warn">Sheet not updated: {app.sheetError}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="rounded-lg bg-slate-50 py-2">
      <div className={cx('text-lg font-semibold', color)}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
