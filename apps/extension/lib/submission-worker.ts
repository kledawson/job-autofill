import { browser, type Browser } from 'wxt/browser';
import { db } from './db';
import { isSubmissionUrl, recentSubmitIntent } from './submission-confirmation';
import { ownsTab, queueAction, queuePublic } from './queue-worker';
import { submittedPatch } from './submission-state';
import type { ContentMessage } from './messages';
import { jobKey } from './platforms';

const key = (tabId: number) => 'submissionTab:' + tabId;
type Sender = Browser.runtime.MessageSender;

/** Session markers prevent restored/recycled tab IDs from authorizing detection or closure. */
export async function bindSubmissionTab(tabId: number, runId: string) {
  await browser.storage.session.set({ [key(tabId)]: runId });
}
export async function forgetSubmissionTab(tabId: number) { await browser.storage.session.remove(key(tabId)); }
async function owner(sender: Sender, runId?: string, intent = true, automatic = true) {
  if (sender.id !== browser.runtime.id || sender.tab?.id === undefined || !sender.url) return;
  const apps = await db.applications.where('tabId').equals(sender.tab.id).toArray();
  const app = apps.find(a => a.runId && (!runId || a.runId === runId) && a.status === 'Ready for review' &&
    (a.frameId ?? 0) === (sender.frameId ?? 0) && isSubmissionUrl(a.url, sender.url!));
  if (!app?.id || !app.runId || (await browser.storage.session.get(key(sender.tab.id)))[key(sender.tab.id)] !== app.runId ||
    (intent && !recentSubmitIntent(app.submitIntentAt))) return;
  const tab = await browser.tabs.get(sender.tab.id).catch(() => undefined);
  if (!tab?.url || !isSubmissionUrl(app.topUrl ?? app.url, tab.url)) return;
  const q = await queuePublic(), item = q?.items.find(i => i.applicationId === app.id && i.attempt === app.runId);
  if (item && (!q || automatic && !q.autoDetectSubmission || !['running', 'paused'].includes(q.status) || item.state !== 'review' ||
    item.tabId !== app.tabId || !await ownsTab(item, q.token))) return;
  return { app, q: item ? q : undefined, item };
}
export async function submissionIntent(runId: string, sender: Sender) {
  const found = await owner(sender, runId, false, false);
  if (!found) return;
  await db.transaction('rw', db.applications, db.applicationQueue, async () => {
    const app = await db.applications.get(found.app.id!);
    if (app?.status !== 'Ready for review' || app.runId !== runId) return;
    const at = Date.now();
    await db.applications.update(app.id!, { submitIntentAt: at, submissionIssue: undefined });
    if (found.q && found.item) {
      const q = await db.applicationQueue.get('current'), item = q?.items.find(i => i.id === found.item!.id);
      if (q?.token === found.q.token && item?.attempt === runId && item.state === 'review') {
        item.submitIntentAt = at; await db.applicationQueue.put(q);
      }
    }
  });
}
export async function submissionContext(sender: Sender) { return (await owner(sender))?.app.runId; }
export async function submissionBlocked(runId: string, sender: Sender) {
  const found = await owner(sender, runId, true, false);
  if (!found) return;
  await db.transaction('rw', db.applications, db.applicationQueue, async () => {
    const app = await db.applications.get(found.app.id!);
    if (app?.status === 'Ready for review' && app.runId === runId) {
      await db.applications.update(app.id!, { submitIntentAt: undefined, submissionIssue: 'validation' });
      const q = await db.applicationQueue.get('current'), item = q?.items.find(i => i.applicationId === app.id && i.attempt === runId);
      if (q && item) { item.submitIntentAt = undefined; await db.applicationQueue.put(q); }
    }
  });
}
export async function submissionConfirmed(runId: string, sender: Sender) {
  const found = await owner(sender, runId);
  if (!found) return;
  // Independently ask the bound frame for evidence; neither a caller URL nor a click is proof.
  const proof = await browser.tabs.sendMessage(found.app.tabId!, { type: 'checkSubmission' } satisfies ContentMessage, { frameId: found.app.frameId ?? 0 });
  const expected = { greenhouse: 'greenhouse-confirmation', lever: 'lever-confirmation', ashby: 'ashby-confirmation' }[found.app.platform as 'greenhouse' | 'lever' | 'ashby'];
  if (!expected || proof?.evidence !== expected || proof.url !== sender.url) return;
  const fresh = await owner(sender, runId);
  if (!fresh) return;
  if (fresh.q && fresh.item) return queueAction(fresh.q.token, fresh.item.id, 'submitted', { runId, source: proof.evidence });
  await db.transaction('rw', db.applications, async () => {
    const app = await db.applications.get(fresh.app.id!);
    if (app?.status === 'Ready for review' && app.runId === runId && recentSubmitIntent(app.submitIntentAt))
      await db.applications.update(app.id!, submittedPatch(app, proof.evidence));
  });
  return fresh.app.id;
}

/** Explicit confirmation also finishes the queue item, even when its form no longer extracts. */
export async function confirmManually(id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid application.');
  const q = await queuePublic(), item = q?.items.find(i => i.applicationId === id && !['skipped'].includes(i.state));
  if (q && item && ['running', 'paused'].includes(q.status)) return queueAction(q.token, item.id, 'submitted');
  await db.transaction('rw', db.applications, async () => {
    const app = await db.applications.get(id);
    if (!app) throw new Error('Application not found.');
    if (app.status !== 'Submitted' && app.status !== 'Ready for review') throw new Error('Finish autofill before confirming submission.');
    await db.applications.update(id, submittedPatch(app, 'user'));
  });
  return id;
}
export async function closeSubmittedTab(id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid application.');
  const app = await db.applications.get(id);
  if (app?.status !== 'Submitted' || app.tabId === undefined || !app.runId) throw new Error('No submitted application tab to close.');
  const tab = await browser.tabs.get(app.tabId).catch(() => undefined);
  if (!tab) return;
  const marker = (await browser.storage.session.get(key(app.tabId)))[key(app.tabId)];
  // Arbitrary later navigation must never authorize closing a user's unrelated work.
  const original = app.topUrl ?? app.url;
  const sameJob = tab.url && new URL(original).origin === new URL(tab.url).origin && jobKey(original) === jobKey(tab.url);
  if (marker !== app.runId || !tab.url || !(sameJob || isSubmissionUrl(original, tab.url))) throw new Error('This tab changed. Close it yourself to keep other work safe.');
  await browser.tabs.remove(app.tabId);
}
