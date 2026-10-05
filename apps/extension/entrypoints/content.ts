import { browser } from 'wxt/browser';
import { ADAPTERS } from '@/lib/autofill/adapters';
import { FillSession, waitForForm, type FillSummary } from '@/lib/autofill/engine';
import { showStatus } from '@/lib/autofill/highlight';
import { sendToBackground, type ContentMessage } from '@/lib/messages';
import { ATS_MATCHES, platformFor } from '@/lib/platforms';

/** How long a multi-step application (Workday) is watched for its form while the person signs in or clicks Apply. */
const MULTI_STEP_WAIT = 30 * 60_000;

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
    let session: FillSession | null = null;
    let running = false;

    async function fill(applicationId?: number) {
      if (running) return;
      running = true;
      try {
        showStatus({ title: 'Filling application…', lines: ['Looking for the form.'], tone: 'working' });
        if (!(await waitForForm(document, adapter, 3000)) && !(await waitLonger())) return;
        const context = await sendToBackground('getFillContext', {});
        session?.disconnect();
        const s = new FillSession(document, adapter, {
          context,
          answer: (req) => sendToBackground('generateAnswer', req),
          jobDescription: async (info) =>
            info.remote ? sendToBackground('jobDescription', info.remote) : ((await adapter.fetchDescription?.(document)) ?? ''),
          mapFields: (fields) => sendToBackground('mapFields', { fields }),
          onProgress: (summary) => report(summary),
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
            })
          ).applicationId;

        console.debug(`[Job Autofill] build ${__BUILD__}: filling started`);
        showStatus({ title: 'Filling application…', lines: ['Filling fields from your profile.', `Build ${__BUILD__.slice(5, 16).replace('T', ' ')}`], tone: 'working' });
        const summary = await s.run();
        currentId = id;
        await report(summary);
        s.observe();
      } catch (err) {
        console.error('[Job Autofill]', err);
        showStatus({ title: 'Autofill stopped', lines: [String((err as Error)?.message ?? err)], tone: 'done' });
      } finally {
        running = false;
      }
    }

    /** Keeps waiting for a form that is slow to render, or (multi-step) for the person to sign in or click Apply. */
    async function waitLonger(): Promise<boolean> {
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
      const lines = [`${summary.filledCount} fields filled from your profile.`];
      if (summary.aiAnswers) lines.push(`${summary.aiAnswers} AI answer${summary.aiAnswers > 1 ? 's' : ''} to review (outlined in blue).`);
      if (summary.missingLabels.length) {
        lines.push(`${summary.missingLabels.length} field${summary.missingLabels.length > 1 ? 's' : ''} need you (outlined in red).`);
      }
      if (summary.aiNote) lines.push(summary.aiNote);
      lines.push(
        adapter.multiStep
          ? 'Review this page, then continue. Each next page is filled when it opens; submit it yourself.'
          : 'Review everything, then submit it yourself.',
      );
      showStatus({ title: 'Ready for review', lines, tone: 'done' });
      await sendToBackground('fillFinished', {
        applicationId: currentId,
        company: session.info.company,
        role: session.info.role,
        filledCount: summary.filledCount,
        aiAnswers: summary.aiAnswers,
        missingLabels: summary.missingLabels,
      });
    }

    browser.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
      if (msg.type === 'ping') sendResponse({ ok: true, platform });
      if (msg.type === 'fill') {
        void fill(msg.applicationId);
        sendResponse({ ok: true });
      }
      return false;
    });

    // Tabs opened from a pasted link start filling on their own, in whichever frame holds the form.
    void (async () => {
      const pending = await sendToBackground('claimPendingFill', { commit: false });
      if (!pending.fill || !(await waitForForm(document, adapter, formWait))) return;
      const claimed = await sendToBackground('claimPendingFill', { commit: true });
      if (claimed.fill) await fill();
    })();
  },
});
