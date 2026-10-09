import { browser, type Browser } from 'wxt/browser';
import { db, getProfile } from './db';
import { buildPresetContext } from './preset-db';
import { defaultPreset, parsePreset, profileForPreset } from './presets';
import { getSettings } from './settings';
import { detectPlatform, jobKey, toApplicationUrl } from './platforms';
import { batchSize, inFlight, nextQueueItem, queueKey, queueSchema, queueUrl, settled, type QueueItem, type QueueRecord, type QueueSnapshot } from './application-queue';
import type { ContentMessage, FillContext } from './messages';

let initialized: Promise<void> = Promise.resolve();
const ALARM = 'application-queue';
const ownershipKey = (tabId: number) => 'queueTab:' + tabId;
async function ownsTab(item: QueueItem, token: string) {
  if (item.tabId === undefined) return false;
  const marker = (await browser.storage.session.get(ownershipKey(item.tabId)))[ownershipKey(item.tabId)];
  return marker === token + ':' + item.id;
}
type Sender = Browser.runtime.MessageSender;
const errorText = (e: unknown) => e instanceof Error ? e.message.slice(0, 500) : 'Could not process this application.';
function valid(raw: QueueRecord | undefined) {
  if (!raw) return;
  queueSchema.parse(raw);
  if (typeof raw.presetName !== 'string' || raw.presetName.length > 80 || (raw.resumeName !== undefined && typeof raw.resumeName !== 'string')) throw new Error('Invalid queue preset metadata.');
  return raw;
}
async function queueSnapshot(token: string): Promise<QueueSnapshot> {
  const stored = await db.queueContexts.get(token), snapshot = stored?.snapshot;
  if (!snapshot?.preset) throw new Error('Queue preset is missing. Stop this queue and start again.');
  parsePreset({ ...defaultPreset(), ...snapshot.preset });
  for (const file of [snapshot.resume, snapshot.coverLetter, snapshot.transcript]) {
    if (file !== null && (!file || typeof file.name !== 'string' || file.name.length > 500 || typeof file.type !== 'string' || typeof file.base64 !== 'string' || file.base64.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))) throw new Error('Invalid queue document. Stop and start a new queue.');
  }
  return snapshot;
}
/** All decisions and attempts are claimed atomically. Worker globals are never the source of truth. */
async function mutate<T>(fn: (q: QueueRecord) => T | Promise<T>): Promise<T | undefined> {
  return db.transaction('rw', db.applicationQueue, db.applications, async () => {
    const q = valid(await db.applicationQueue.get('current'));
    if (!q) return;
    const before = JSON.stringify(q);
    const result = await fn(q);
    if (JSON.stringify(q) !== before) await db.applicationQueue.put(q);
    return result;
  });
}
export async function queuePublic() {
  const q = valid(await db.applicationQueue.get('current'));
  if (!q) return null;
  return q;
}
export async function queueStart(urls: string[], size: number, presetId?: string) {
  await initialized;
  await browser.storage.session.set({ queueBrowserSession: true });
  batchSize(size);
  if (!Array.isArray(urls) || !urls.length || urls.length > 100 || urls.some(u => typeof u !== 'string')) throw new Error('Choose 1–100 new application links.');
  const normalized = urls.map(queueUrl);
  if (new Set(normalized.map(queueKey)).size !== normalized.length) throw new Error('Remove duplicate links before starting.');
  for (const url of normalized) {
    if (!detectPlatform(url) && !await browser.permissions.contains({ origins: [new URL(url).origin + '/*'] })) throw new Error('Allow access to these application sites first.');
  }
  const stopped = valid(await db.applicationQueue.get('current'));
  for (const item of stopped?.status === 'stopped' ? stopped.items : []) {
    if (item.tabId === undefined) continue;
    const ping = await browser.tabs.sendMessage(item.tabId, { type: 'ping' } satisfies ContentMessage).catch(() => undefined);
    if (ping?.filling) throw new Error('The previous fill is stopping. Wait a moment before starting another queue.');
  }
  const context = await buildPresetContext(presetId);
  if (!context.profile.firstName || !context.profile.email) throw new Error('Finish your profile first (at least name and email).');
  const { profile: _profile, hasGeminiKey: _key, runId: _run, queue: _queue, ...snapshot } = context;
  await db.transaction('rw', db.applicationQueue, db.queueContexts, db.applications, async () => {
    const existing = valid(await db.applicationQueue.get('current'));
    if (existing && !['complete', 'stopped'].includes(existing.status)) throw new Error('Finish or stop the current queue first.');
    if (existing?.items.some(i => inFlight(i))) throw new Error('Wait for the previous fill to stop.');
    const apps = await db.applications.toArray();
    if (normalized.some(url => apps.some(a => a.jobKey === jobKey(url) || queueKey(a.url) === queueKey(url)))) throw new Error('Some links were already tracked. Refresh the link preview and review those applications instead.');
    const token = crypto.randomUUID();
    await db.queueContexts.clear();
    await db.queueContexts.put({ id: token, snapshot });
    await db.applicationQueue.put({ id: 'current', schemaVersion: 1, token, status: 'running', batchSize: size, batch: 0, createdAt: Date.now(),
      presetName: snapshot.preset!.name, resumeName: snapshot.resume?.name, items: normalized.map(url => ({ id: crypto.randomUUID(), url, key: queueKey(url), state: 'queued', batch: 0 })) });
  });
  await browser.alarms.create(ALARM, { periodInMinutes: 0.5 });
  await queuePump();
}
function openingUrl(attempt: string) { return browser.runtime.getURL('/opening.html') + '#queue=' + attempt; }
async function cancel(item: QueueItem) {
  if (item.tabId !== undefined) await browser.tabs.sendMessage(item.tabId, { type: 'cancelQueue', runId: item.attempt } satisfies ContentMessage).catch(() => undefined);
  if (item.attempt) await db.fillRuns.delete(item.attempt);
}
export async function queuePump() {
  const claim = await mutate(q => {
    const item = nextQueueItem(q);
    if (!item) return;
    item.state = 'opening'; item.attempt = crypto.randomUUID(); item.frameId = undefined;
    item.deadline = Date.now() + 60000; item.note = undefined;
    return { token: q.token, item: structuredClone(item) };
  });
  if (!claim) {
    const q = valid(await db.applicationQueue.get('current'));
    if (q?.status === 'complete') await browser.alarms.clear(ALARM);
    return;
  }
  try {
    if (claim.item.tabId !== undefined) {
      const snapshot = await queueSnapshot(claim.token);
      if (!await ownsTab(claim.item, claim.token)) throw new Error('This tab belongs to an earlier browser session. Retry after reopening the queue.');
      const tab = await browser.tabs.get(claim.item.tabId);
      if (!tab.url || queueKey(tab.url) !== queueKey(toApplicationUrl(claim.item.url))) throw new Error('This tab navigated away. Open the application again before retrying.');
      await prepare(claim.token, claim.item, snapshot);
      await browser.tabs.sendMessage(claim.item.tabId, { type: 'fill', runId: claim.item.attempt } satisfies ContentMessage);
    } else {
      // The extension page registers the attempt if the worker stops between create and persistence.
      const tab = await browser.tabs.create({ url: openingUrl(claim.item.attempt!), active: false });
      if (tab.id === undefined) throw new Error('Could not create the application tab.');
      await queueOpening(claim.item.attempt!, { id: browser.runtime.id, url: openingUrl(claim.item.attempt!), tab });
    }
  } catch (err) { await fail(claim.item.attempt!, errorText(err)); }
}
async function prepare(token: string, item: QueueItem, snapshot: QueueSnapshot) {
  if (item.tabId === undefined || !item.attempt) throw new Error('Missing application tab.');
  const profile = await getProfile();
  if (!profile.firstName || !profile.email) throw new Error('Finish your profile (name and email), then retry this application.');
  const context: FillContext = { ...snapshot, profile: profileForPreset(profile, snapshot.preset!), hasGeminiKey: !!(await getSettings()).geminiApiKey,
    runId: item.attempt, queue: { token, itemId: item.id, attempt: item.attempt } };
  await db.transaction('rw', db.applicationQueue, db.fillRuns, async () => {
    const q = valid(await db.applicationQueue.get('current')), current = q?.items.find(i => i.attempt === item.attempt);
    if (!q || q.token !== token || !current || current.state !== 'opening' || q.status === 'stopped') throw new Error('Queue attempt was cancelled.');
    await db.fillRuns.where('tabId').equals(item.tabId!).delete();
    await db.fillRuns.put({ id: item.attempt!, tabId: item.tabId!, topUrl: toApplicationUrl(item.url), createdAt: Date.now(), context });
  });
}
export async function queueOpening(attempt: string, sender: Sender) {
  if (sender.id !== browser.runtime.id || sender.tab?.id === undefined || sender.url !== openingUrl(attempt)) throw new Error('Invalid queue opening page.');
  const claimed = await mutate(q => {
    const item = q.items.find(i => i.attempt === attempt);
    if (!item || item.state !== 'opening' || q.status === 'stopped') return;
    if (item.tabId !== undefined) return; // Parent and page handshake race: just one owns navigation.
    item.tabId = sender.tab!.id;
    return { token: q.token, item: structuredClone(item) };
  });
  if (!claimed) return;
  await browser.storage.session.set({ [ownershipKey(claimed.item.tabId!)]: claimed.token + ':' + claimed.item.id });
  await prepare(claimed.token, claimed.item, await queueSnapshot(claimed.token));
  await browser.tabs.update(claimed.item.tabId!, { url: toApplicationUrl(claimed.item.url) });
}
export async function queuePending(tabId: number, frameId: number, commit: boolean) {
  return (await mutate(q => {
    const item = q.items.find(i => i.tabId === tabId && inFlight(i));
    if (!item || !item.attempt || q.status === 'stopped') return { fill: false };
    if (item.state === 'filling') return { fill: false }; // One frame owns the initial fill.
    if (commit) { item.state = 'filling'; item.frameId = frameId; item.deadline = Date.now() + 180000; }
    return { fill: true, runId: item.attempt, queued: true };
  })) ?? { fill: false };
}
export async function queueOwns(runId: string, sender: Sender, writing = false) {
  const q = valid(await db.applicationQueue.get('current'));
  const item = q?.items.find(i => i.attempt === runId && i.tabId === sender.tab?.id);
  if (!item) throw new Error('This queue attempt was replaced.');
  if (q?.status === 'stopped' || !['filling', 'review'].includes(item.state) || (item.frameId !== undefined && item.frameId !== (sender.frameId ?? 0)) ||
      (writing && item.state !== 'filling')) throw new Error('This queue fill has finished or was cancelled.');
}
export async function queueFinished(runId: string, sender: Sender, applicationId?: number, note?: string) {
  const item = await mutate(q => {
    const i = q.items.find(i => i.attempt === runId && i.tabId === sender.tab?.id);
    if (!i || !inFlight(i) || q.status === 'stopped') return;
    if (i.frameId !== undefined && i.frameId !== (sender.frameId ?? 0)) return;
    i.state = note ? 'needs-action' : 'review'; i.note = note; i.applicationId = applicationId;
    i.deadline = undefined;
    return structuredClone(i);
  });
  if (note && item) await cancel(item);
  await queuePump();
}
async function fail(attempt: string, note: string) {
  const item = await mutate(q => {
    const i = q.items.find(i => i.attempt === attempt);
    if (!i || !inFlight(i)) return;
    i.state = 'needs-action'; i.note = note; i.deadline = undefined;
    return structuredClone(i);
  });
  if (item) await cancel(item);
  await queuePump();
}
export async function queueControl(action: 'pause' | 'resume' | 'stop' | 'size', size?: number) {
  await initialized;
  if (action === 'size') batchSize(size);
  const cancelled = await mutate(q => {
    if (action === 'size') q.batchSize = size!;
    else if (action === 'pause' && q.status === 'running') q.status = 'paused';
    else if (action === 'resume' && q.status === 'paused') q.status = 'running';
    else if (action === 'stop') { q.status = 'stopped'; return q.items.filter(inFlight).map(i => { i.state = 'needs-action'; i.note = 'Stopped. Your page answers were kept.'; i.deadline = undefined; return structuredClone(i); }); }
    return [];
  });
  for (const item of cancelled ?? []) await cancel(item);
  if (action === 'stop') await browser.alarms.clear(ALARM);
  else { await browser.alarms.create(ALARM, { periodInMinutes: 0.5 }); await queuePump(); }
}
export async function queueAction(token: string, itemId: string, action: 'open' | 'retry' | 'submitted' | 'skip') {
  const q = valid(await db.applicationQueue.get('current'));
  if (!q || q.token !== token) throw new Error('This queue changed. Refresh the panel.');
  const current = q.items.find(i => i.id === itemId);
  if (!current) throw new Error('Application no longer in this queue.');
  if (action === 'open') {
    if (current.tabId === undefined) throw new Error('This application tab is closed. Retry to reopen it.');
    const tab = await browser.tabs.update(current.tabId, { active: true });
    if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true }); return;
  }
  const item = await mutate(async state => {
    if (state.token !== token) throw new Error('This queue changed.');
    const i = state.items.find(i => i.id === itemId)!;
    if (action === 'skip' && inFlight(i)) throw new Error('Wait for this fill to finish, or stop the queue to keep its tabs.');
    if (settled(i)) return structuredClone(i); // Double clicks retry closure, never submit twice.
    if (action === 'retry') {
      if (inFlight(i) || i.batch === 0 || !['running', 'paused'].includes(state.status)) throw new Error('Resume the queue and wait for the current fill before retrying.');
      i.state = 'queued'; i.note = undefined;
    } else {
      if (action === 'submitted' && (i.state !== 'review' || !i.applicationId)) throw new Error('Wait for autofill, then verify successful submission on the website.');
      if (action === 'submitted') {
        const app = await db.applications.get(i.applicationId!);
        if (!app) throw new Error('Application history was removed. Skip this entry instead.');
        if (app.status !== 'Submitted') await db.applications.update(i.applicationId!, { status: 'Submitted', submittedAt: Date.now(), sheetError: 'Sheet sync pending. Retry from the application tracker if needed.' });
      }
      if (action === 'skip' && i.applicationId) {
        const app = await db.applications.get(i.applicationId);
        if (app && app.status !== 'Submitted') await db.applications.update(i.applicationId, { status: 'Abandoned' });
      }
      i.state = action === 'submitted' ? 'submitted' : 'skipped'; i.deadline = undefined;
    }
    return structuredClone(i);
  });
  if (!item) return;
  await cancel(item);
  if (action !== 'retry' && item.tabId !== undefined) {
    // Only IDs created and bound by this queue are ever closed.
    const tab = await browser.tabs.get(item.tabId).catch(() => undefined);
    if (tab) {
      if (!await ownsTab(item, token)) throw new Error('This tab is no longer owned by the queue. Close it yourself to preserve other tabs.');
      await browser.tabs.remove(item.tabId).catch(async err => {
        if (await browser.tabs.get(item.tabId!).catch(() => undefined)) throw err;
      });
    }
    await mutate(state => { const i = state.items.find(i => i.id === itemId); if (i && i.tabId === item.tabId) i.tabId = undefined; });
  }
  await queuePump();
  return item.applicationId;
}
export async function queueRemoved(tabId: number) {
  await browser.storage.session.remove(ownershipKey(tabId));
  const item = await mutate(q => {
    const i = q.items.find(i => i.tabId === tabId);
    if (!i) return;
    const copy = structuredClone(i);
    i.tabId = undefined; i.deadline = undefined;
    if (!settled(i)) { i.state = 'needs-action'; i.note = 'Tab closed before submission was confirmed. Retry or skip.'; }
    return copy;
  });
  if (item) await cancel(item);
  await queuePump();
}
export async function queueTick() {
  const q = valid(await db.applicationQueue.get('current'));
  if (!q || ['stopped', 'complete'].includes(q.status)) return;
  for (const item of q.items) {
    if (item.tabId !== undefined) {
      const tab = await browser.tabs.get(item.tabId).catch(() => undefined);
      if (!tab) { await queueRemoved(item.tabId); continue; }
      if (!await ownsTab(item, q.token)) {
        if (tab.url === openingUrl(item.attempt!)) await browser.storage.session.set({ [ownershipKey(item.tabId)]: q.token + ':' + item.id });
        else { await mutate(state => { const i = state.items.find(i => i.id === item.id)!; i.tabId = undefined; if (!settled(i)) { i.state = 'needs-action'; i.note = 'Previous session tab was kept. Retry to open a new queue tab.'; } }); continue; }
      }
      if (settled(item)) { await browser.tabs.remove(item.tabId).catch(() => undefined); await queueRemoved(item.tabId); continue; }
      if (item.state === 'opening' && tab.status === 'complete' && tab.url !== openingUrl(item.attempt!)) {
        // Lost content-message acknowledgements after a worker restart can be retried safely.
        // Each frame waits for its own form before an atomic claim chooses the owner.
        await browser.tabs.sendMessage(item.tabId, { type: 'fill', runId: item.attempt } satisfies ContentMessage).catch(() => undefined);
      }
      if (inFlight(item) && tab.url === openingUrl(item.attempt!)) {
        // Recover a worker interruption after the handshake bound the tab but before navigation.
        const run = await db.fillRuns.get(item.attempt!);
        if (!run) await prepare(q.token, item, await queueSnapshot(q.token));
        await browser.tabs.update(item.tabId, { url: toApplicationUrl(item.url) });
      }
    }
    if (inFlight(item) && (item.deadline ?? 0) < Date.now()) await fail(item.attempt!, 'Autofill timed out. Open the tab, finish sign-in or open the form, then retry.');
  }
  await queuePump();
}
export async function queueBrowserStartup() {
  const previous = await mutate(q => {
    if (q.status === 'running') q.status = 'paused';
    const ids = q.items.map(i => i.attempt).filter((id): id is string => !!id);
    for (const i of q.items) {
      i.tabId = undefined; i.deadline = undefined;
      if (!settled(i) && i.batch > 0) { i.state = 'needs-action'; i.note = 'Browser restarted. Previous tabs were kept; retry opens a new queue tab. Unsaved website answers may be lost.'; }
    }
    return ids;
  });
  for (const id of previous ?? []) await db.fillRuns.delete(id);
}
export async function queueBusy() {
  const q = valid(await db.applicationQueue.get('current'));
  return q?.items.some(inFlight) ?? false;
}
export async function queueTab(tabId: number) {
  const q = valid(await db.applicationQueue.get('current'));
  return q && !['stopped', 'complete'].includes(q.status) && q.items.some(i => i.tabId === tabId);
}
export function installQueue() {
  browser.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void queueTick().catch(() => undefined); });
  browser.runtime.onStartup.addListener(() => { void initialized; });
  initialized = (async () => {
    const boot = await browser.storage.session.get('queueBrowserSession');
    if (!boot.queueBrowserSession) { await queueBrowserStartup(); await browser.storage.session.set({ queueBrowserSession: true }); }
  })();
  void initialized.then(async () => {
    const q = valid(await db.applicationQueue.get('current'));
    if (q && !['stopped', 'complete'].includes(q.status)) { await browser.alarms.create(ALARM, { periodInMinutes: 0.5 }); await queueTick(); }
  }).catch(() => undefined);
}
