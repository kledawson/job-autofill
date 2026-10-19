import type { FillContext } from './messages';
import { jobKey, detectPlatform } from './platforms';
import type { Application } from './types';
export interface QueueItem {
  id: string; url: string; key: string;
  state: 'queued' | 'opening' | 'filling' | 'review' | 'needs-action' | 'submitted' | 'skipped';
  batch: number; attempt?: string; tabId?: number; frameId?: number; applicationId?: number; deadline?: number; note?: string;
  submitIntentAt?: number;
  /** Metadata only; no authentication values are captured. Absent on legacy records. */
  waitingFor?: QueueWaitReason;
  resumeUntil?: number;
}
export type QueueWaitReason = 'login' | 'account' | 'verification' | 'navigation';
export const QUEUE_WAIT_MS = 30 * 60_000;
export const queueWaitReasons: QueueWaitReason[] = ['login', 'account', 'verification', 'navigation'];
export function clearQueueWait(item: QueueItem) { item.waitingFor = undefined; item.resumeUntil = undefined; }
/** Authentication redirects may wait in their owned tab, but only the original job may claim a writer. */
export function queueJobMatches(item: QueueItem, topUrl: string | undefined): boolean {
  try { return !!topUrl && queueKey(topUrl) === item.key; } catch { return false; }
}
export interface QueueState {
  id: 'current'; schemaVersion: 1; token: string; status: 'running' | 'paused' | 'stopped' | 'complete';
  batchSize: number; batch: number; createdAt: number; items: QueueItem[];
  mode?: 'batch' | 'continuous'; autoDetectSubmission?: boolean;
}
export type QueueSnapshot = Omit<FillContext, 'profile' | 'hasGeminiKey' | 'runId' | 'queue'>;
export type QueueRecord = QueueState & { presetName: string; resumeName?: string };
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
export const queueSchema = { parse(value: unknown): QueueState {
  const q = value as QueueState;
  if (!q || q.id !== 'current' || q.schemaVersion !== 1 || !uuid(q.token) ||
      !['running', 'paused', 'stopped', 'complete'].includes(q.status) ||
      !integer(q.batch) || !integer(q.createdAt) || !Array.isArray(q.items) || q.items.length < 1 || q.items.length > 100) throw new Error('Invalid stored queue. Stop it and create a new queue.');
  batchSize(q.batchSize);
  if (q.mode !== undefined && !['batch', 'continuous'].includes(q.mode)) throw new Error('Invalid queue mode.');
  if (q.autoDetectSubmission !== undefined && typeof q.autoDetectSubmission !== 'boolean') throw new Error('Invalid submission detection setting.');
  if ((q.mode === 'continuous' ? queueOccupancy(q) : q.items.filter(i => i.batch === q.batch && i.batch > 0).length) > 5) throw new Error('Invalid queue: batch exceeds five tabs.');
  const attempts = new Set<string>(), tabs = new Set<number>();
  const ids = new Set<string>(), keys = new Set<string>();
  for (const i of q.items) {
    if (!i || !uuid(i.id) || ids.has(i.id) || !integer(i.batch) || i.batch > q.batch ||
        typeof i.key !== 'string' || i.key.length > 2400 ||
        !['queued', 'opening', 'filling', 'review', 'needs-action', 'submitted', 'skipped'].includes(i.state) ||
        (i.attempt !== undefined && !uuid(i.attempt)) ||
        [i.tabId, i.frameId, i.applicationId, i.deadline, i.submitIntentAt, i.resumeUntil].some(v => v !== undefined && !integer(v)) ||
        (i.note !== undefined && (typeof i.note !== 'string' || i.note.length > 500))) throw new Error('Invalid stored queue item.');
    if (inFlight(i) && (!uuid(i.attempt) || i.deadline === undefined || i.batch === 0)) throw new Error('Invalid active queue attempt.');
    if (i.state === 'filling' && (i.tabId === undefined || i.frameId === undefined)) throw new Error('Invalid queue frame ownership.');
    if (i.state === 'review' && !i.applicationId) throw new Error('Invalid queue review result.');
    if (i.waitingFor !== undefined && (!queueWaitReasons.includes(i.waitingFor) || i.state !== 'needs-action' || !i.attempt || i.tabId === undefined || i.resumeUntil === undefined || i.batch === 0)) throw new Error('Invalid waiting queue attempt.');
    if (i.resumeUntil !== undefined && i.waitingFor === undefined) throw new Error('Invalid queue resume deadline.');
    if (queueKey(queueUrl(i.url)) !== i.key) throw new Error('Invalid stored application link.');
    if (keys.has(i.key)) throw new Error('Duplicate job in stored queue.');
    keys.add(i.key);
    if (inFlight(i) && i.batch !== q.batch) throw new Error('Active attempt outside current batch.');
    if (i.attempt && attempts.has(i.attempt)) throw new Error('Duplicate queue attempt.');
    if (i.tabId !== undefined && tabs.has(i.tabId)) throw new Error('Duplicate queue tab.');
    if (i.attempt) attempts.add(i.attempt);
    if (i.tabId !== undefined) tabs.add(i.tabId);
    ids.add(i.id);
  }
  return q;
} };
export const settled = (i: QueueItem) => i.state === 'submitted' || i.state === 'skipped';
export const inFlight = (i: QueueItem) => i.state === 'opening' || i.state === 'filling';
/** Opening claims reserve capacity before tabs exist; closed blocked jobs hold metadata only. */
export function queueOccupancy(q: QueueState): number {
  return q.items.filter(i => i.batch > 0 && (i.tabId !== undefined || inFlight(i))).length;
}
export type QueueLinkChoice = { url: string; kind: 'new' | 'queued' | 'submitted' | 'unfinished' | 'abandoned'; app?: Application; item?: QueueItem };
/** Shared preview/commit policy. Submitted history always wins over older unfinished records. */
export function queueLinkChoices(urls: string[], apps: Application[], queue?: QueueState): QueueLinkChoice[] {
  return urls.map(url => {
    const key = queueKey(url), item = queue?.items.find(i => i.key === key);
    if (item) return { url, kind: 'queued', item };
    const matches = apps.filter(a => a.jobKey === jobKey(url) || queueKey(a.url) === key);
    const app = matches.find(a => a.status === 'Submitted') ?? matches.sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
    return { url, app, kind: !app ? 'new' : app.status === 'Submitted' ? 'submitted' : app.status === 'Abandoned' ? 'abandoned' : 'unfinished' };
  });
}
export function validateQueueResumes(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(value).size !== value.length) throw new Error('Invalid application resume selection. Review the links again.');
  return value;
}
export function batchSize(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 5) throw new Error('Choose between 1 and 5 applications per batch.');
  return Number(value);
}
export function queueUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.length > 2048) throw new Error('Use full http or https job links without credentials.');
  if (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com')) throw new Error('LinkedIn is not supported. Use the company application link.');
  url.hash = ''; return url.href;
}
export function queueKey(raw: string): string {
  if (detectPlatform(raw)) return jobKey(raw);
  const url = new URL(raw); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); return url.href;
}
export function parseQueueLinks(input: string) {
  if (input.length > 250000) throw new Error('Paste at most 100 application links.');
  const tokens = (input.match(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"\u201c\u201d]+/gi) ?? []).flatMap(t => t.split(/,(?=https?:\/\/)/i));
  const urls: string[] = [], rejected: string[] = [], seen = new Set<string>(); let duplicates = 0;
  for (const raw of tokens) {
    const value = raw.replace(/[),.;\]]+$/, '');
    try {
      const url = queueUrl(value), key = queueKey(url);
      if (seen.has(key)) { duplicates++; continue; } seen.add(key); urls.push(url);
    } catch (err) { rejected.push(err instanceof Error ? err.message : 'Invalid link.'); }
  }
  if (urls.length > 100) throw new Error('Use at most 100 application links per queue.');
  return { urls, duplicates, rejected, noLinks: !!input.trim() && !tokens.length };
}
export function nextQueueItem(q: QueueState): QueueItem | undefined {
  if (['running', 'paused'].includes(q.status) && q.items.length && q.items.every(i => settled(i) && i.tabId === undefined)) { q.status = 'complete'; return; }
  if (q.status !== 'running') return;
  if (q.mode === 'continuous') {
    const open = queueOccupancy(q);
    const assigned = q.items.find(i => i.batch > 0 && i.state === 'queued' && (i.tabId !== undefined || open < q.batchSize));
    if (assigned) return assigned;
    if (open >= q.batchSize) return;
    const next = q.items.find(i => i.batch === 0 && i.state === 'queued');
    if (next) { q.batch = 1; next.batch = 1; return next; }
    if (!open && q.items.every(settled)) q.status = 'complete';
    return;
  }
  const current = q.items.filter(i => i.batch === q.batch && i.batch > 0);
  if (current.some(i => i.state === 'queued')) return current.find(i => i.state === 'queued');
  if (current.some(i => !settled(i) || i.tabId !== undefined)) return;
  const pending = q.items.filter(i => i.batch === 0 && i.state === 'queued').slice(0, q.batchSize);
  if (!pending.length) { q.status = 'complete'; return; }
  q.batch++; pending.forEach(i => { i.batch = q.batch; }); return pending[0];
}
