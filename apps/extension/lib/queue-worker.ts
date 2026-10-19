import { browser, type Browser } from 'wxt/browser';
import { db, getProfile } from './db';
import { buildPresetContext } from './preset-db';
import { defaultPreset, parsePreset, profileForPreset } from './presets';
import { getSettings } from './settings';
import { detectPlatform, jobKey, toApplicationUrl } from './platforms';
import { batchSize, inFlight, nextQueueItem, queueKey, queueSchema, queueUrl, settled, queueLinkChoices, queueOccupancy, validateQueueResumes, type QueueItem, type QueueRecord, type QueueSnapshot } from './application-queue';
import type { ContentMessage, FillContext } from './messages';
import { submittedPatch } from './submission-state';
import { clearQueueWait, queueJobMatches, QUEUE_WAIT_MS, queueWaitReasons, type QueueWaitReason } from './application-queue';
import type { Application } from './types';

let initialized: Promise<void> = Promise.resolve();
const ALARM = 'application-queue';
const ownershipKey = (tabId: number) => 'queueTab:' + tabId;
export async function ownsTab(item: QueueItem, token: string) {
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
async function queueLinks(urls: string[]) {
  if (!Array.isArray(urls) || !urls.length || urls.length > 100 || urls.some(u => typeof u !== 'string')) throw new Error('Choose 1–100 new application links.');
  const normalized = [...new Map(urls.map(queueUrl).map(url => [queueKey(url), url])).values()];
  for (const url of normalized) {
    if (!detectPlatform(url) && !await browser.permissions.contains({ origins: [new URL(url).origin + '/*'] })) throw new Error('Allow access to these application sites first.');
  }
  return normalized;
}
function selectedLinks(urls: string[], apps: Application[], resumeIds: number[], q?: QueueRecord) {
  const choices = queueLinkChoices(urls, apps, q);
  if (resumeIds.some(id => !choices.some(c => (c.app?.id === id && ['unfinished', 'abandoned'].includes(c.kind)) || (c.kind === 'queued' && c.item?.applicationId === id)))) throw new Error('An application changed. Review the link preview before continuing.');
  return choices.filter(c => c.kind === 'new' || (c.app?.id !== undefined && resumeIds.includes(c.app.id)));
}
export async function queueStart(urls: string[], size: number, presetId?: string, mode: 'batch' | 'continuous' = 'batch', autoDetectSubmission = false, resumeApplicationIds: number[] = []) {
  await initialized;
  await browser.storage.session.set({ queueBrowserSession: true });
  batchSize(size); validateQueueResumes(resumeApplicationIds);
  if (!['batch', 'continuous'].includes(mode) || typeof autoDetectSubmission !== 'boolean') throw new Error('Invalid queue preferences.');
  const normalized = await queueLinks(urls);
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
    const selected = selectedLinks(normalized, apps, resumeApplicationIds);
    if (!selected.length) throw new Error('No new jobs to queue. Choose an unfinished application to resume; submitted jobs stay excluded.');
    const token = crypto.randomUUID();
    await db.queueContexts.clear();
    await db.queueContexts.put({ id: token, snapshot });
    await db.applicationQueue.put({ id: 'current', schemaVersion: 1, token, status: 'running', batchSize: size, batch: 0, createdAt: Date.now(),
      mode, autoDetectSubmission, presetName: snapshot.preset!.name, resumeName: snapshot.resume?.name, items: selected.map(({ url, app }) => ({ id: crypto.randomUUID(), url, key: queueKey(url), state: 'queued', batch: 0, applicationId: app?.id })) });
  });
  await browser.alarms.create(ALARM, { periodInMinutes: 0.5 });
  await queuePump();
}
export async function queueAdd(token: string, urls: string[], resumeApplicationIds: number[] = []) {
  await initialized; validateQueueResumes(resumeApplicationIds);
  const normalized = await queueLinks(urls);
  const result = await mutate(async q => {
    if (q.token !== token || !['running', 'paused'].includes(q.status)) throw new Error('This queue changed. Review the current queue before adding links.');
    const selected = selectedLinks(normalized, await db.applications.toArray(), resumeApplicationIds, q);
    if (q.items.length + selected.length > 100) throw new Error(`This queue has room for ${100 - q.items.length} more jobs. Remove some links and try again.`);
    q.items.push(...selected.map(({ url, app }): QueueItem => ({ id: crypto.randomUUID(), url, key: queueKey(url), state: 'queued', batch: 0, applicationId: app?.id })));
    return { added: selected.length, excluded: normalized.length - selected.length };
  });
  if (!result) throw new Error('This queue no longer exists. Start a new queue.');
  await browser.alarms.create(ALARM, { periodInMinutes: 0.5 }); await queuePump();
  return result;
}
function openingUrl(attempt: string) { return browser.runtime.getURL('/opening.html') + '#queue=' + attempt; }
async function cancel(item: QueueItem, wait = false) {
  if (item.tabId !== undefined) await browser.tabs.sendMessage(item.tabId, { type: 'cancelQueue', runId: item.attempt, wait } satisfies ContentMessage).catch(() => undefined);
  if (item.tabId !== undefined) await browser.tabs.update(item.tabId, { autoDiscardable: true }).catch(() => undefined);
  if (item.attempt) await db.fillRuns.delete(item.attempt);
}
async function launchNext(requestedId?: string) {
  const claim = await mutate(q => {
    const requested = requestedId ? q.items.find(i => i.id === requestedId && i.state === 'queued' && i.batch > 0 && i.batch === q.batch) : undefined;
    const available = requested && (q.mode !== 'continuous' || requested.tabId !== undefined || queueOccupancy(q) < q.batchSize);
    const item = available && ['running', 'paused'].includes(q.status) ? requested : requestedId ? undefined : nextQueueItem(q);
    if (!item) return;
    item.state = 'opening'; item.attempt = crypto.randomUUID(); item.frameId = undefined;
    clearQueueWait(item);
    item.deadline = Date.now() + 60000; item.note = undefined; item.submitIntentAt = undefined;
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
      const ping = await browser.tabs.sendMessage(claim.item.tabId, { type: 'ping' } satisfies ContentMessage).catch(() => undefined);
      if (ping?.build !== __BUILD__) throw new Error('This page is using older extension code. Copy unsaved answers, refresh the application page, then retry.');
      await browser.tabs.update(claim.item.tabId, { autoDiscardable: false });
      await prepare(claim.token, claim.item, snapshot);
      await browser.tabs.sendMessage(claim.item.tabId, { type: 'fill', runId: claim.item.attempt } satisfies ContentMessage);
    } else {
      // The extension page registers the attempt if the worker stops between create and persistence.
      const tab = await browser.tabs.create({ url: openingUrl(claim.item.attempt!), active: false });
      if (tab.id === undefined) throw new Error('Could not create the application tab.');
      try { await queueOpening(claim.item.attempt!, { id: browser.runtime.id, url: openingUrl(claim.item.attempt!), tab }); }
      finally {
        // Cancellation may win while tabs.create is pending. Only remove our exact opening page.
        const fresh = await queuePublic();
        if (!fresh?.items.some(i => i.attempt === claim.item.attempt && i.tabId === tab.id) && (await browser.tabs.get(tab.id).catch(() => undefined))?.url === openingUrl(claim.item.attempt!)) await browser.tabs.remove(tab.id).catch(() => undefined);
      }
    }
  } catch (err) { await fail(claim.item.attempt!, errorText(err)); }
}
/** Claims are atomic; each bounded batch has independent tab/frame/run ownership. */
export async function queuePump() {
  // launchNext claims before browser I/O. Concurrent pump calls cannot claim the same item.
  await Promise.all(Array.from({ length: 5 }, () => launchNext()));
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
  await browser.tabs.update(claimed.item.tabId!, { url: toApplicationUrl(claimed.item.url), autoDiscardable: false });
}
export async function queueWaiting(runId: string, sender: Sender, reason: QueueWaitReason) {
  if (!queueWaitReasons.includes(reason) || (sender.frameId ?? 0) !== 0 || sender.tab?.id === undefined) throw new Error('Invalid waiting page.');
  const q = await queuePublic(), owned = q?.items.find(i => i.attempt === runId && i.tabId === sender.tab!.id);
  if (!q || !owned || !await ownsTab(owned, q.token)) return;
  await mutate(state => {
    const item = state.items.find(i => i.attempt === runId && i.tabId === sender.tab!.id);
    if (state.token !== q.token || !item || !['running', 'paused'].includes(state.status) || !(item.state === 'opening' || item.waitingFor)) return;
    item.resumeUntil ??= Date.now() + QUEUE_WAIT_MS;
    item.state = 'needs-action'; item.waitingFor = reason; item.deadline = undefined;
    item.note = reason === 'navigation' ? 'Return to this job after signing in or clicking Apply. Autofill resumes on the original application.' :
      reason === 'verification' ? 'Complete verification on the website. Autofill resumes when the application opens.' :
      reason === 'account' ? 'Create your account on the website. Autofill resumes when the application opens.' :
      'Sign in on the website. Autofill resumes when the application opens.';
  });
}
export async function queuePending(sender: Sender, commit: boolean) {
  const tabId = sender.tab!.id!, frameId = sender.frameId ?? 0;
  const q = await queuePublic(), owned = q?.items.find(i => i.tabId === tabId);
  if (!q || !owned || !await ownsTab(owned, q.token)) return { fill: false };
  if (!commit) {
    if (!['running', 'paused'].includes(q.status) || !(owned.state === 'opening' || owned.waitingFor) || !owned.attempt || (owned.resumeUntil !== undefined && owned.resumeUntil <= Date.now())) return { fill: false };
    return { fill: true, runId: owned.attempt, queued: true, resumeUntil: owned.resumeUntil };
  }
  const ownedQueueToken = q.token;
  // Read the actual top-level tab as well as the sender. No redirected or unrelated job
  // gets the original run's Profile, even if its page has an ordinary-looking form.
  const top = await browser.tabs.get(tabId);
  return (await mutate(q => {
    const item = q.items.find(i => i.tabId === tabId && (inFlight(i) || !!i.waitingFor));
    if (!item || item.attempt !== owned.attempt || q.token !== ownedQueueToken || !item.attempt || !['running', 'paused'].includes(q.status) || (item.resumeUntil !== undefined && item.resumeUntil <= Date.now())) return { fill: false };
    if (item.state === 'filling') return { fill: false }; // One frame owns the initial fill.
    if (commit && (!queueJobMatches(item, top.url) || !queueJobMatches(item, sender.tab?.url) || (frameId === 0 && !queueJobMatches(item, sender.url)))) return { fill: false };
    if (commit) { clearQueueWait(item); item.note = undefined; item.state = 'filling'; item.frameId = frameId; item.deadline = Date.now() + 300000; }
    return { fill: true, runId: item.attempt, queued: true, resumeUntil: item.resumeUntil };
  })) ?? { fill: false };
}
export async function queueOwns(runId: string, sender: Sender, writing = false) {
  const q = valid(await db.applicationQueue.get('current'));
  const item = q?.items.find(i => i.attempt === runId && i.tabId === sender.tab?.id);
  if (!item) throw new Error('This queue attempt was replaced.');
  if (q?.status === 'stopped' || !['filling', 'review'].includes(item.state) || (item.frameId !== undefined && item.frameId !== (sender.frameId ?? 0)) ||
      (writing && item.state !== 'filling')) throw new Error('This queue fill has finished or was cancelled.');
}
export async function queueStarted(runId: string, sender: Sender, applicationId: number) {
  await mutate(q => {
    const i = q.items.find(i => i.attempt === runId && i.tabId === sender.tab?.id && i.state === 'filling' && i.frameId === (sender.frameId ?? 0));
    if (i && q.status !== 'stopped') i.applicationId = applicationId;
  });
}
export async function queueFinished(runId: string, sender: Sender, applicationId?: number, note?: string) {
  const item = await mutate(q => {
    const i = q.items.find(i => i.attempt === runId && i.tabId === sender.tab?.id);
    if (!i || !(inFlight(i) || (note && i.waitingFor && (sender.frameId ?? 0) === 0)) || q.status === 'stopped') return;
    if (i.frameId !== undefined && i.frameId !== (sender.frameId ?? 0)) return;
    if (note && i.state === 'filling' && i.frameId === undefined) return;
    i.state = note ? 'needs-action' : 'review'; i.note = note; i.applicationId = applicationId;
    i.deadline = undefined; clearQueueWait(i);
    return structuredClone(i);
  });
  if (item?.tabId !== undefined) await browser.tabs.update(item.tabId, { autoDiscardable: true }).catch(() => undefined);
  if (note && item) await cancel(item);
  await queuePump();
}
async function fail(attempt: string, note: string) {
  const item = await mutate(q => {
    const i = q.items.find(i => i.attempt === attempt);
    if (!i || !(inFlight(i) || i.waitingFor)) return;
    i.state = 'needs-action'; i.note = note; i.deadline = undefined;
    clearQueueWait(i);
    return structuredClone(i);
  });
  if (item) await cancel(item);
  await queuePump();
}
export async function queueControl(action: 'pause' | 'resume' | 'stop' | 'size', size?: number, token?: string) {
  await initialized;
  if (action === 'size') batchSize(size);
  const cancelled = await mutate(q => {
    if (token !== undefined && (q.token !== token || !['running', 'paused'].includes(q.status))) throw new Error('This queue changed. Review the current queue and try again.');
    if (action === 'size') q.batchSize = size!;
    else if (action === 'pause' && q.status === 'running') q.status = 'paused';
    else if (action === 'resume' && q.status === 'paused') q.status = 'running';
    else if (action === 'stop') { q.status = 'stopped'; return q.items.filter(i => inFlight(i) || i.waitingFor).map(i => { i.state = 'needs-action'; i.note = 'Stopped. Your page answers were kept.'; i.deadline = undefined; clearQueueWait(i); return structuredClone(i); }); }
    return [];
  });
  for (const item of cancelled ?? []) await cancel(item);
  if (action === 'stop') await browser.alarms.clear(ALARM);
  else { await browser.alarms.create(ALARM, { periodInMinutes: 0.5 }); await queuePump(); }
}
export async function queueAction(token: string, itemId: string, action: 'open' | 'retry' | 'review' | 'submitted' | 'skip', confirmation?: { runId: string; source: NonNullable<Application['submissionSource']> }) {
  const q = valid(await db.applicationQueue.get('current'));
  if (!q || q.token !== token) throw new Error('This queue changed. Refresh the panel.');
  const current = q.items.find(i => i.id === itemId);
  if (!current) throw new Error('Application no longer in this queue.');
  if (action === 'review') {
    if (current.state === 'review') return;
    if (current.state !== 'filling' || current.tabId === undefined || !current.attempt || !current.applicationId || !await ownsTab(current, token)) throw new Error('Wait until the application form opens, then try again.');
    const ping = await browser.tabs.sendMessage(current.tabId, { type: 'ping' } satisfies ContentMessage);
    if (ping?.build !== __BUILD__) throw new Error('Refresh this application page to load the updated extension.');
    await mutate(state => {
      const item = state.items.find(i => i.id === itemId);
      if (state.token !== token || !item || item.attempt !== current.attempt || item.state !== 'filling' || state.status === 'stopped') throw new Error('This attempt changed. Try again.');
      item.deadline = Date.now() + 30000; item.note = 'Stopping autofill for manual review…';
    });
    try {
      const response = await browser.tabs.sendMessage(current.tabId, { type: 'reviewNow', runId: current.attempt } satisfies ContentMessage, { frameId: current.frameId ?? 0 });
      if (!response?.ok) throw new Error(response?.error ?? 'Could not switch to review. Refresh the page and retry.');
    } catch (err) {
      await mutate(state => {
        const item = state.items.find(i => i.id === itemId);
        if (state.token === token && item && item.attempt === current.attempt && item.state === 'filling') { item.state = 'needs-action'; item.deadline = undefined; item.note = 'Could not stop autofill for review. Refresh the page, then retry.'; }
      });
      throw err;
    }
    await mutate(state => {
      const item = state.items.find(i => i.id === itemId);
      if (state.token === token && item && item.attempt === current.attempt && item.state === 'filling') {
        item.state = 'review'; item.deadline = undefined; item.note = 'Autofill stopped for manual review. Your answers were kept.';
      }
    });
    await browser.tabs.update(current.tabId, { autoDiscardable: true }).catch(() => undefined);
    const tab = await browser.tabs.update(current.tabId, { active: true });
    if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
    return;
  }
  if (action === 'open') {
    if (current.tabId === undefined || !await ownsTab(current, token)) throw new Error('This application tab is no longer available. Retry to open a new queue tab.');
    const tab = await browser.tabs.update(current.tabId, { active: true });
    if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true }); return;
  }
  if (action === 'retry') {
    const old = await mutate(state => {
      if (state.token !== token) throw new Error('This queue changed.');
      const i = state.items.find(i => i.id === itemId)!;
      if (settled(i) || i.batch === 0 || !['running', 'paused'].includes(state.status)) throw new Error('This application cannot be refilled.');
      if (state.mode === 'continuous' && i.tabId === undefined && queueOccupancy(state) >= state.batchSize) throw new Error('All queue slots are in use. Increase the limit or finish an open application, then retry.');
      const previous = structuredClone(i);
      i.state = 'needs-action'; i.deadline = undefined; i.note = 'Stopping the previous attempt…';
      clearQueueWait(i);
      return previous;
    });
    if (!old) return;
    await cancel(old, true);
    await mutate(state => {
      const i = state.items.find(i => i.id === itemId);
      if (state.token !== token || !i || i.attempt !== old.attempt || settled(i) || state.status === 'stopped') return;
      i.state = 'queued'; i.note = undefined; i.attempt = undefined; i.frameId = undefined;
      // An explicit retry also works while the queue is paused, without resuming other jobs.
    });
    const paused = (await queuePublic())?.status === 'paused';
    if (paused) await launchNext(itemId);
    else await queuePump();
    return;
  }
  const item = await mutate(async state => {
    if (state.token !== token) throw new Error('This queue changed.');
    const i = state.items.find(i => i.id === itemId)!;
    if (confirmation && i.attempt !== confirmation.runId) throw new Error('This submission belongs to an older attempt.');
    if (settled(i)) return structuredClone(i); // Double clicks retry closure, never submit twice.
    {
      if (action === 'submitted' && (!['review', 'needs-action'].includes(i.state) || !i.applicationId)) throw new Error('Wait for autofill, then verify successful submission on the website.');
      if (action === 'submitted') {
        const app = await db.applications.get(i.applicationId!);
        if (!app) throw new Error('Application history was removed. Skip this entry instead.');
        if (app.status === 'Filling') throw new Error('Stop autofill for review before confirming submission.');
        if (app.status !== 'Submitted' && app.runId !== i.attempt) throw new Error('This application has a newer fill attempt. Review it before confirming submission.');
        if (app.status !== 'Submitted') await db.applications.update(i.applicationId!, submittedPatch(app, confirmation?.source ?? 'user'));
      }
      if (action === 'skip' && i.applicationId) {
        const app = await db.applications.get(i.applicationId);
        if (app && app.status !== 'Submitted') await db.applications.update(i.applicationId, { status: 'Abandoned' });
      }
      i.state = action === 'submitted' ? 'submitted' : 'skipped'; i.deadline = undefined;
      clearQueueWait(i);
    }
    return structuredClone(i);
  });
  if (!item) return;
  await cancel(item, true);
  let reviewWindow: number | undefined;
  if (item.tabId !== undefined) {
    // Only IDs created and bound by this queue are ever closed.
    const tab = await browser.tabs.get(item.tabId).catch(() => undefined);
    if (tab) {
      if (!await ownsTab(item, token)) throw new Error('This tab is no longer owned by the queue. Close it yourself to preserve other tabs.');
      if (tab.active && tab.windowId !== undefined && (await browser.windows.get(tab.windowId).catch(() => undefined))?.focused) reviewWindow = tab.windowId;
      await browser.tabs.remove(item.tabId).catch(async err => {
        if (await browser.tabs.get(item.tabId!).catch(() => undefined)) throw err;
      });
    }
    await mutate(state => { const i = state.items.find(i => i.id === itemId); if (state.token === token && i && i.tabId === item.tabId) i.tabId = undefined; });
  }
  await queuePump();
  // A foreground completion hands the person to the next owned review tab.
  // Background completions never steal focus from another application/window.
  if (reviewWindow !== undefined) {
    const nextQueue = await queuePublic();
    const available = nextQueue?.token === token ? nextQueue.items.filter(i => !settled(i) && i.tabId !== undefined) : [];
    const next = available.find(i => i.state === 'review') ?? available[0];
    if (next?.tabId !== undefined && await ownsTab(next, token)) {
      const tab = await browser.tabs.get(next.tabId).catch(() => undefined);
      if (tab?.windowId === reviewWindow && (await browser.windows.get(reviewWindow).catch(() => undefined))?.focused) await browser.tabs.update(next.tabId, { active: true }).catch(() => undefined);
    }
  }
  return item.applicationId;
}
export async function queueRemoved(tabId: number) {
  await browser.storage.session.remove(ownershipKey(tabId));
  const item = await mutate(q => {
    const i = q.items.find(i => i.tabId === tabId);
    if (!i) return;
    const copy = structuredClone(i);
    i.tabId = undefined; i.deadline = undefined; clearQueueWait(i);
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
        else { await mutate(state => { const i = state.items.find(i => i.id === item.id)!; i.tabId = undefined; i.deadline = undefined; clearQueueWait(i); if (!settled(i)) { i.state = 'needs-action'; i.note = 'Previous session tab was kept. Retry to open a new queue tab.'; } }); continue; }
      }
      if (settled(item)) { await browser.tabs.remove(item.tabId).catch(() => undefined); await queueRemoved(item.tabId); continue; }
      if (item.waitingFor && item.resumeUntil! <= Date.now()) {
        await fail(item.attempt!, 'Waiting ended after 30 minutes. Finish signing in, return to this application, then retry autofill.'); continue;
      }
      if ((item.state === 'opening' || item.waitingFor) && tab.status === 'complete' && tab.url !== openingUrl(item.attempt!)) {
        if (!queueJobMatches(item, tab.url)) await queueWaiting(item.attempt!, { id: browser.runtime.id, frameId: 0, tab }, 'navigation');
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
    if (inFlight(item) && (item.deadline ?? 0) < Date.now()) {
      const fresh = await queuePublic();
      const live = fresh?.items.find(i => i.attempt === item.attempt);
      if (live && inFlight(live) && (live.deadline ?? 0) < Date.now()) await fail(item.attempt!, 'Autofill timed out. Open the tab, finish sign-in or open the form, then retry.');
    }
  }
  await queuePump();
}
export async function queueBrowserStartup() {
  const previous = await mutate(q => {
    if (q.status === 'running') q.status = 'paused';
    const ids = q.items.map(i => i.attempt).filter((id): id is string => !!id);
    for (const i of q.items) {
      i.tabId = undefined; i.deadline = undefined; clearQueueWait(i);
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
