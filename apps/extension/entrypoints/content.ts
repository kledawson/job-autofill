import { boundedTask } from '@/lib/bounded-task';
import { waitForFieldReadiness } from '@/lib/autofill/readiness';
import { browser } from 'wxt/browser';
import { ADAPTERS } from '@/lib/autofill/adapters';
import { FillSession, waitForForm, type FillSummary } from '@/lib/autofill/engine';
import { sendToBackground, type ContentMessage, type PageStatus } from '@/lib/messages';
import { ATS_MATCHES, platformFor } from '@/lib/platforms';
import { readJobDetails } from '@/lib/job-details';
import { fetchPostingDescription, findPostingLink } from '@/lib/posting-link';
import { hasSubmissionErrors, readSubmissionEvidence } from '@/lib/submission-confirmation';
import { isSubmitControl } from '@/lib/autofill/fill';
import { pageReadiness, readinessDelay } from '@/lib/autofill/page-readiness';
import type { QueueWaitReason } from '@/lib/application-queue';

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
    let waiting: { runId: string; controller: AbortController; task: Promise<void> } | undefined;
    window.addEventListener('pagehide', () => { waiting?.controller.abort(); aborter?.abort(); session?.disconnect(); });

    const authTitle = { login: 'Sign in required', account: 'Create your account', verification: 'Verification required', navigation: 'Return to the application' };
    function waitingStatus(reason: QueueWaitReason, queued: boolean) {
      if (!isTop) return;
      showStatus({ title: authTitle[reason], lines: [queued ? 'Complete this step on the website. Autofill resumes on the original application; other queue jobs continue.' : 'Complete this step on the website, then click Fill this page.', 'Passwords and verification codes are left to you.'], tone: 'attention' });
    }

    /** A single metadata-only watcher per attempt. Only the worker can grant the writer. */
    function requestQueueFill(runId: string, applicationId?: number) {
      if (waiting?.runId === runId || filling) return;
      waiting?.controller.abort();
      const controller = new AbortController();
      queueRun = runId;
      const work = (async () => {
        let end = Date.now() + 30000, lastReason: QueueWaitReason | undefined;
        while (!controller.signal.aborted && Date.now() < end) {
          const pending = await boundedTask(sendToBackground('claimPendingFill', { commit: false }), controller.signal, 10000);
          if (!pending.fill || pending.runId !== runId) return;
          if (pending.resumeUntil) end = pending.resumeUntil;
          const ready = pageReadiness(document, adapter);
          if (ready === 'form') {
            const claim = await boundedTask(sendToBackground('claimPendingFill', { commit: true }), controller.signal, 10000);
            if (controller.signal.aborted) return;
            if (claim.fill && claim.runId === runId) { await startTask(applicationId, runId); return; }
            // A same-tab sign-in redirect may render an unrelated form. Keep waiting for
            // the original job, without retrieving its context or writing any fields.
            const live = await sendToBackground('claimPendingFill', { commit: false });
            if (!live.fill || live.runId !== runId || controller.signal.aborted) return;
            if (isTop && lastReason !== 'navigation') {
              if (!lastReason) end = pending.resumeUntil ?? Date.now() + MULTI_STEP_WAIT;
              lastReason = 'navigation';
              await sendToBackground('queueWaiting', { runId, reason: lastReason }); waitingStatus(lastReason, true);
            }
          } else if (ready !== 'loading' && isTop && ready !== lastReason) {
            if (!lastReason) end = pending.resumeUntil ?? Date.now() + MULTI_STEP_WAIT;
            lastReason = ready;
            await sendToBackground('queueWaiting', { runId, reason: ready }); waitingStatus(ready, true);
          }
          await readinessDelay(controller.signal);
        }
        if (!controller.signal.aborted && isTop) await sendToBackground('queueFinished', { runId, note: 'No application form found. Finish signing in, return to the job, then retry autofill.' });
      })().catch(() => undefined).finally(() => { if (waiting?.controller === controller) waiting = undefined; });
      waiting = { runId, controller, task: work };
    }
    // Only trusted user events arm detection. No listener clicks or submits a form.
    let intent: Promise<unknown> = Promise.resolve(), checkingSubmission = false, submittedHere = false;
    async function checkSubmission() {
      if (checkingSubmission || (!readSubmissionEvidence(document) && !(submittedHere && hasSubmissionErrors(document)))) return;
      checkingSubmission = true;
      try {
        await intent;
        if (submittedHere && currentRunId && hasSubmissionErrors(document)) {
          submittedHere = false;
          await sendToBackground('submissionBlocked', { runId: currentRunId });
          showStatus({ title: 'Submission needs attention', lines: ['The website reports missing or invalid answers. Check its messages, correct the fields and submit again. This application stays open.'], tone: 'attention' });
          return;
        }
        const context = await sendToBackground('submissionContext', {});
        if (context.ok && context.runId) await sendToBackground('submissionConfirmed', { runId: context.runId });
      } catch { /* An unsupported/unowned confirmation stays open for manual confirmation. */ }
      finally { checkingSubmission = false; }
    }
    if (['greenhouse', 'lever', 'ashby'].includes(platform)) {
      const submitted = (event: Event) => {
        if (!event.isTrusted || !currentRunId || filling || !session || currentId === undefined) return;
        const root = adapter.formRoot(document);
        const control = event.target instanceof Element ? event.target.closest('button, input[type="submit"], [role="button"]') : null;
        if (event.type === 'click' && (!control || !root.contains(control) || !isSubmitControl(control) || !/submit|send application/i.test(control.textContent || control.getAttribute('value') || ''))) return;
        if (event.type === 'submit' && (!(event.target instanceof HTMLFormElement) || !root.contains(event.target))) return;
        submittedHere = true;
        intent = sendToBackground('submissionIntent', { runId: currentRunId }).then(() => { setTimeout(() => void checkSubmission(), 250); }).catch(() => undefined);
      };
      document.addEventListener('click', submitted, true);
      document.addEventListener('submit', submitted, true);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => void checkSubmission(), 250); });
      observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(timer); document.removeEventListener('click', submitted, true); document.removeEventListener('submit', submitted, true); });
      void checkSubmission();
    }
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
      aborter?.abort();
      const controller = new AbortController(); aborter = controller;
      const remote = <T,>(promise: Promise<T>, ms?: number) => boundedTask(promise, controller.signal, ms);
      queueRun = runId;
      showStatus({ title: 'Filling application…', lines: ['Looking for the form.'], tone: 'working' });
      if (runId) {
        if (!await remote(waitForForm(document, adapter, 30000), 35000)) {
          if (run === generation) await sendToBackground('queueFinished', { runId, note: 'No application form found. Open this tab, sign in or click Apply, then retry.' });
          return;
        }
      } else if (!(await waitLonger(run, controller.signal))) return;
      if (run !== generation || filling) return;
      filling = true;
      try {
        showStatus({ title: 'Preparing application', lines: ['Waiting for fields and dropdowns to finish loading.'], tone: 'working' });
        await remote(waitForFieldReadiness(document, adapter, controller.signal), 10000);
        if (pageReadiness(document, adapter) !== 'form') throw new Error('The page changed. Finish signing in or return to the application, then click Fill this page.');
        const context = await remote(sendToBackground('getFillContext', { runId }));
        if (run !== generation) return;
        if (!context?.profile) throw new Error((context as unknown as { error?: string })?.error ?? 'Reload the extension and application page.');
        currentRunId = context.runId;
        currentPresetId = context.preset?.id;
        currentPresetRevision = context.preset?.revision;
        currentId = undefined;
        session?.disconnect();
        const s: FillSession = new FillSession(document, adapter, {
          context,
          answer: async (req) => {
            try { return await remote(sendToBackground('generateAnswer', { ...req, runId: context.runId })); }
            catch (err) { return { ok: false, error: err instanceof Error ? err.message : 'AI response unavailable.' }; }
          },
          onPhase: phase => { if (run === generation) showStatus({ title: 'Filling application…', lines: [phase], tone: 'working' }); },
          jobDescription: async (info) => {
            const found = info.remote ? await remote(sendToBackground('jobDescription', info.remote), 10000) : (await remote(adapter.fetchDescription?.(document) ?? Promise.resolve(''), 10000)) ?? '';
            if (found) return found;
            // The form page shows no description: read it from the posting the form links back to on this site.
            return remote(fetchPostingDescription(findPostingLink(document, location.href), location.href, controller.signal), 10000).catch(() => '');
          },
          jobDetails: (target) => remote(sendToBackground('jobDetails', target), 10000),
          mapFields: (fields) => remote(sendToBackground('mapFields', { fields })),
          matchSavedAnswers: async (fields) => {
            const res = await remote(sendToBackground('matchSavedAnswers', { fields, runId: context.runId }), 10000);
            if (!res.ok) throw new Error(res.error);
            return res.matches;
          },
          onProgress: (summary) => { if (session === s && !filling && !s.processing) void report(summary); },
        });
        session = s;
        let id = applicationId;
        if (id === undefined) {
          const started = await sendToBackground('fillStarted', {
            url: location.href,
            company: s.info.company,
            role: s.info.role,
            platform,
            runId: context.runId,
          }) as { applicationId?: number; error?: string };
          // Without an application record the result has nowhere to go; say so instead of staying on Filling.
          if (started.applicationId === undefined) throw new Error(started.error || 'Could not record this application. Refresh the page and try again.');
          id = started.applicationId;
        }
        currentId = id;
        void s.jobDetails().then(() => {
          if (session === s && currentId === id && !filling) void report(s.summary());
        }).catch(() => undefined);

        console.debug(`[Job Autofill] build ${__BUILD__}: filling started`);
        showStatus({ title: 'Filling application…', lines: ['Filling fields from your profile.', `Build ${__BUILD__.slice(5, 16).replace('T', ' ')}`], tone: 'working' });
        if (run !== generation || controller.signal.aborted) return;
        const summary = await s.run();
        console.debug(`[Job Autofill] fill pass finished${run !== generation ? ' (superseded by a newer fill or cancel)' : ''}`);
        if (run !== generation) return;
        currentId = id;
        // The writer has finished. Review/capture must not wait on optional job metadata.
        filling = false;
        s.observe(!context.queue);
        if (context.queue && context.runId) {
          const empty = !summary.filledCount && !summary.aiAnswers && !summary.missingLabels.length;
          await sendToBackground('queueFinished', { runId: context.runId, applicationId: id, ...(empty ? { note: 'This page has no fillable application fields. Sign in or continue to the form, then retry.' } : {}) });
        }
        if (run === generation) await report(summary);
      } catch (err) {
        if (run !== generation) { console.debug('[Job Autofill] superseded fill stopped:', String((err as Error)?.message ?? err)); return; }
        if (runId && run === generation) await sendToBackground('queueFinished', { runId, note: String((err as Error)?.message ?? 'Autofill stopped.').slice(0, 500) }).catch(() => undefined);
        console.error('[Job Autofill]', err);
        showStatus({ title: 'Autofill stopped', lines: [String((err as Error)?.message ?? err)], tone: 'done' });
      } finally {
        if (run === generation) filling = false;
      }
    }

    /** Keeps waiting for a form that is slow to render, or (multi-step) for the person to sign in or click Apply. */
    async function waitLonger(run: number, signal: AbortSignal): Promise<boolean> {
      // Frames without a form (ads, embeds) stay quiet, and so does the top page when a frame has the form.
      const frameFilling = async () => isTop && (await sendToBackground('frameFilling', {})).active;
      if (!isTop || (await frameFilling())) showStatus(null);
      let end = Date.now() + (adapter.multiStep && isTop ? MULTI_STEP_WAIT : 15000);
      let authSeen: QueueWaitReason | undefined;
      while (Date.now() < end) {
        if (signal.aborted) return false;
        const ready = pageReadiness(document, adapter);
        if (ready === 'form') {
          if (authSeen) { if (isTop) showStatus({ title: 'Application ready', lines: ['Click Fill this page to fill the application.'], tone: 'done' }); return false; }
          return true;
        }
        if (ready !== 'loading' && ready !== authSeen) {
          if (!authSeen) end = Date.now() + MULTI_STEP_WAIT;
          authSeen = ready; waitingStatus(ready, false);
        }
        if (run !== generation) return false;
        if (await frameFilling()) {
          showStatus(null);
          return false;
        }
        try { await readinessDelay(signal); } catch { return false; }
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
      console.debug('[Job Autofill] reporting result');
      const details = owner.knownDetails;
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
        fieldFeedback: summary.fieldFeedback,
        memoryQuestions: summary.memoryQuestions,
        usedMappingIds: summary.usedMappingIds,
        location: details?.location,
        workMode: details?.workMode,
        basePay: details?.pay,
      });
    }

    browser.runtime.onMessage.addListener((msg: ContentMessage, sender, sendResponse) => {
      if (sender.id !== browser.runtime.id) return false;
      if (msg.type === 'checkSubmission') { sendResponse({ evidence: readSubmissionEvidence(document), url: location.href }); return false; }
      if (msg.type === 'showField') {
        try {
          if (!session || msg.runId !== currentRunId) throw new Error('Refresh the application results before locating this field.');
          session.showField(msg.token, msg.question); sendResponse({ ok: true });
        } catch (err) { sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Could not locate this field.' }); }
        return false;
      }
      if (msg.type === 'draftRequest' || msg.type === 'applyDraft') {
        void (async () => {
          try {
            if (!session || filling || msg.runId !== currentRunId) throw new Error('Wait for this fill to finish or refresh the application results.');
            if (msg.type === 'draftRequest') sendResponse({ ok: true, request: await session.draftRequest(msg.token, msg.question) });
            else sendResponse({ ok: true, note: session.applyDraft(msg.token, msg.question, msg.text) });
          } catch (err) { sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Could not use this field.' }); }
        })();
        return true;
      }
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
          if (msg.runId && (msg.runId === queueRun || msg.runId === currentRunId)) {
            if (waiting && waiting.runId === msg.runId && !waiting.controller.signal.aborted) showStatus({ title: 'Automatic resume stopped', lines: ['Your page was kept. Finish this step, then use Fill this page or retry the queue job.'], tone: 'attention' });
            const writer = session;
            generation++; writer?.disconnect(); aborter?.abort(); waiting?.controller.abort();
            // Wait for the old widget writer to stop before a retry can touch this form.
            if (msg.wait) { await task; await writer?.whenIdle(); }
            filling = false;
          }
          sendResponse({ ok: true });
        })();
        return true;
      }
      if (msg.type === 'reviewNow' || msg.type === 'stopFill') {
        void (async () => {
          try {
            if (msg.type === 'reviewNow' && (msg.runId !== queueRun || !session || currentId === undefined)) throw new Error('The form is still opening. Wait until fields appear.');
            const owner = session;
            generation++; owner?.disconnect(); aborter?.abort(); waiting?.controller.abort();
            owner?.summary(); // Keep unfinished questions teachable if the user starts typing now.
            await task;
            await owner?.whenIdle();
            if (session !== owner || (msg.type === 'reviewNow' && queueRun !== msg.runId)) throw new Error('This fill attempt changed. Review the current attempt instead.');
            filling = false;
            if (owner && currentId !== undefined) await report(owner.enterReview());
            showStatus({ title: 'Autofill stopped', lines: ['Your answers were kept. Finish missing answers and save Memories, or click Fill this page to continue.'], tone: 'done' });
            sendResponse({ ok: true });
          } catch (err) { sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Could not switch to review.' }); }
        })();
        return true;
      }
      if (msg.type === 'ping') sendResponse({ ok: true, platform, build: __BUILD__, filling: filling || session?.processing, presetId: currentPresetId, presetRevision: currentPresetRevision });
      if (msg.type === 'fill') {
        if (msg.runId) requestQueueFill(msg.runId, msg.applicationId);
        else void startTask(msg.applicationId);
        sendResponse({ ok: true });
      }
      return false;
    });

    // Tabs opened from a pasted link start filling on their own, in whichever frame holds the form.
    void (async () => {
      const pending = await sendToBackground('claimPendingFill', { commit: false });
      if (!pending.fill) return;
      if (pending.queued && pending.runId) { requestQueueFill(pending.runId); return; }
      const claimed = await sendToBackground('claimPendingFill', { commit: true });
      if (claimed.fill) await startTask(undefined, claimed.runId);
    })();
  },
});
