import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

declare const chrome: any;
const EXTENSION = resolve(import.meta.dirname, '../../apps/extension/dist/chrome-mv3');
const JOB_URL = 'https://job-boards.greenhouse.io/fictional/jobs/4242';
const BATCH_URL = 'https://job-boards.greenhouse.io/fictional/jobs/5151';
const LINKED_URL = 'https://job-boards.greenhouse.io/fictional/jobs/7777';
let context: BrowserContext, server: Server, panel: Page;
const request = (type: string, data: object = {}) => panel.evaluate(payload => chrome.runtime.sendMessage(payload), { type, ...data });
const applications = () => panel.evaluate(() => new Promise<any[]>((resolve, reject) => {
  const r = indexedDB.open('job-autofill'); r.onerror = () => reject(r.error);
  r.onsuccess = () => { const d = r.result, rows = d.transaction('applications').objectStore('applications').getAll(); rows.onsuccess = () => { d.close(); resolve(rows.result); }; };
}));
const findPage = (prefix: string) => context.pages().find(p => p.url().startsWith(prefix));
const appFor = async (url: string) => (await applications()).find(a => a.url.startsWith(url));
const needs = () => panel.getByRole('region', { name: 'Unanswered questions' });
const stat = (label: string) => panel.locator('#current-page-review div.rounded-lg.bg-slate-50').filter({ hasText: label }).locator('p').first();
const pageAt = async (prefix: string) => { await expect.poll(() => !!findPage(prefix), { timeout: 15_000 }).toBe(true); return findPage(prefix)!; };

const JOB = '<!doctype html><title>Fictional application</title><h1>Fictional Engineer</h1><div class="job__description">Build fictional tools with a synthetic team.</div>' +
  '<form id="application-form"><label>First name<input id="first" autocomplete="given-name" required></label><label>Email<input id="email" type="email" required></label>' +
  '<label>Why do you want to work at Fictional Co?<textarea id="essay" required></textarea></label><button type="button">Submit application</button></form>';
const BATCH = '<!doctype html><title>Fictional application</title><h1>Fictional Analyst</h1><div class="job__description">Analyse fictional data for a synthetic team.</div>' +
  '<form id="application-form"><label>First name<input id="first" autocomplete="given-name" required></label><label>Email<input id="email" type="email" required></label>' +
  '<label>Fictional reference code<input id="reference" required></label><label>Fictional favorite color<input id="color"></label>' +
  '<label>Why do you want to work at Fictional Co?<textarea id="why" required></textarea></label>' +
  '<label>Describe a project you are proud of<textarea id="project" required></textarea></label><button type="button">Submit application</button></form>';
// A form page without the description, which links to the posting that has it.
const LINKED = '<!doctype html><title>Fictional application</title><h1>Fictional Designer</h1><a href="/fictional/jobs/7777/details">View job description</a>' +
  '<form id="application-form"><label>First name<input id="first" autocomplete="given-name" required></label><label>Email<input id="email" type="email" required></label>' +
  '<label>Why this design team?<textarea id="team" required></textarea></label></form>';
const POSTING = '<!doctype html><title>Fictional Designer</title><nav>Careers home</nav><div class="job-description">Design synthetic interfaces with a fictional research team.</div>';
// A stand-in chat page: a message box and a Send button that records any submission.
const CHAT = '<!doctype html><title>Fictional chat</title><main><form id="chat"><textarea name="prompt" aria-label="Chat with ChatGPT"></textarea><button type="submit">Send</button></form></main>' +
  '<script>window.__sent = 0; document.querySelector("#chat").addEventListener("submit", e => { e.preventDefault(); window.__sent++; });</script>';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaf-chat-'));
  const openssl = process.platform === 'win32' ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(p => join(p!, 'Git', 'usr', 'bin', 'openssl.exe')).find(existsSync) ?? 'openssl.exe' : 'openssl';
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=job-boards.greenhouse.io', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) =>
    res.writeHead(200, { 'content-type': 'text/html' }).end(req.headers.host === 'chatgpt.com' ? CHAT : req.url?.includes('7777/details') ? POSTING : req.url?.includes('7777') ? LINKED : req.url?.includes('5151') ? BATCH : JOB));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  context = await chromium.launchPersistentContext(join(dir, 'profile'), { channel: 'chromium', headless: true, ignoreHTTPSErrors: true, args: [
    '--disable-extensions-except=' + EXTENSION, '--load-extension=' + EXTENSION,
    '--host-resolver-rules=MAP job-boards.greenhouse.io:443 127.0.0.1:' + port + ', MAP chatgpt.com:443 127.0.0.1:' + port + ', MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--ignore-certificate-errors',
  ] });
  // A Gemini request would mean the chat setting was ignored.
  await context.route('https://generativelanguage.googleapis.com/**', route => route.abort());
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = worker.url().split('/')[2]!;
  panel = await context.newPage(); await panel.goto('chrome-extension://' + extensionId + '/sidepanel.html');
  const base = (await request('getFillContext')).profile;
  await panel.evaluate(async base => {
    await chrome.storage.local.set({ onboardingComplete: true, geminiApiKey: 'fictional-test-key', answerSource: 'chatgpt' });
    await new Promise<void>((resolve, reject) => { const r = indexedDB.open('job-autofill'); r.onsuccess = () => {
      const d = r.result, tx = d.transaction('profile', 'readwrite');
      tx.objectStore('profile').put({ ...base, firstName: 'Taylor', lastName: 'Example', email: 'taylor@fictional.example' });
      tx.oncomplete = () => { d.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    }; });
  }, base);
  await panel.reload(); await panel.setViewportSize({ width: 400, height: 960 });
});
test.afterAll(async () => { await context?.close(); await new Promise<void>(r => server?.close(() => r())); });

test('a free response is drafted in the chosen chat website and pasted back for review', async () => {
  expect(await request('startFill', { url: JOB_URL })).toMatchObject({ ok: true });
  const job = await pageAt(JOB_URL);
  await expect.poll(async () => (await applications()).find(a => a.status === 'Ready for review')?.fieldFeedback?.some((f: any) => f.draft), { timeout: 30_000 }).toBe(true);
  expect(await job.inputValue('#first')).toBe('Taylor');
  // The Gemini key is saved, but free responses wait for the person.
  expect(await job.inputValue('#essay')).toBe('');
  const app = (await applications()).find(a => a.status === 'Ready for review')!;
  const essay = app.fieldFeedback.find((f: any) => f.draft);
  expect(essay).toMatchObject({ label: 'Why do you want to work at Fictional Co?', status: 'missing' });
  expect(essay.reason).toContain('Draft in ChatGPT');

  // The draft action sits under the fill counts, not in Review & Remember.
  await job.bringToFront();
  const drafts = needs();
  await expect(drafts.getByRole('button', { name: 'Draft in ChatGPT' })).toHaveCount(1);
  await expect(drafts.getByRole('button', { name: /Draft all/ })).toHaveCount(0);
  await expect(drafts).toContainText('Why do you want to work at Fictional Co?');
  await expect(panel.getByRole('list', { name: 'Questions to review' }).getByRole('button', { name: /Draft in/ })).toHaveCount(0);
  await expect(stat('Need review')).toHaveText('1');

  // The prompt uses the person's template: the question and the posting, no contact details.
  const started = await request('startChatDraft', { applicationId: app.id, tokens: [essay.token] });
  expect(started.ok).toBe(true);
  expect(started.draft.prompt).toContain('Why do you want to work at Fictional Co?');
  expect(started.draft.prompt).toContain('Build fictional tools with a synthetic team.');
  expect(started.draft.prompt).not.toContain('taylor@fictional.example');
  expect(started.draft.prompt).toContain('Job posting: ' + JOB_URL);
  expect(started.draft.prompt).toContain('Write 3 to 5 sentences');

  // Without the optional site permission, the chat opens and the person pastes the copied prompt.
  expect(await request('openChatDraft', { draftId: started.draft.id })).toEqual({ ok: true, inserting: false });
  const chat = await pageAt('https://chatgpt.com/');
  await chat.waitForLoadState('load');
  await panel.waitForTimeout(500);
  expect(await chat.inputValue('textarea')).toBe('');
  await expect(panel.getByRole('region', { name: 'Draft in ChatGPT' })).toContainText('Paste the prompt in ChatGPT');
  await expect(panel.getByRole('region', { name: 'Draft in ChatGPT' })).toContainText('Why do you want to work at Fictional Co?');

  // The person copies the reply and uses it: the essay is filled as an AI draft to review.
  const card = panel.getByRole('region', { name: 'Draft in ChatGPT' });
  await card.getByLabel('Reply from ChatGPT').fill('**Answer:** I like building fictional tools with careful teams.');
  await card.getByRole('button', { name: 'Use answer' }).click();
  await expect(panel.getByText('Added for review.', { exact: false })).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect.poll(() => job.evaluate(() => document.visibilityState)).toBe('visible');
  expect(await job.inputValue('#essay')).toBe('I like building fictional tools with careful teams.');
  await expect(job.locator('#essay')).toHaveAttribute('data-jaf-state', 'ai');
  await expect.poll(async () => (await applications()).find(a => a.id === app.id)?.fieldFeedback?.find((f: any) => f.token === essay.token)?.status).toBe('review');
  expect(await chat.evaluate(() => (window as any).__sent)).toBe(0);
  // The used draft counts as AI-written, no longer as a question that needs the person.
  await expect(stat('Need review')).toHaveText('0');
  await expect(stat('AI-written')).toHaveText('1');
  await expect(drafts).toHaveCount(0);
  await chat.close();

  // A typed answer is never replaced by a later draft.
  await job.fill('#essay', 'My own words.');
  const again = await request('startChatDraft', { applicationId: app.id, tokens: [essay.token] });
  expect(again.ok).toBe(false);
  expect(await job.inputValue('#essay')).toBe('My own words.');
});

test('Need review lists questions, shows each on the page and drops answered ones', async () => {
  expect(await request('startFill', { url: BATCH_URL })).toMatchObject({ ok: true });
  const job = await pageAt(BATCH_URL);
  await expect.poll(async () => (await appFor(BATCH_URL))?.status, { timeout: 30_000 }).toBe('Ready for review');
  await job.bringToFront();
  // Only required questions are counted; the optional one is listed and outlined in yellow.
  await expect(stat('Need review')).toHaveText('3');
  const rows = needs().getByRole('listitem');
  await expect(rows).toHaveCount(4);
  await expect(needs()).toContainText('3 required, 1 optional');
  await expect(rows.first()).toContainText('Fictional reference code');
  await expect(rows.last()).toContainText('Fictional favorite color');
  await expect(rows.last()).toHaveClass(/bg-yellow-50/);
  await expect(job.locator('#color')).toHaveAttribute('data-jaf-state', 'optional');
  await expect(job.locator('#reference')).toHaveAttribute('data-jaf-state', 'missing');
  // Clicking a question shows it on the application.
  await needs().getByRole('button', { name: /Describe a project you are proud of/ }).click();
  await expect.poll(() => job.evaluate(() => document.activeElement?.id)).toBe('project');
  // Answering it on the page removes it and lowers the count.
  await job.fill('#reference', 'FX-42');
  await expect(stat('Need review')).toHaveText('2', { timeout: 10_000 });
  await expect(needs()).not.toContainText('Fictional reference code');
  await job.fill('#reference', '');
  await expect(stat('Need review')).toHaveText('3', { timeout: 10_000 });
  await job.fill('#reference', 'FX-42');
  await expect(stat('Need review')).toHaveText('2', { timeout: 10_000 });
});

test('several free responses are asked in one prompt and the reply is split into their boxes', async () => {
  const job = await pageAt(BATCH_URL);
  await job.bringToFront();
  const all = needs().getByRole('button', { name: 'Draft all 2 in ChatGPT' });
  await expect(all).toBeVisible();
  const app = (await appFor(BATCH_URL))!;
  const tokens = app.fieldFeedback.filter((f: any) => f.draft).map((f: any) => f.token);
  expect(tokens).toHaveLength(2);
  const started = await request('startChatDraft', { applicationId: app.id, tokens });
  expect(started.ok).toBe(true);
  expect(started.draft.batch).toBe(true);
  expect(started.draft.prompt).toContain('1. Why do you want to work at Fictional Co?');
  expect(started.draft.prompt).toContain('2. Describe a project you are proud of');
  expect(started.draft.prompt).toContain('Analyse fictional data for a synthetic team.');
  expect(started.draft.prompt).toMatch(/Answer 1\n<your answer to question 1>/);
  expect(await request('openChatDraft', { draftId: started.draft.id })).toMatchObject({ ok: true });
  const chat = await pageAt('https://chatgpt.com/');

  const card = panel.getByRole('region', { name: 'Draft in ChatGPT' });
  await expect(card).toContainText('Drafting 2 answers in ChatGPT');
  await card.getByLabel('Whole reply from ChatGPT').fill('Here are your answers.\n\n**Answer 1**\nI admire the fictional mission.\n\n**Answer 2**\nI built a synthetic dashboard.');
  await expect(card.getByLabel('Answer 1: Why do you want to work at Fictional Co?')).toHaveValue('I admire the fictional mission.');
  await expect(card.getByLabel('Answer 2: Describe a project you are proud of')).toHaveValue('I built a synthetic dashboard.');
  // Each box stays editable before use.
  await card.getByLabel('Answer 2: Describe a project you are proud of').fill('I built a synthetic dashboard for a fictional team.');
  await card.getByRole('button', { name: 'Use answers' }).click();
  await expect(panel.getByText('Added 2 answers for review.', { exact: false })).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(await job.inputValue('#why')).toBe('I admire the fictional mission.');
  expect(await job.inputValue('#project')).toBe('I built a synthetic dashboard for a fictional team.');
  expect(await chat.evaluate(() => (window as any).__sent)).toBe(0);
  await job.bringToFront();
  await expect(stat('Need review')).toHaveText('0');
  await expect(stat('AI-written')).toHaveText('2');
  await chat.close();
});

test('refreshing the application hides the fill results until Fill this page is clicked again', async () => {
  const job = await pageAt(BATCH_URL);
  await job.bringToFront();
  await expect(panel.locator('#current-page-review')).toBeVisible();
  await job.reload();
  expect(await job.inputValue('#why')).toBe('');
  await expect.poll(async () => (await appFor(BATCH_URL))?.pageCleared, { timeout: 10_000 }).toBe(true);
  await expect(panel.locator('#current-page-review')).toBeHidden();
  await expect(panel.getByText('Fill an application to review missing questions', { exact: false })).toBeVisible();
  // The history keeps the application; filling again shows fresh results.
  await panel.getByRole('button', { name: 'Fill this page' }).click();
  await expect(panel.locator('#current-page-review')).toBeVisible();
  await expect.poll(async () => { const a = await appFor(BATCH_URL); return a?.status === 'Ready for review' && !a.pageCleared; }, { timeout: 30_000 }).toBe(true);
  await expect(stat('Need review')).toHaveText('3');
});

test('the Free responses menu above Fill this page switches who writes them', async () => {
  const job = await pageAt(BATCH_URL);
  await job.bringToFront();
  const menu = panel.getByLabel('Free responses');
  await expect(menu).toHaveValue('chatgpt');
  // Two free responses: one Draft each plus Draft all.
  await expect(needs().getByRole('button', { name: /Draft/ })).toHaveCount(3);
  await menu.selectOption('none');
  await expect.poll(() => panel.evaluate(async () => (await chrome.storage.local.get('answerSource')).answerSource)).toBe('none');
  await expect(panel.getByText('Free responses are left for you to answer.')).toBeVisible();
  // The list stays, without drafting.
  await expect(needs().getByRole('button', { name: /Draft/ })).toHaveCount(0);
  await expect(needs().getByRole('listitem')).toHaveCount(4);
  await menu.selectOption('gemini-api');
  await expect(panel.getByText('Gemini writes free responses while filling', { exact: false })).toBeVisible();
  await panel.evaluate(() => chrome.storage.local.set({ answerSource: 'chatgpt' }));
  await expect(menu).toHaveValue('chatgpt');
});

test('a posting linked from the form gives the prompt its address and description', async () => {
  expect(await request('startFill', { url: LINKED_URL })).toMatchObject({ ok: true });
  await pageAt(LINKED_URL);
  await expect.poll(async () => (await appFor(LINKED_URL))?.fieldFeedback?.some((f: any) => f.draft), { timeout: 30_000 }).toBe(true);
  const app = (await appFor(LINKED_URL))!;
  const started = await request('startChatDraft', { applicationId: app.id, tokens: app.fieldFeedback.filter((f: any) => f.draft).map((f: any) => f.token) });
  expect(started.ok).toBe(true);
  expect(started.draft.prompt).toContain('Job posting: ' + LINKED_URL + '/details');
  expect(started.draft.prompt).toContain('Design synthetic interfaces with a fictional research team.');
  expect(started.draft.prompt).not.toContain('Careers home');
  await request('cancelChatDraft', { draftId: started.draft.id });
});

