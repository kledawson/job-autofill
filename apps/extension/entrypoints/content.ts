import { browser } from 'wxt/browser';
import { ADAPTERS } from '@/lib/autofill/adapters';
import { FillSession, waitForForm, type FillSummary } from '@/lib/autofill/engine';
import { showStatus } from '@/lib/autofill/highlight';
import { sendToBackground, type ContentMessage } from '@/lib/messages';
import { ATS_MATCHES, detectPlatform } from '@/lib/platforms';

export default defineContentScript({
  matches: ATS_MATCHES,
  allFrames: true,
  runAt: 'document_idle',
  main() {
    const detected = detectPlatform(location.href);
    if (!detected) return;
    const platform = detected;
    const adapter = ADAPTERS[platform];
    let session: FillSession | null = null;
    let running = false;

    async function fill(applicationId?: number) {
      if (running) return;
      running = true;
      try {
        showStatus({ title: 'Filling application…', lines: ['Looking for the form.'], tone: 'working' });
        if (!(await waitForForm(document, adapter))) {
          // Frames without a form (ads, embeds) stay quiet; only the top page reports.
          if (window === window.top) {
            showStatus({ title: 'No application form found', lines: ['Open the application page and try Fill again.'], tone: 'done' });
          } else {
            showStatus(null);
          }
          return;
        }
        const context = await sendToBackground('getFillContext', {});
        session?.disconnect();
        const s = new FillSession(document, adapter, {
          context,
          answer: (req) => sendToBackground('generateAnswer', req),
          jobDescription: async (info) =>
            info.remote ? sendToBackground('jobDescription', info.remote) : '',
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

        showStatus({ title: 'Filling application…', lines: ['Filling fields from your profile.'], tone: 'working' });
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

    let currentId: number | undefined;
    async function report(summary: FillSummary) {
      if (currentId === undefined || !session) return;
      const lines = [`${summary.filledCount} fields filled from your profile.`];
      if (summary.aiAnswers) lines.push(`${summary.aiAnswers} AI-written answer${summary.aiAnswers > 1 ? 's' : ''} to review.`);
      if (summary.missingLabels.length) {
        lines.push(`${summary.missingLabels.length} field${summary.missingLabels.length > 1 ? 's' : ''} need you (outlined in red).`);
      }
      if (summary.aiNote) lines.push(summary.aiNote);
      lines.push('Review everything, then submit it yourself.');
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
      if (!pending.fill || !(await waitForForm(document, adapter))) return;
      const claimed = await sendToBackground('claimPendingFill', { commit: true });
      if (claimed.fill) await fill();
    })();
  },
});
