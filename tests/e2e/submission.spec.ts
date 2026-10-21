import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

let context: BrowserContext, panel: Page, server: Server;
const urls = (id: number) => [
  `https://job-boards.greenhouse.io/fictional/jobs/${id}`,
  `https://jobs.lever.co/fictional/${id}/apply`,
  `https://jobs.ashbyhq.com/fictional/${id}/application`,
];
const request = (type: string, data = {}) => panel.evaluate(({ type, data }) => chrome.runtime.sendMessage({ type, ...data }), { type, data });
const rows = (table: string): Promise<any[]> => panel.evaluate(table => new Promise(resolve => {
  const r = indexedDB.open('job-autofill'); r.onsuccess = () => {
    const d = r.result, tx = d.transaction(table), read = tx.objectStore(table).getAll();
    read.onsuccess = () => resolve(read.result); tx.oncomplete = () => d.close();
  };
}), table);
const queue = async () => (await rows('applicationQueue'))[0];
const appFor = async (url: string) => (await rows('applications')).find(a => a.url === url);
const pageFor = (url: string) => context.pages().find(p => p.url() === url)!;
const fixture = `<!doctype html><title>Fictional Company - Fictional Engineer</title><style>body{font:16px system-ui;padding:28px}label{display:block;margin:18px 0 4px}input{padding:8px}</style><h1>Fictional Engineer</h1><form id="application-form"><label for="first_name">First name</label><input id="first_name" autocomplete="given-name" required><label for="email">Email</label><input id="email" type="email" required><label for="reference">Fictional review reference</label><input id="reference" required><button type="submit">Submit application</button></form><script>
window.outcome='redirect';window.submits=0;
document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submits++;document.querySelector('[role=alert]')?.remove();
if(window.outcome==='error'){document.querySelector('form').insertAdjacentHTML('beforeend','<p role="alert">Please correct the fictional reference.</p>');return;}
if(window.outcome==='wait')return;
if(window.outcome==='unknown'){document.body.innerHTML='<h1>Processing your request</h1>';history.pushState({},'',location.pathname+'/unrecognized');return;}
location.href=location.hostname.includes('lever')?location.pathname.replace(/apply$/,'thanks'):location.pathname+'/confirmation';});</script>`;
async function ready(url: string) { await expect.poll(async () => (await appFor(url))?.status, { timeout: 30000 }).toBe('Ready for review'); }
async function shot(name: string) {
  if (!process.env.SCREENSHOTS) return;
  mkdirSync(process.env.SCREENSHOTS, { recursive: true });
  await panel.evaluate(() => window.scrollTo(0, 0));
  await panel.screenshot({ path: join(process.env.SCREENSHOTS, name + '.png'), fullPage: false });
}
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaf-submission-'));
  const openssl = process.platform === 'win32' ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(p => join(p!, 'Git', 'usr', 'bin', 'openssl.exe')).find(existsSync) ?? 'openssl.exe' : 'openssl';
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=fictional.example', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(/\/(confirmation|thanks)$/.test(req.url ?? '') ? '<!doctype html><h1>Application submitted successfully.</h1>' : fixture));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const port = (server.address() as AddressInfo).port;
  process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
  context = await chromium.launchPersistentContext(join(dir, 'browser'), { channel: 'chromium', headless: true, ignoreHTTPSErrors: true, args: [
    '--disable-extensions-except=' + resolve('apps/extension/dist/chrome-mv3'), '--load-extension=' + resolve('apps/extension/dist/chrome-mv3'),
    '--host-resolver-rules=' + ['job-boards.greenhouse.io', 'jobs.lever.co', 'jobs.ashbyhq.com'].map(h => `MAP ${h}:443 127.0.0.1:${port}`).join(', ') + ', MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--ignore-certificate-errors',
  ] });
  await context.route('https://api.lever.co/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await context.route('https://api.ashbyhq.com/**', r => r.fulfill({ contentType: 'application/json', body: '{"jobs":[]}' }));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  panel = await context.newPage(); await panel.goto('chrome-extension://' + worker.url().split('/')[2] + '/sidepanel.html');
  await panel.setViewportSize({ width: 400, height: 1100 });
  const base = (await request('getFillContext')).profile;
  await panel.evaluate(async base => {
    await chrome.storage.local.set({ onboardingComplete: true, geminiApiKey: '' });
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('job-autofill'); r.onsuccess = () => {
        const d = r.result, tx = d.transaction('profile', 'readwrite');
        tx.objectStore('profile').put({ ...base, firstName: 'Taylor', lastName: 'Example', email: 'taylor@fictional.example' });
        tx.oncomplete = () => { d.close(); resolve(); }; tx.onabort = () => reject(tx.error);
      };
    });
  }, base);
});
test.afterAll(async () => { await context?.close(); await new Promise<void>(r => server?.close(() => r())); });

test('standalone supported confirmations retain the tab and persist their source through a redirect', async () => {
  for (const [index, url] of urls(510).entries()) {
    const page = await context.newPage(); await page.goto(url); await page.bringToFront();
    expect(await request('fillActiveTab')).toMatchObject({ ok: true }); await ready(url);
    await page.locator('#reference').fill('Synthetic reference');
    await page.getByRole('button', { name: 'Submit application', exact: true }).click();
    await expect.poll(async () => (await appFor(url))?.status).toBe('Submitted');
    expect((await appFor(url)).submissionSource).toBe(['greenhouse-confirmation', 'lever-confirmation', 'ashby-confirmation'][index]);
    expect(page.isClosed()).toBe(false);
    const details = panel.getByRole('button', { name: 'Details & submission', exact: true });
    if (await details.isVisible()) await details.click();
    await expect(panel.getByText(/^Successful submission detected\./)).toBeVisible();
    await expect(panel.getByRole('region', { name: 'Current page review' }).getByText(/^1 missing$/)).toHaveCount(0);
    await expect.poll(async () => (await appFor(url))?.sheetSyncPending).toBe(false);
    expect((await appFor(url)).sheetError).toBeUndefined();
    await shot('submission-standalone-' + index);
    await panel.getByRole('button', { name: 'Close application tab', exact: true }).click();
    await expect.poll(() => page.isClosed()).toBe(true);
  }
});

test('validation keeps the tab open; an unfamiliar result retains explicit confirmation without requiring extraction', async () => {
  const url = urls(520)[0]!, page = await context.newPage(); await page.goto(url); await page.bringToFront();
  expect(await request('fillActiveTab')).toMatchObject({ ok: true }); await ready(url);
  // A long queue/history must not evict the unfinished active job's fallback action.
  await panel.evaluate(() => new Promise<void>((resolve, reject) => {
    const r = indexedDB.open('job-autofill'); r.onsuccess = () => {
      const d = r.result, tx = d.transaction('applications', 'readwrite');
      for (let n = 0; n < 51; n++) tx.objectStore('applications').add({ url: 'https://fictional.example/history/' + n, jobKey: 'history-' + n, company: 'Fictional History', role: 'Fictional role', platform: 'other', status: 'Abandoned', filledAt: Date.now() + 1000, aiAnswers: 0, filledCount: 0, missingCount: 0, missingLabels: [] });
      tx.oncomplete = () => { d.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  }));
  await page.getByRole('button', { name: 'Submit application', exact: true }).click();
  await expect.poll(async () => (await appFor(url))?.submissionIssue).toBe('validation');
  expect((await appFor(url)).status).toBe('Ready for review'); expect(page.isClosed()).toBe(false);
  await expect(panel.getByText(/Submission needs attention. Fix/)).toBeVisible(); await shot('submission-validation');
  await page.locator('#reference').fill('Synthetic review reference'); await page.evaluate(() => { (window as any).outcome = 'unknown'; });
  await page.getByRole('button', { name: 'Submit application', exact: true }).click();
  expect((await appFor(url)).status).toBe('Ready for review');
  await expect(panel.getByRole('button', { name: 'I submitted this application', exact: true })).toBeVisible();
  const app = await appFor(url);
  expect(await request('markSubmitted', { applicationId: app.id })).toMatchObject({ ok: true });
  const submitted = await appFor(url); expect(submitted.submissionSource).toBe('user');
  expect(await request('markSubmitted', { applicationId: app.id })).toMatchObject({ ok: true });
  expect((await appFor(url)).submittedAt).toBe(submitted.submittedAt);
  expect(await request('closeSubmittedTab', { applicationId: app.id })).toMatchObject({ ok: false });
  expect(page.isClosed()).toBe(false); await shot('submission-manual-fallback'); await page.close();
});

test('no intent, forged extension-page messages and stale attempt results cannot confirm a submission', async () => {
  const url = urls(530)[1]!, page = await context.newPage(); await page.goto(url); await page.bringToFront();
  await request('fillActiveTab'); await ready(url); const app = await appFor(url);
  await page.evaluate(() => { document.body.innerHTML = '<h1>Application submitted successfully.</h1>'; });
  await expect(page.getByRole('heading')).toHaveText('Application submitted successfully.');
  expect(await request('submissionConfirmed', { runId: app.runId })).toMatchObject({ ok: false });
  await panel.evaluate(async tabId => { await chrome.scripting.executeScript({ target: { tabId }, func: () => chrome.runtime.sendMessage({ type: 'submissionConfirmed', runId: crypto.randomUUID() }) }); }, app.tabId);
  expect((await appFor(url)).status).toBe('Ready for review'); expect(page.isClosed()).toBe(false); await page.close();
});

test('queue background success preserves focus; foreground success hands off once, while Sheets retries stay independent', async () => {
  const list = [urls(540)[1]!, urls(541)[2]!, urls(542)[0]!];
  let sheetRows: string[][] = [], writes = 0;
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(() => {
    chrome.runtime.getManifest = () => ({ oauth2: { client_id: 'synthetic-client.apps.googleusercontent.com' } }) as any;
    chrome.identity.getAuthToken = async () => ({ token: 'synthetic-token' });
  });
  await panel.evaluate(() => chrome.storage.local.set({ sheetId: 'fictional', sheetTabId: 42, sheetUrl: 'https://docs.google.com/spreadsheets/d/fictional/edit#gid=42' }));
  await context.route('https://sheets.googleapis.com/**', async route => {
    const req = route.request();
    if (req.method() === 'POST') {
      writes++;
      const data = req.postDataJSON().data;
      for (const entry of data) {
        const [, col, row] = /!([A-Z]+)(\d+)/.exec(entry.range)!;
        const index = col!.charCodeAt(0) - 65, at = Number(row) - 2;
        sheetRows[at] ??= []; sheetRows[at]![index] = entry.values[0][0];
      }
      // Google accepted the first row, but its response never reached the extension.
      if (writes === 1) { await route.abort(); return; }
      await route.fulfill({ contentType: 'application/json', body: '{}' }); return;
    }
    const body = !req.url().includes('/values/') ? { spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/fictional/edit', sheets: [{ properties: { sheetId: 42, title: 'Applications' } }] } :
      req.url().includes('A1:AZ10') ? { values: [['Company', 'Position', 'Posting URL']] } : { values: sheetRows };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  expect(await request('startQueue', { urls: list, batchSize: 2, mode: 'continuous', autoDetectSubmission: true })).toMatchObject({ ok: true });
  for (const url of list.slice(0, 2)) await ready(url);
  const first = pageFor(list[0]!), second = pageFor(list[1]!);
  await first.bringToFront(); const firstId = (await queue()).items[0].tabId;
  // Trusted click in a background page does not activate it in Playwright.
  await second.locator('#reference').fill('Synthetic second reference'); await second.getByRole('button', { name: 'Submit application' }).click();
  await expect.poll(async () => (await appFor(list[1]!)).status).toBe('Submitted');
  expect(second.isClosed()).toBe(false); expect((await queue()).items[2].state).toBe('queued');
  await request('markSubmitted', { applicationId: (await appFor(list[1]!)).id });
  await expect.poll(() => second.isClosed()).toBe(true); await ready(list[2]!);
  expect(await panel.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id)).toBe(firstId);
  await expect.poll(async () => !!(await appFor(list[1]!)).sheetError).toBe(true);
  expect((await queue()).items[1].state).toBe('submitted');
  await first.locator('#reference').fill('Synthetic first reference'); await first.getByRole('button', { name: 'Submit application' }).click();
  await expect.poll(async () => (await appFor(list[0]!)).status).toBe('Submitted'); expect(first.isClosed()).toBe(false);
  await request('markSubmitted', { applicationId: (await appFor(list[0]!)).id });
  await expect.poll(() => first.isClosed()).toBe(true);
  const thirdId = (await queue()).items[2].tabId;
  await expect.poll(() => panel.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id)).toBe(thirdId);
  await expect.poll(async () => (await appFor(list[0]!)).sheetRow).toBe(3);
  const failed = await appFor(list[1]!);
  expect(await request('retrySheet', { applicationId: failed.id })).toMatchObject({ ok: true });
  await expect.poll(async () => (await appFor(list[1]!)).sheetRow).toBe(2);
  expect(writes).toBe(2); expect(sheetRows).toHaveLength(2);
  const q = await queue(); await request('controlQueue', { token: q.token, action: 'pause' });
  const third = pageFor(list[2]!); await third.locator('#reference').fill('Synthetic third reference');
  await third.getByRole('button', { name: 'Submit application' }).click();
  await expect.poll(async () => (await appFor(list[2]!)).status).toBe('Submitted'); expect(third.isClosed()).toBe(false);
  const app = await appFor(list[2]!); await request('markSubmitted', { applicationId: app.id });
  await expect.poll(() => third.isClosed()).toBe(true);
  await expect.poll(async () => (await appFor(list[2]!)).sheetRow).toBe(4);
  expect((await rows('applications')).filter(a => list.includes(a.url) && a.status === 'Submitted')).toHaveLength(3);
  expect(sheetRows).toHaveLength(3); await shot('submission-queue-tracking');
});

test('simultaneous confirmations serialize sheet row selection and duplicate clicks preserve one record', async () => {
  await context.unroute('https://sheets.googleapis.com/**');
  let sheetRows: string[][] = [], writes = 0, readsBeforeRelease = 0;
  let release!: () => void; const held = new Promise<void>(r => { release = r; }); let holding = true;
  await context.route('https://sheets.googleapis.com/**', async route => {
    const req = route.request();
    if (req.method() === 'POST') {
      writes++;
      for (const entry of req.postDataJSON().data) {
        const [, col, row] = /!([A-Z]+)(\d+)/.exec(entry.range)!;
        const at = Number(row) - 2; sheetRows[at] ??= []; sheetRows[at]![col!.charCodeAt(0) - 65] = entry.values[0][0];
      }
      await route.fulfill({ contentType: 'application/json', body: '{}' }); return;
    }
    if (!req.url().includes('/values/') && holding) { readsBeforeRelease++; await held; }
    const body = !req.url().includes('/values/') ? { spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/fictional/edit', sheets: [{ properties: { sheetId: 42, title: 'Applications' } }] } :
      req.url().includes('A1:AZ10') ? { values: [['Company', 'Position', 'Posting URL']] } : { values: sheetRows };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  const list = [urls(560)[0]!, urls(561)[1]!], pages: Page[] = [];
  for (const url of list) {
    const page = await context.newPage(); pages.push(page); await page.goto(url); await page.bringToFront();
    expect(await request('fillActiveTab')).toMatchObject({ ok: true }); await ready(url);
  }
  const apps = await Promise.all(list.map(appFor));
  try {
    const results = await Promise.all([request('markSubmitted', { applicationId: apps[0].id }), request('markSubmitted', { applicationId: apps[1].id }), request('markSubmitted', { applicationId: apps[0].id })]);
    expect(results.every(r => r.ok)).toBe(true);
    await expect.poll(() => readsBeforeRelease).toBe(1);
    expect(writes).toBe(0);
    holding = false; release();
    for (const url of list) await expect.poll(async () => (await appFor(url)).sheetSyncPending).toBe(false);
    expect(writes).toBe(2); expect(sheetRows).toHaveLength(2);
    expect(new Set(sheetRows.map(row => row[2])).size).toBe(2);
    expect((await rows('applications')).filter(a => list.includes(a.url))).toHaveLength(2);
  } finally { holding = false; release(); for (const page of pages) if (!page.isClosed()) await page.close(); }
});
