import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { useLiveQuery, usePublicSettings } from '@/components/hooks';
import { missingRequired } from '@/components/ProfileSections';
import { Button, cx, Input, Notice } from '@/components/ui';
import { db, getProfile } from '@/lib/db';
import { sendToBackground } from '@/lib/messages';
import { ALL_SITES, detectPlatform, PLATFORM_NAMES } from '@/lib/platforms';
import type { Application, ApplicationStatus } from '@/lib/types';

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

      {current && <CurrentApplication app={current} />}

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

function CurrentApplication({ app }: { app: Application }) {
  const [showMissing, setShowMissing] = useState(true);
  const [error, setError] = useState('');
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
          <Stat value={app.filledCount} label="filled" color="text-green-700" />
          <Stat value={app.aiAnswers} label="AI-written" color="text-blue-700" />
          <Stat value={app.missingCount} label="need you" color={app.missingCount ? 'text-red-700' : 'text-slate-400'} />
        </div>
      )}

      {app.missingLabels.length > 0 && (
        <div>
          <button className="text-xs font-medium text-slate-600 underline" onClick={() => setShowMissing((s) => !s)}>
            {showMissing ? 'Hide' : 'Show'} fields that need you
          </button>
          {showMissing && (
            <ul className="mt-1.5 space-y-1">
              {app.missingLabels.map((l, i) => (
                <li key={i} className="flex gap-2 text-xs text-slate-700">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-red-600" />
                  {l}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
