import { afterEach, expect, it, vi } from 'vitest';
import { ADAPTERS } from '../lib/autofill/adapters';
import { waitForFieldReadiness } from '../lib/autofill/readiness';
import { FillSession } from '../lib/autofill/engine';
import { timing } from '../lib/autofill/fill';
import { sampleProfile } from './helpers';
import { isGreenhouseConfirmationUrl, readSubmissionEvidence } from '../lib/submission-confirmation';
import { nextQueueItem, queueSchema, type QueueState } from '../lib/application-queue';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });
const setup = (html: string) => {
  (window as any).happyDOM.setURL('https://job-boards.greenhouse.io/example/jobs/123');
  document.body.innerHTML = html;
};
it('waits for delayed controls/options and a stable form before either fill path', async () => {
  vi.useFakeTimers(); setup('<form id="application-form"><label for="name">First name</label><input id="name"></form>');
  const pending = waitForFieldReadiness(document, ADAPTERS.greenhouse, new AbortController().signal, { minimumMs: 200, quietMs: 100, pollMs: 25, maximumMs: 1000 });
  let finished = false; void pending.then(() => { finished = true; });
  await vi.advanceTimersByTimeAsync(175);
  document.querySelector('form')!.insertAdjacentHTML('beforeend', '<label for="shift">Fictional shift</label><select id="shift"><option>Select</option></select>');
  await vi.advanceTimersByTimeAsync(50); expect(finished).toBe(false);
  document.querySelector('select')!.insertAdjacentHTML('beforeend', '<option>Day</option>');
  await vi.advanceTimersByTimeAsync(75); expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(150); await pending;
});
it('bounds readiness even when a widget remains busy, and cancels old attempts', async () => {
  vi.useFakeTimers(); setup('<form aria-busy="true"><input></form>');
  const controller = new AbortController();
  const pending = waitForFieldReadiness(document, ADAPTERS.greenhouse, controller.signal, { maximumMs: 150, pollMs: 25 });
  await vi.advanceTimersByTimeAsync(200); await pending;
  const cancelled = waitForFieldReadiness(document, ADAPTERS.greenhouse, controller.signal, { maximumMs: 150, pollMs: 25 });
  const checked = expect(cancelled).rejects.toThrow('cancelled'); controller.abort(); await vi.advanceTimersByTimeAsync(25); await checked;
});
it('keeps capture tokens and answered state when a reviewed form rerenders, with no automatic writes', async () => {
  setup('<form id="application-form"><label for="custom">Fictional launch reference</label><input id="custom" required></form>');
  const session = new FillSession(document, ADAPTERS.greenhouse, { context: { profile: sampleProfile(), resume: null, coverLetter: null, transcript: null, hasGeminiKey: false }, answer: async () => ({ ok: false, error: 'unused' }), jobDescription: async () => '' });
  const oldSettle = timing.settle; timing.settle = 1;
  try {
    const summary = await session.run(), token = summary.reviewFields![0]!.token;
    session.observe(false);
    const previous = document.querySelector('form')!; previous.replaceWith(previous.cloneNode(true));
    (document.querySelector('input') as HTMLInputElement).value = 'My manual reference';
    await new Promise(r => setTimeout(r, 800));
    expect(session.captureAnswer(token, 'Fictional launch reference').value).toBe('My manual reference');
    expect(session.summary().reviewFields![0]).toMatchObject({ token, answered: true });
  } finally { session.disconnect(); timing.settle = oldSettle; }
});
it('accepts only visible success evidence, never empty forms, descriptions or validation failures', () => {
  setup('<h1>Fictional job</h1><p>Thank you for applying.</p><form><input></form>'); expect(readSubmissionEvidence(document)).toBeNull();
  setup('<h1>Application submitted successfully.</h1><form><input></form>'); expect(readSubmissionEvidence(document)).toBeNull();
  setup('<h1 hidden>Application submitted successfully.</h1>'); expect(readSubmissionEvidence(document)).toBeNull();
  setup('<div class="job__description"><h2>Thank you for applying.</h2></div>'); expect(readSubmissionEvidence(document)).toBeNull();
  setup('<h1>Application submitted successfully.</h1><form><div role="combobox">Select</div></form>'); expect(readSubmissionEvidence(document)).toBeNull();
  setup('<h1>Application submitted successfully.</h1><p role="alert">Try again</p>'); expect(readSubmissionEvidence(document)).toBeNull();
  setup('<h1>Application submitted successfully.</h1>'); expect(readSubmissionEvidence(document)).toBe('greenhouse-confirmation');
  setup('<p role="status">Your application has been received.</p>'); expect(readSubmissionEvidence(document)).toBe('greenhouse-confirmation');
  (window as any).happyDOM.setURL('https://example.com/success'); expect(readSubmissionEvidence(document)).toBeNull();
});
it('recovers a Memory after dropdown options load during filling without replacing a manual value', async () => {
  setup('<form id="application-form"><label for="name">First name</label><input id="name"><label for="shift">Fictional shift</label><select id="shift" required><option value="">Select...</option></select></form>');
  const original = timing.settle; timing.settle = 1;
  let loaded = false;
  const session = new FillSession(document, ADAPTERS.greenhouse, {
    context: { profile: sampleProfile(), resume: null, coverLetter: null, transcript: null, hasGeminiKey: false }, answer: async () => ({ ok: false, error: 'unused' }), jobDescription: async () => '',
    matchSavedAnswers: async fields => fields.map(field => field.label === 'Fictional shift' ? { reason: 'Approved question', mapping: { id: 1, schemaVersion: 3, updatedAt: 1, question: 'Fictional shift', aliases: [], scope: 'all', target: { kind: 'answer', value: 'Day' } } } : { reason: 'No Memory', mapping: null }),
    onPhase: phase => {
      if (phase === 'Checking filled fields' && !loaded) {
        loaded = true; document.querySelector('select')!.insertAdjacentHTML('beforeend', '<option>Day</option>');
        (document.querySelector('input') as HTMLInputElement).value = 'My manual correction';
      }
    },
  });
  try {
    await session.run(); expect((document.querySelector('select') as HTMLSelectElement).value).toBe('Day');
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('My manual correction');
  } finally { session.disconnect(); timing.settle = original; }
});
it('requires the exact supported job/confirmation origin and identity', () => {
  const job = 'https://job-boards.greenhouse.io/example/jobs/123';
  expect(isGreenhouseConfirmationUrl(job, job)).toBe(true);
  expect(isGreenhouseConfirmationUrl(job, job + '/confirmation')).toBe(true);
  for (const target of [job.replace('123', '124'), job.replace('example/jobs', 'another/jobs'), 'https://evil.example/success', job + '/apply', 'https://job-boards.greenhouse.io/example/thanks']) expect(isGreenhouseConfirmationUrl(job, target)).toBe(false);
});
it('refills one continuous slot while other reviews remain open, including a settled tab awaiting closure', () => {
  const q: QueueState = { id: 'current', schemaVersion: 1, token: crypto.randomUUID(), status: 'running', mode: 'continuous', batchSize: 2, batch: 0, createdAt: 1, items: Array.from({ length: 4 }, (_, i) => ({ id: crypto.randomUUID(), url: 'https://example.com/job/' + i, key: 'https://example.com/job/' + i, state: 'queued', batch: 0 })) };
  const first = nextQueueItem(q)!; first.state = 'opening'; const second = nextQueueItem(q)!; second.state = 'opening';
  expect(nextQueueItem(q)).toBeUndefined();
  first.state = 'submitted'; first.tabId = 1; expect(nextQueueItem(q)).toBeUndefined();
  first.tabId = undefined; second.state = 'needs-action'; second.tabId = 2;
  const next = nextQueueItem(q)!; expect(next).toBe(q.items[2]); next.state = 'opening';
  next.attempt = crypto.randomUUID(); next.deadline = Date.now() + 1000;
  expect(nextQueueItem(q)).toBeUndefined(); expect(queueSchema.parse(q)).toBe(q);
  q.status = 'paused'; next.state = 'skipped'; expect(nextQueueItem(q)).toBeUndefined();
  q.status = 'running'; q.batchSize = 1; expect(nextQueueItem(q)).toBeUndefined();
  second.state = 'skipped'; second.tabId = undefined; const last = nextQueueItem(q)!; last.state = 'skipped'; expect(nextQueueItem(q)).toBeUndefined(); expect(q.status).toBe('complete');
});
