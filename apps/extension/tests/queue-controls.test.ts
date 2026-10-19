import { describe, expect, it } from 'vitest';
import { nextQueueItem, queueKey, queueLinkChoices, queueOccupancy, queueSchema, validateQueueResumes, type QueueState } from '../lib/application-queue';
import { jobKey } from '../lib/platforms';
import type { Application } from '../lib/types';

const url = (n: number) => `https://jobs.lever.co/example/${n}`;
const queue = (): QueueState => ({ id: 'current', schemaVersion: 1, token: crypto.randomUUID(), mode: 'continuous', status: 'running', batchSize: 3, batch: 0, createdAt: 1,
  items: Array.from({ length: 8 }, (_, n) => ({ id: crypto.randomUUID(), url: url(n), key: queueKey(url(n)), state: 'queued', batch: 0 })) });
const app = (id: number, status: Application['status']): Application => ({ id, status, url: url(id), jobKey: jobKey(url(id)), platform: 'lever', company: 'Example', role: 'Fictional Engineer', filledAt: 1, aiAnswers: 0, filledCount: 0, missingCount: 0, missingLabels: [] });
function claim(q: QueueState) { const i = nextQueueItem(q); if (i) Object.assign(i, { state: 'opening', attempt: crypto.randomUUID(), deadline: 100 }); return i; }

describe('live queue controls', () => {
  it('finishes a paused queue after its last confirmed tab closes without launching anything', () => {
    const q = queue(); q.status = 'paused'; q.items.forEach(i => { i.state = 'submitted'; });
    q.items[0]!.tabId = 1; expect(nextQueueItem(q)).toBeUndefined(); expect(q.status).toBe('paused');
    q.items[0]!.tabId = undefined; expect(nextQueueItem(q)).toBeUndefined(); expect(q.status).toBe('complete');
  });
  it('opens exactly two more claims at 3→5, keeps tabs at 5→2, and honors pause', () => {
    const q = queue(); for (let n = 0; n < 3; n++) claim(q); expect(claim(q)).toBeUndefined();
    q.batchSize = 5; claim(q); claim(q); expect(claim(q)).toBeUndefined(); expect(queueOccupancy(q)).toBe(5);
    q.batchSize = 2; q.items.slice(0, 3).forEach(i => { i.state = 'skipped'; i.deadline = undefined; });
    expect(claim(q)).toBeUndefined(); expect(queueOccupancy(q)).toBe(2);
    q.items[3]!.state = 'skipped'; q.status = 'paused'; expect(claim(q)).toBeUndefined();
    q.status = 'running'; expect(claim(q)).toBe(q.items[5]); expect(queueOccupancy(q)).toBe(2);
    expect(queueSchema.parse(q)).toBe(q);
  });
  it('counts login, blocked and closing tabs, but releases a closed blocked slot', () => {
    const q = queue(); const a = claim(q)!, b = claim(q)!, c = claim(q)!;
    Object.assign(a, { state: 'needs-action', tabId: 1, waitingFor: 'login', resumeUntil: 1000 });
    Object.assign(b, { state: 'needs-action', tabId: 2 }); Object.assign(c, { state: 'submitted', tabId: 3 });
    expect(queueOccupancy(q)).toBe(3); expect(claim(q)).toBeUndefined();
    b.tabId = undefined; expect(claim(q)).toBe(q.items[3]); expect(queueOccupancy(q)).toBe(3);
    expect(queueSchema.parse(q)).toBe(q);
  });
  it('keeps a closed retry waiting when all slots are occupied', () => {
    const q = queue(); claim(q); claim(q); claim(q);
    q.items[3]!.batch = 1; expect(claim(q)).toBeUndefined();
    q.items[0]!.state = 'skipped'; expect(claim(q)).toBe(q.items[3]);
  });
  it('distinguishes queued, unfinished, abandoned and submitted history, including URL variants', () => {
    const q = queue(); q.items = [q.items[0]!];
    const apps = [app(1, 'Ready for review'), app(2, 'Abandoned'), app(3, 'Submitted'), { ...app(4, 'Filling'), url: url(3), jobKey: jobKey(url(3)) }];
    const choices = queueLinkChoices([url(0) + '/apply?utm_source=test', url(1), url(2), url(3), url(5)], apps, q);
    expect(choices.map(c => c.kind)).toEqual(['queued', 'unfinished', 'abandoned', 'submitted', 'new']);
    expect(choices[3]!.app?.id).toBe(3);
  });
  it('rejects malformed or repeated explicit resume selections', () => {
    for (const value of [null, ['1'], [0], [1, 1], [1.1], Array.from({ length: 101 }, (_, i) => i + 1)]) expect(() => validateQueueResumes(value)).toThrow();
    expect(validateQueueResumes([1, 2])).toEqual([1, 2]);
  });
});
