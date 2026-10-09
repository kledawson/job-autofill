import { boundedTask } from '@/lib/bounded-task';
import { browser } from 'wxt/browser';
import { ADAPTERS } from '@/lib/autofill/adapters';
import { FillSession, waitForForm, type FillSummary } from '@/lib/autofill/engine';
import { sendToBackground, type ContentMessage, type PageStatus } from '@/lib/messages';
import { ATS_MATCHES, platformFor } from '@/lib/platforms';
import { readJobDetails } from '@/lib/job-details';

/** How long a multi-step application (Workday) is watched for its form while the person signs in or clicks Apply. */
const MULTI_STEP_WAIT = 30 * 60_000;

/** Shows what is happening on this tab in the side panel; nothing is drawn over the page. */
function showStatus(status: PageStatus | null) {
  // A frame without a form has nothing to say, and clearing would erase the frame that has one.
  if (status) void sendToBackground('setPageStatus', { status, origin: location.origin }).catch(() => undefined);
}

export default defineContentScript({
  matches: ATS_MATCHES,
  allFrames: true,
  runAt: 'document_idle',
  main() {
    // Loaded automatically on the known job sites and on request everywhere else; a second load is a no-op.
    const w = window as Window & { __jobAutofillLoaded?: boolean };
    if (w.__jobAutofillLoaded) return;
    w.__jobAutofillLoaded = true;
    const platform = platformFor(location.href);
    const adapter = ADAPTERS[platform];
    const isTop = window === window.top;
    // Workday and unknown sites can show the form only after Apply or sign-in; the top page keeps waiting.
    const formWait = adapter.multiStep && isTop ? MULTI_STEP_WAIT : 15000;
    // Workday: start watching right away and fill whatever page is showing, then each page after it.
    const watchNow = !!adapter.watchWholeFlow && isTop;
    let session: FillSession | null = null;
    let currentRunId: string | undefined;
    let currentPresetId: string | undefined;
    let currentPresetRevision: number | undefined;
    /** True while fields are being filled; a Fill click then is ignored. */
    let filling = false;
    /** Bumped by each Fill click, so a click replaces an earlier one that is still waiting for a form. */
    let generation = 0;

    let queueRun: string | undefined;
    let aborter: AbortController | undefined;
    let task: Promise<void> | undefined;
    async function startTask(applicationId?: number, runId?: string) {
      if (filling) return;
      const next = fill(applicationId, runId).catch(() => undefined);
      task = next;
      await next;
      if (task === next) task = undefined;
    }
    async function fill(applicationId?: number, runId?: string) {
      if (filling) return;
      const run = ++generation;
      const controller = new AbortController(); aborter = controller;
      const remote = <T,>(promise: Promise<T>, ms?: number) => boundedTask(promise, controller.signal, ms);
      queueRun = runId;
      showStatus({ title: 'Filling application…', lines: ['Looking for the form.'], tone: 'working' });
      if (runId) {
        if (!await remote(waitForForm(document, adapter, 30000), 35000)) {
          if (run === generation) await sendToBackground('queueFinished', { runId, note: 'No application form found. Open this tab, sign in or click Apply, then retry.' });
          return;
        }
      } else if (!watchNow && !(await waitForForm(document, adapter, 3000)) && !(await waitLonger(run))) return;
      if (run !== generation || filling) return;
      filling = true;
      try {
        const context = await remote(sendToBackground('getFillContext', { runId }));
        if (run !== generation) return;
        if (!context?.profile) throw new Error((context as unknown as { error?: string })?.error ?? 'Reload the extension and application page.');
        currentRunId = context.runId;
        currentPresetId = context.preset?.id;
        currentPresetRevision = context.preset?.revision;
        currentId = undefined;
        session?.disconnect();
        const s = new FillSession(document, adapter, {
          context,
          answer: async (req) => {
            try { return await remote(sendToBackground('generateAnswer', { ...req, runId: context.runId })); }
            catch (err) { return { ok: false, error: err instanceof Error ? err.message : 'AI response unavailable.' }; }
          },
          onPhase: phase => { if (run === generation) showStatus({ title: 'Filling application…', lines: [phase], tone: 'working' }); },
          jobDescription: async (info) =>
            info.remote ? remote(sendToBackground('jobDescription', info.remote), 10000) : (await remote(adapter.fetchDescription?.(document) ?? Promise.resolve(''), 10000)) ?? '',
          jobDetails: (target) => remote(sendToBackground('jobDetails', target), 10000),
          mapFields: (fields) => remote(sendToBackground('mapFields', { fields })),
          matchSavedAnswers: async (fields) => {
            const res = await remote(sendToBackground('matchSavedAnswers', { fields, runId: context.runId }), 10000);
            if (!res.ok) throw new Error(res.error);
            return res.matches;
          },
          onProgress: (summary) => { if (run === generation) void report(summary); },
        });
        session = s;
        const id =
          applicationId ??
          (
            await sendToBackground('fillStarted', {
              url: location.href,
              company: s.info.company,
              role: s.info.role,
              platform,
              runId: context.runId,
            })
          ).applicationId;

        console.debug(`[Job Autofill] build ${__BUILD__}: filling started`);
        showStatus({ title: 'Filling application…', lines: ['Filling fields from your profile.', `Build ${__BUILD__.slice(5, 16).replace('T', ' ')}`], tone: 'working' });
        const summary = await s.run();
        if (run !== generation) return;
        currentId = id;
        await report(summary);
        if (context.queue && context.runId) {
          const empty = !summary.filledCount && !summary.aiAnswers && !summary.missingLabels.length;
          await sendToBackground('queueFinished', { runId: context.runId, applicationId: id, ...(empty ? { note: 'This page has no fillable application fields. Sign in or continue to the form, then retry.' } : {}) });
        }
        // Tabs fill independently; later steps still require an explicit action.
        if (run === generation) s.observe(!context.queue);
      } catch (err) {
        if (run !== generation) return;
        if (runId && run === generation) await sendToBackground('queueFinished', { runId, note: String((err as Error)?.message ?? 'Autofill stopped.').slice(0, 500) }).catch(() => undefined);
        console.error('[Job Autofill]', err);
        showStatus({ title: 'Autofill stopped', lines: [String((err as Error)?.message ?? err)], tone: 'done' });
      } finally {
        filling = false;
      }
    }

    /** Keeps waiting for a form that is slow to render, or (multi-step) for the person to sign in or click Apply. */
    async function waitLonger(run: number): Promise<boolean> {
      // Frames without a form (ads, embeds) stay quiet, and so does the top page when a frame has the form.
      const frameFilling = async () => isTop && (await sendToBackground('frameFilling', {})).active;
      if (!isTop || (await frameFilling())) showStatus(null);
      else if (adapter.multiStep) {
        showStatus({
          title: 'Waiting for the application form',
          lines: ['Click Apply or sign in. Filling starts when the form appears.'],
          tone: 'working',
        });
      }
      const end = Date.now() + (adapter.multiStep && isTop ? MULTI_STEP_WAIT : 12000);
      while (Date.now() < end) {
        if (await waitForForm(document, adapter, 5000)) return true;
        if (run !== generation) return false;
        if (await frameFilling()) {
          showStatus(null);
          return false;
        }
      }
      if (isTop) showStatus({ title: 'No application form found', lines: ['Open the application page and try Fill again.'], tone: 'done' });
      return false;
    }

    let currentId: number | undefined;
    async function report(summary: FillSummary) {
      if (currentId === undefined || !session) return;
      const owner = session, ownerId = currentId, ownerRun = currentRunId, ownerGeneration = generation;
      // A Workday page with nothing to fill yet (sign-in, a page between steps): keep watching.
      if (!queueRun && watchNow && !summary.filledCount && !summary.aiAnswers && !summary.missingLabels.length) {
        showStatus({
          title: 'Watching this application',
          lines: ['Sign in or continue to the next page. Each page is filled when it opens.'],
          tone: 'working',
        });
        return;
      }
      // Counts show in the side panel's tiles; fields on the page are outlined in the matching colors.
      const lines: string[] = [];
      if (summary.aiNote) lines.push(summary.aiNote);
      if (queueRun) lines.push('Review and submit yourself. For later steps, use Fill this step in the queue.');
      else if (adapter.multiStep) lines.push('Review this page, then continue. Each next page is filled when it opens.');
      showStatus({ title: 'Ready for review', lines, tone: 'done' });
      const details = await owner.jobDetails().catch(() => null);
      if (owner !== session || ownerRun !== currentRunId || ownerGeneration !== generation) return;
      await sendToBackground('fillFinished', {
        applicationId: ownerId,
        runId: ownerRun,
        company: session.info.company,
        role: session.info.role,
        filledCount: summary.filledCount,
        aiAnswers: summary.aiAnswers,
        missingLabels: summary.missingLabels,
        missingQuestions: summary.missingQuestions,
        reviewFields: summary.reviewFields,
        memoryQuestions: summary.memoryQuestions,
        usedMappingIds: summary.usedMappingIds,
        location: details?.location,
        workMode: details?.workMode,
        basePay: details?.pay,
      });
    }

    browser.runtime.onMessage.addListener((msg: ContentMessage, sender, sendResponse) => {
      if (sender.id !== browser.runtime.id) return false;
      if (msg.type === 'captureAnswer' || msg.type === 'applyAnswer' || msg.type === 'captureAnswers' || msg.type === 'validateCaptures' || msg.type === 'finishRemembering') {
        void (async () => {
          try {
            if (!session || filling) throw new Error('Click Fill this page and wait for it to finish first.');
            if (msg.type === 'captureAnswer') sendResponse({ ok: true, capture: session.captureAnswer(msg.token, msg.question) });
            else if (msg.type === 'captureAnswers') sendResponse({ ok: true, ...session.captureAnswers(msg.fields) });
            else if (msg.type === 'validateCaptures') { sendResponse({ ok: true, captures: session.validateCaptures(msg.entries) }); }
            else if (msg.type === 'finishRemembering') { session.finishRemembering(msg.entries); sendResponse({ ok: true }); }
            else sendResponse({ ok: true, note: await session.applyAnswer(msg.token, msg.captureId, msg.mapping) });
          } catch (err) { sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Could not read this field.' }); }
        })();
        return true;
      }
      if (msg.type === 'readPosting') {
        // Reads the posting's details without touching the form, for tracking an application that has nothing to fill.
        void (async () => {
          try {
            const info = adapter.jobInfo(document);
            const description = info.description || ((await adapter.fetchDescription?.(document).catch(() => '')) ?? '');
            let details = readJobDetails(document, description, info.role, info.location);
            if (info.remote && !(details.location && details.workMode && details.pay)) {
              const remote = await sendToBackground('jobDetails', info.remote).catch(() => null);
              details = { location: details.location || remote?.location || '', workMode: details.workMode || remote?.workMode || '', pay: details.pay || remote?.pay || '' };
            }
            sendResponse({ ok: true, company: info.company, role: info.role, ...details });
          } catch {
            sendResponse({ ok: false });
          }
        })();
        return true;
      }
      if (msg.type === 'cancelQueue') {
        void (async () => {
          if (msg.runId === queueRun || msg.runId === currentRunId) {
            generation++; session?.disconnect(); aborter?.abort();
            // Wait for the old widget writer to stop before a retry can touch this form.
            if (msg.wait) await task;
            filling = false;
          }
          sendResponse({ ok: true });
        })();
        return true;
      }
      if (msg.type === 'ping') sendResponse({ ok: true, platform, build: __BUILD__, filling: filling || session?.processing, presetId: currentPresetId, presetRevision: currentPresetRevision });
      if (msg.type === 'fill') {
        if (msg.runId) void (async () => {
          if (!await waitForForm(document, adapter, 30000)) {
            if (isTop) await sendToBackground('queueFinished', { runId: msg.runId!, note: 'No application form found. Open this tab, sign in or click Apply, then retry.' });
            return;
          }
          const pending = await sendToBackground('claimPendingFill', { commit: true });
          if (pending.fill && pending.runId === msg.runId) await startTask(msg.applicationId, msg.runId);
        })();
        else void startTask(msg.applicationId);
        sendResponse({ ok: true });
      }
      return false;
    });

    // Tabs opened from a pasted link start filling on their own, in whichever frame holds the form.
    void (async () => {
      const pending = await sendToBackground('claimPendingFill', { commit: false });
      if (!pending.fill) return;
      const found = pending.queued ? await waitForForm(document, adapter, 30000) : watchNow || await waitForForm(document, adapter, formWait);
      if (!found) {
        if (pending.queued && pending.runId && isTop) await sendToBackground('queueFinished', { runId: pending.runId, note: 'No application form found. Open this tab, sign in or click Apply, then retry.' });
        return;
      }
      const claimed = await sendToBackground('claimPendingFill', { commit: true });
      if (claimed.fill) await startTask(undefined, claimed.runId);
    })();
  },
});
