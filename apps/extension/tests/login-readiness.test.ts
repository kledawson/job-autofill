import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADAPTERS } from '../lib/autofill/adapters';
import { formReady, FillSession } from '../lib/autofill/engine';
import { authenticationStep, scanFields } from '../lib/autofill/scan';
import { pageReadiness, readinessDelay } from '../lib/autofill/page-readiness';
import { sampleProfile } from './helpers';
import { clearQueueWait, nextQueueItem, queueJobMatches, queueKey, queueSchema, type QueueState } from '../lib/application-queue';
import { applicationWorkflow } from '../lib/application-workflow';

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });
const setup = (html: string) => { document.body.innerHTML = html; };
const fields = '<label>First name<input autocomplete="given-name"></label><label>Email<input type="email"></label>';

describe('authentication readiness', () => {
  it('blocks large account forms even with recognizable applicant fields', () => {
    setup('<h1>Create an account</h1><form>' + fields + '<input type="password" autocomplete="new-password">' + '<input aria-label="Other field">'.repeat(5) + '<button>Create account</button></form>');
    expect(pageReadiness(document, ADAPTERS.lever)).toBe('account');
    expect(formReady(document, ADAPTERS.lever)).toBe(false);
  });
  it('recognizes passwordless sign-in with its heading outside the form', () => {
    setup('<h1>Sign in</h1><form>' + fields + '<button>Continue</button></form>');
    expect(pageReadiness(document, ADAPTERS.lever)).toBe('login');
    expect(formReady(document, ADAPTERS.lever)).toBe(false);
  });
  it('recognizes verification and excludes code controls from matching', () => {
    setup('<form><input autocomplete="one-time-code" aria-label="Code">' + fields + '</form>');
    expect(pageReadiness(document, ADAPTERS.lever)).toBe('verification');
    expect(scanFields(document).some(f => f.label === 'Code')).toBe(false);
    setup('<h1>Verify your email</h1><form><input aria-label="Security code"></form>');
    expect(pageReadiness(document, ADAPTERS.lever)).toBe('verification');
  });
  it('ignores hidden login controls and ordinary sign-in links outside the application', () => {
    setup('<header><a href="/login">Sign in</a></header><div hidden><h1>Sign in</h1><input type="password"></div><form id="application-form">' + fields + '</form>');
    expect(pageReadiness(document, ADAPTERS.greenhouse)).toBe('form');
    expect(authenticationStep(document.body)).toBeNull();
  });
  it('performs no writes or AI requests on an account screen and can recognize the later application', async () => {
    setup('<form><h1>Create an account</h1>' + fields + '<input type="password">' + '<input>'.repeat(5) + '</form>');
    const ai = vi.fn(), mappings = vi.fn();
    const session = new FillSession(document, ADAPTERS.lever, { context: { profile: sampleProfile(), resume: null, coverLetter: null, transcript: null, hasGeminiKey: true }, answer: ai, mapFields: mappings, jobDescription: async () => '' });
    await session.run(); session.disconnect();
    expect([...document.querySelectorAll('input')].every(el => el.value === '')).toBe(true);
    expect(ai).not.toHaveBeenCalled(); expect(mappings).not.toHaveBeenCalled();
    setup('<form>' + fields + '</form>'); expect(pageReadiness(document, ADAPTERS.lever)).toBe('form');
  });
  it('cancels a readiness delay without leaving a timer', async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const waiting = readinessDelay(controller.signal, 30000);
    const rejected = expect(waiting).rejects.toThrow('cancelled'); controller.abort(); await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('durable queue login ownership', () => {
  const queue = (): QueueState => ({ id: 'current', schemaVersion: 1, token: crypto.randomUUID(), status: 'running', mode: 'continuous', batch: 1, batchSize: 2, createdAt: 1,
    items: [0, 1, 2].map(n => ({ id: crypto.randomUUID(), url: `https://jobs.lever.co/example/job${n}`, key: `jobs.lever.co/example/job${n}`, state: 'queued', batch: 0 })) });
  it('persists a waiting attempt, keeps its slot, and lets other slots fill', () => {
    const q = queue(), i = nextQueueItem(q)!;
    Object.assign(i, { state: 'needs-action', attempt: crypto.randomUUID(), tabId: 42, waitingFor: 'login', resumeUntil: Date.now() + 1000 });
    expect(queueSchema.parse(q)).toBe(q);
    const other = nextQueueItem(q)!; other.state = 'review'; other.applicationId = 1; other.tabId = 43;
    expect(nextQueueItem(q)).toBeUndefined();
    expect(applicationWorkflow(undefined, i)).toMatchObject({ title: 'Sign in required', canRemember: false, canConfirmSubmission: false, writing: false });
    clearQueueWait(i); i.state = 'skipped'; i.tabId = undefined;
    expect(nextQueueItem(q)).toBe(q.items[2]); expect(queueSchema.parse(q)).toBe(q);
  });
  it('rejects invalid wait metadata while preserving legacy manual needs-action records', () => {
    const q = queue(), i = nextQueueItem(q)!; i.state = 'needs-action';
    expect(queueSchema.parse(q)).toBe(q);
    i.waitingFor = 'login'; expect(() => queueSchema.parse(q)).toThrow('waiting');
    Object.assign(i, { attempt: crypto.randomUUID(), tabId: 1, resumeUntil: 1 });
    expect(queueSchema.parse(q)).toBe(q);
    i.state = 'review'; i.applicationId = 1; expect(() => queueSchema.parse(q)).toThrow('waiting');
  });
  it('only grants original job identity across apply routes, never login or another job', () => {
    const i = queue().items[0]!;
    expect(queueJobMatches(i, i.url + '/apply?utm_source=test')).toBe(true);
    expect(queueJobMatches(i, 'https://jobs.lever.co/example/login')).toBe(false);
    expect(queueJobMatches(i, 'https://jobs.lever.co/example/job1/apply')).toBe(false);
    expect(queueJobMatches(i, undefined)).toBe(false);
    expect(queueJobMatches({ ...i, key: queueKey('https://example.com/apply?id=1') }, 'https://example.com/apply?id=2')).toBe(false);
  });
});
