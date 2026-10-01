import { browser, type Browser } from 'wxt/browser';
import { db, getProfile } from '@/lib/db';
import { generateJson, generateText, testKey } from '@/lib/gemini';
import { sanitizeDraft, sectionRequest } from '@/lib/resume';
import {
  fileToPayload,
  type BackgroundMessage,
  type BackgroundMessages,
  type ContentMessage,
  type FilePayload,
} from '@/lib/messages';
import { jobKey, toApplicationUrl } from '@/lib/platforms';
import { clampToLimit, renderPrompt } from '@/lib/prompt';
import { getSettings, updateSettings, type PublicSettings } from '@/lib/settings';
import { appendApplication, createTrackingSheet, sheetsConfigured, updateApplication } from '@/lib/sheets';
import { readFieldIssues, type Application, type StoredFile } from '@/lib/types';

type Sender = Browser.runtime.MessageSender;
type Handlers = {
  [K in keyof BackgroundMessages]: (
    req: BackgroundMessages[K]['req'],
    sender: Sender,
  ) => Promise<BackgroundMessages[K]['res']>;
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------------------
// Pending fills: tabs opened from a pasted link. Kept in session storage because
// the service worker can be stopped between opening the tab and the page loading.
// ---------------------------------------------------------------------------

async function pendingTabs(): Promise<number[]> {
  const { pendingFills = [] } = await browser.storage.session.get('pendingFills');
  return pendingFills as number[];
}

async function setPendingTabs(ids: number[]) {
  await browser.storage.session.set({ pendingFills: ids });
}

// ---------------------------------------------------------------------------
// Tracking: badge, notifications, Google Sheets
// ---------------------------------------------------------------------------

async function refreshBadge() {
  const count = await db.applications.where('status').equals('Ready for review').count();
  await browser.action.setBadgeText({ text: count ? String(count) : '' });
  await browser.action.setBadgeBackgroundColor({ color: '#4f46e5' });
}

/** Writes the application to the sheet; failures are recorded, never thrown. */
async function syncSheet(id: number) {
  const { sheetId } = await getSettings();
  const app = await db.applications.get(id);
  if (!sheetId || !app || !sheetsConfigured()) return;
  try {
    if (app.sheetRow) {
      await updateApplication(sheetId, app);
      await db.applications.update(id, { sheetError: undefined });
    } else {
      const sheetRow = await appendApplication(sheetId, app);
      await db.applications.update(id, { sheetRow, sheetError: undefined });
    }
  } catch (err) {
    await db.applications.update(id, { sheetError: errorText(err) });
  }
}

async function notifyReady(app: Application) {
  const missing = app.missingCount
    ? `${app.missingCount} field${app.missingCount > 1 ? 's' : ''} need${app.missingCount > 1 ? '' : 's'} your input.`
    : 'Every field the profile covers is filled.';
  await browser.notifications.create(`app-${app.id}`, {
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icon/128.png'),
    title: `${app.role || 'Application'} at ${app.company || 'company'} is ready for review.`,
    message: `${missing} Review it and submit it yourself.`,
    priority: 1,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function filePayload(kind: StoredFile['kind']): Promise<FilePayload | null> {
  const f = await db.files.get(kind);
  if (!f) return null;
  return fileToPayload(f, await f.blob.arrayBuffer());
}

function stripHtml(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

async function sendToTab(tabId: number, msg: ContentMessage): Promise<unknown> {
  return browser.tabs.sendMessage(tabId, msg);
}

async function activeTab(): Promise<Browser.tabs.Tab | undefined> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

const handlers: Handlers = {
  async getFillContext() {
    const [profile, resume, coverLetter, settings] = await Promise.all([
      getProfile(),
      filePayload('resume'),
      filePayload('coverLetter'),
      getSettings(),
    ]);
    return { profile, resume, coverLetter, hasGeminiKey: !!settings.geminiApiKey };
  },

  async generateAnswer(req) {
    const settings = await getSettings();
    if (!settings.geminiApiKey) return { ok: false, error: 'Add a Gemini API key in settings to generate answers.' };
    try {
      const profile = await getProfile();
      const prompt = renderPrompt(settings.promptTemplate, req, profile);
      const text = await generateText(settings.geminiApiKey, settings.geminiModel, prompt);
      return { ok: true, answer: clampToLimit(text, req.characterLimit) };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  },

  async fillStarted(req, sender) {
    const key = jobKey(req.url);
    const existing = await db.applications.where('jobKey').equals(key).last();
    const patch = { company: req.company, role: req.role, tabId: sender.tab?.id, url: req.url };
    if (existing?.id && existing.status !== 'Submitted') {
      await db.applications.update(existing.id, {
        ...patch,
        status: 'Filling',
        filledCount: 0,
        aiAnswers: 0,
        missingCount: 0,
        missingLabels: [],
        missingFields: [],
      });
      return { applicationId: existing.id };
    }
    const id = await db.applications.add({
      ...patch,
      jobKey: key,
      platform: req.platform,
      status: 'Filling',
      filledAt: Date.now(),
      aiAnswers: 0,
      filledCount: 0,
      missingCount: 0,
      missingLabels: [],
    });
    return { applicationId: id as number };
  },

  async fillFinished(req) {
    const app = await db.applications.get(req.applicationId);
    if (!app?.id) return {};
    const first = app.status === 'Filling';
    await db.applications.update(app.id, {
      company: req.company || app.company,
      role: req.role || app.role,
      filledCount: req.filledCount,
      aiAnswers: req.aiAnswers,
      missingCount: req.missingLabels.length,
      missingLabels: req.missingLabels,
      missingFields: readFieldIssues(req.missingFields).filter(field => req.missingLabels.includes(field.label)),
      ...(first ? { status: 'Ready for review' as const, filledAt: Date.now() } : {}),
    });
    const updated = (await db.applications.get(app.id))!;
    if (first) {
      await notifyReady(updated);
      await refreshBadge();
      await syncSheet(app.id);
    } else if (updated.aiAnswers !== app.aiAnswers && updated.sheetRow) {
      await syncSheet(app.id);
    }
    return {};
  },

  async jobDescription({ platform, org, jobId }) {
    try {
      if (platform === 'lever') {
        const res = await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(org)}/${encodeURIComponent(jobId)}`);
        const job = await res.json();
        const lists = (job.lists ?? []).map((l: any) => `${l.text}\n${stripHtml(l.content ?? '')}`).join('\n');
        return [job.descriptionPlain, lists, job.additionalPlain].filter(Boolean).join('\n').slice(0, 8000);
      }
      const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}`);
      const board = await res.json();
      const job = (board.jobs ?? []).find((j: any) => j.id === jobId);
      return (job?.descriptionPlain ?? '').slice(0, 8000);
    } catch {
      return '';
    }
  },

  async claimPendingFill({ commit }, sender) {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return { fill: false };
    const pending = await pendingTabs();
    if (!pending.includes(tabId)) return { fill: false };
    if (commit) await setPendingTabs(pending.filter((id) => id !== tabId));
    return { fill: true };
  },

  async startFill({ url, force }) {
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      return { ok: false, error: 'That does not look like a link. Paste the full job URL.' };
    }
    const profile = await getProfile();
    if (!profile.firstName || !profile.email) {
      return { ok: false, error: 'Finish your profile first (at least your name and email).' };
    }
    if (!force) {
      const previous = await db.applications.where('jobKey').equals(jobKey(parsed.href)).last();
      if (previous) return { ok: true, duplicate: { filledAt: previous.filledAt, status: previous.status } };
    }
    const tab = await browser.tabs.create({ url: toApplicationUrl(parsed.href), active: true });
    if (tab.id !== undefined) await setPendingTabs([...(await pendingTabs()), tab.id]);
    return { ok: true };
  },

  async fillActiveTab() {
    const tab = await activeTab();
    if (!tab?.id) return { ok: false, error: 'No active tab.' };
    const profile = await getProfile();
    if (!profile.firstName || !profile.email) {
      return { ok: false, error: 'Finish your profile first (at least your name and email).' };
    }
    try {
      await sendToTab(tab.id, { type: 'ping' });
    } catch {
      // Tabs opened before the extension was installed have no content script yet.
      if (!tab.url || !/^https?:\/\//i.test(tab.url)) {
        return { ok: false, error: 'Open a regular web page before using Fill this page.' };
      }
      await browser.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['/content-scripts/content.js'],
      });
      await new Promise((r) => setTimeout(r, 300));
    }
    await sendToTab(tab.id, { type: 'fill' });
    return { ok: true };
  },

  async markSubmitted({ applicationId }) {
    const app = await db.applications.get(applicationId);
    if (!app) return { ok: false, error: 'Application not found.' };
    await db.applications.update(applicationId, { status: 'Submitted', submittedAt: Date.now() });
    await refreshBadge();
    await syncSheet(applicationId);
    return { ok: true };
  },

  async setGeminiKey({ apiKey }) {
    await updateSettings({ geminiApiKey: apiKey.trim() });
    return {};
  },

  async testGemini({ apiKey, model }) {
    const settings = await getSettings();
    const key = (apiKey ?? settings.geminiApiKey).trim();
    if (!key) return { ok: false, error: 'Enter an API key first.' };
    try {
      await testKey(key, model || settings.geminiModel);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  },

  async parseResume({ text, sections }) {
    const settings = await getSettings();
    if (!settings.geminiApiKey) return { ok: false, error: 'Add a Gemini API key first.' };
    const file = await db.files.get('resume');
    if (!file) return { ok: false, error: 'Upload your resume first.' };
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
      return { ok: false, error: 'Reading a resume works with PDF files. Upload a PDF to use it.' };
    }
    try {
      const { prompt, schema } = sectionRequest(sections);
      const input = text?.trim()
        ? { text: text.slice(0, 30000) }
        : { pdfBase64: fileToPayload(file, await file.blob.arrayBuffer()).base64 };
      const raw = await generateJson(settings.geminiApiKey, settings.geminiModel, prompt, input, schema);
      return { ok: true, draft: sanitizeDraft(raw) };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  },

  async connectSheets() {
    if (!sheetsConfigured()) {
      return {
        ok: false,
        error: 'Google sign-in is not set up in this build. Add a Google OAuth client ID (see README) and rebuild.',
      };
    }
    try {
      const settings = await getSettings();
      if (settings.sheetId) return { ok: true, sheetUrl: settings.sheetUrl };
      const sheet = await createTrackingSheet();
      await updateSettings({ sheetId: sheet.id, sheetUrl: sheet.url });
      // Backfill applications filled before the sheet existed.
      for (const app of await db.applications.toArray()) {
        if (app.id && app.status !== 'Filling') await syncSheet(app.id);
      }
      return { ok: true, sheetUrl: sheet.url };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  },

  async getPublicSettings() {
    const { geminiApiKey, ...rest } = await getSettings();
    const settings: PublicSettings = { ...rest, hasGeminiKey: !!geminiApiKey, sheetsAvailable: sheetsConfigured() };
    return settings;
  },

  async deleteAllData() {
    await Promise.all([
      db.profile.clear(),
      db.files.clear(),
      db.savedAnswers.clear(),
      db.fieldMappings.clear(),
      db.applications.clear(),
    ]);
    await browser.storage.local.clear();
    await browser.storage.session.clear();
    await browser.identity.clearAllCachedAuthTokens?.().catch(() => undefined);
    await refreshBadge();
    return {};
  },
};

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
  });

  browser.runtime.onMessage.addListener((msg: BackgroundMessage, sender, sendResponse) => {
    const handler = handlers[msg.type] as ((req: any, sender: Sender) => Promise<unknown>) | undefined;
    if (!handler) return false;
    handler(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: errorText(err) }));
    return true;
  });

  browser.notifications.onClicked.addListener(async (notificationId) => {
    const id = Number(notificationId.replace(/^app-/, ''));
    const app = Number.isFinite(id) ? await db.applications.get(id) : undefined;
    if (app?.tabId === undefined) return;
    try {
      const tab = await browser.tabs.update(app.tabId, { active: true });
      if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
    } catch {
      // The tab was closed.
    }
    browser.notifications.clear(notificationId);
  });

  browser.tabs.onRemoved.addListener(async (tabId) => {
    const pending = await pendingTabs();
    if (pending.includes(tabId)) await setPendingTabs(pending.filter((id) => id !== tabId));
  });

  void refreshBadge();
});
