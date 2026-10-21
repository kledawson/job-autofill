import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

declare const chrome: any;
let context: BrowserContext, server: Server, panel: Page;
const url = (id: string) => 'https://job-boards.greenhouse.io/fictional/jobs/' + id;
const request = async (type: string, data: object = {}) => {
  if (type === 'controlQueue' && !('token' in data)) {
    const result = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'getQueue' }));
    data = { ...data, token: result.queue?.token };
  }
  return panel.evaluate(payload => chrome.runtime.sendMessage(payload), { type, ...data });
};
const queue = async () => (await request('getQueue')).queue;
const action = async (index: number, action: string) => { const q = await queue(); return request('queueAction', { token: q.token, itemId: q.items[index].id, action }); };
const form = '<h1>Fictional Engineer</h1><form id="application-form"><label>First name<input id="first" autocomplete="given-name" required></label><label>Email<input id="email" type="email" required></label><button type="button">Submit application</button></form>';
const login = '<h1>Sign in</h1><form id="auth"><label>Email<input id="login-email" type="email"></label><label>Password<input id="password" type="password"></label><button type="button" id="continue">Continue to application</button></form>';
// Playwright can report a newly opened tab's URL a moment after the queue already sees the page.
const findPage = (id: string) => context.pages().find(p => p.url().startsWith(url(id)));
const page = async (id: string) => { await expect.poll(() => !!findPage(id)).toBe(true); return findPage(id)!; };

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaf-login-'));
  const openssl = process.platform === 'win32' ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(p => join(p!, 'Git', 'usr', 'bin', 'openssl.exe')).find(existsSync) ?? 'openssl.exe' : 'openssl';
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=job-boards.greenhouse.io', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
    const ready = req.url?.includes('ready=1') || req.url?.includes('normal') || req.url?.includes('unrelated');
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Fictional application</title><style>body{font:18px system-ui;padding:32px}label{display:block;margin:20px 0}input{display:block;padding:8px}</style>' + (ready ? form : login + '<script>document.querySelector("#continue").onclick=()=>{document.body.innerHTML=' + JSON.stringify(form) + '}</script>'));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  context = await chromium.launchPersistentContext(join(dir, 'profile'), { channel: 'chromium', headless: true, ignoreHTTPSErrors: true, args: [
    '--disable-extensions-except=' + resolve(import.meta.dirname, '../../apps/extension/dist/chrome-mv3'),
    '--load-extension=' + resolve(import.meta.dirname, '../../apps/extension/dist/chrome-mv3'),
    '--host-resolver-rules=MAP job-boards.greenhouse.io:443 127.0.0.1:' + port + ', MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--ignore-certificate-errors',
  ] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  panel = await context.newPage(); await panel.goto('chrome-extension://' + worker.url().split('/')[2] + '/sidepanel.html');
  const base = (await request('getFillContext')).profile;
  await panel.evaluate(async base => {
    await chrome.storage.local.set({ onboardingComplete: true, geminiApiKey: '' });
    await new Promise<void>((resolve, reject) => { const r = indexedDB.open('job-autofill'); r.onsuccess = () => {
      const d = r.result, tx = d.transaction('profile', 'readwrite');
      tx.objectStore('profile').put({ ...base, firstName: 'Taylor', lastName: 'Example', email: 'taylor@fictional.example' });
      tx.oncomplete = () => { d.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    }; });
  }, base);
  await panel.reload(); await panel.setViewportSize({ width: 400, height: 960 });
});
test.afterAll(async () => { await context?.close(); await new Promise<void>(r => server?.close(() => r())); });
test.afterEach(async () => {
  await request('controlQueue', { action: 'stop' });
  for (const p of context.pages()) if (p !== panel && /job-boards|opening.html/.test(p.url())) await p.close();
});

test('queue shows sign-in, fills other jobs, and resumes a same-document application once', async () => {
  expect((await request('startQueue', { urls: [url('login-spa'), url('normal-one')], batchSize: 2, mode: 'continuous' })).ok).toBe(true);
  await expect.poll(async () => (await queue()).items[0].waitingFor).toBe('login');
  await expect.poll(async () => (await queue()).items[1].state, { timeout: 30000 }).toBe('review');
  const app = await page('login-spa');
  await expect(app.locator('#login-email')).toHaveValue(''); await expect(app.locator('#password')).toHaveValue('');
  await expect((await page('normal-one')).locator('#first')).toHaveValue('Taylor');
  await action(0, 'open');
  await expect(panel.getByRole('button', { name: 'Open to sign in', exact: true })).toBeVisible();
  if (process.env.SCREENSHOTS) { mkdirSync(process.env.SCREENSHOTS, { recursive: true }); await panel.screenshot({ path: join(process.env.SCREENSHOTS, 'login-required.png'), fullPage: true }); }
  await app.getByRole('button', { name: 'Continue to application' }).click();
  await expect.poll(async () => (await queue()).items[0].state, { timeout: 30000 }).toBe('review');
  await expect(app.locator('#first')).toHaveValue('Taylor');
  expect((await queue()).items[0].waitingFor).toBeUndefined();
  const count = await panel.evaluate(() => new Promise<number>(resolve => { const r = indexedDB.open('job-autofill'); r.onsuccess = () => { const d = r.result, tx = d.transaction('applications'), count = tx.objectStore('applications').count(); count.onsuccess = () => resolve(count.result); tx.oncomplete = () => d.close(); }; }));
  expect(count).toBe(2);
});

test('worker restart and full navigation preserve waiting ownership without filling another job', async () => {
  await request('startQueue', { urls: [url('login-navigation')], batchSize: 1, mode: 'continuous' });
  await expect.poll(async () => (await queue()).items[0].waitingFor).toBe('login');
  const app = await page('login-navigation'), attempt = (await queue()).items[0].attempt;
  const cdp = await context.newCDPSession(panel); await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); await cdp.detach();
  expect((await queue()).items[0].attempt).toBe(attempt);
  await app.goto(url('unrelated-job'));
  await expect(app.locator('#first')).toHaveValue('');
  await expect.poll(async () => (await queue()).items[0].waitingFor).toBe('navigation');
  await expect(app.locator('#first')).toHaveValue('');
  await app.goto(url('login-navigation') + '?ready=1');
  await expect.poll(async () => (await queue()).items[0].state, { timeout: 30000 }).toBe('review');
  await expect(app.locator('#first')).toHaveValue('Taylor'); expect((await queue()).items[0].attempt).toBe(attempt);
});

test('standalone login leaves credentials untouched and offers a fresh Fill after login', async () => {
  const app = await context.newPage(); await app.goto(url('standalone-login')); await app.bringToFront();
  expect((await request('fillActiveTab', { presetId: 'default' })).ok).toBe(true);
  await expect.poll(async () => await panel.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return (await chrome.storage.session.get('pageStatus:' + tab.id))['pageStatus:' + tab.id]?.title;
  })).toBe('Sign in required');
  await expect(app.locator('#login-email')).toHaveValue(''); await expect(app.locator('#password')).toHaveValue('');
  await app.getByRole('button', { name: 'Continue to application' }).click();
  await expect.poll(async () => await panel.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return (await chrome.storage.session.get('pageStatus:' + tab.id))['pageStatus:' + tab.id]?.title;
  })).toBe('Application ready');
  await expect(app.locator('#first')).toHaveValue('');
  expect((await request('fillActiveTab', { presetId: 'default' })).ok).toBe(true);
  await expect(app.locator('#first')).toHaveValue('Taylor');
});

test('stopping the queue cancels a waiting login and prevents a later automatic fill', async () => {
  await request('startQueue', { urls: [url('login-stop')], batchSize: 1, mode: 'continuous' });
  await expect.poll(async () => (await queue()).items[0].waitingFor).toBe('login');
  const app = await page('login-stop'); await request('controlQueue', { action: 'stop' });
  expect((await queue()).items[0].waitingFor).toBeUndefined();
  await app.getByRole('button', { name: 'Continue to application' }).click();
  await app.waitForTimeout(1800); await expect(app.locator('#first')).toHaveValue('');
  expect((await queue()).status).toBe('stopped');
});

test('skipping a waiting job closes only its owned tab and opens the next queued job', async () => {
  await request('startQueue', { urls: [url('login-skip'), url('normal-next')], batchSize: 1, mode: 'continuous' });
  await expect.poll(async () => (await queue()).items[0].waitingFor).toBe('login');
  const app = await page('login-skip'); expect((await action(0, 'skip')).ok).toBe(true);
  await expect.poll(() => app.isClosed()).toBe(true);
  await expect.poll(async () => (await queue()).items[1].state, { timeout: 30000 }).toBe('review');
  await expect((await page('normal-next')).locator('#first')).toHaveValue('Taylor');
});

test('account creation and verification stay manual before queue autofill resumes', async () => {
  await request('startQueue', { urls: [url('login-verify')], batchSize: 1, mode: 'continuous' });
  await expect.poll(async () => (await queue()).items[0].waitingFor).toBe('login');
  const app = await page('login-verify');
  await app.evaluate(() => { document.body.innerHTML = '<h1>Create an account</h1><form><label>First name<input id="account-first"></label><label>Email<input type="email" id="account-email"></label><input type="password" autocomplete="new-password">' + '<input>'.repeat(5) + '</form>'; });
  await expect.poll(async () => (await queue()).items[0].waitingFor).toBe('account');
  await expect(app.locator('#account-first')).toHaveValue(''); await expect(app.locator('#account-email')).toHaveValue('');
  await app.evaluate(() => { document.body.innerHTML = '<h1>Verify your email</h1><form><label>Code<input id="code" autocomplete="one-time-code"></label></form>'; });
  await expect.poll(async () => (await queue()).items[0].waitingFor).toBe('verification');
  await expect(app.locator('#code')).toHaveValue('');
  await app.evaluate(html => { document.body.innerHTML = html; }, form);
  await expect.poll(async () => (await queue()).items[0].state, { timeout: 30000 }).toBe('review');
  await expect(app.locator('#first')).toHaveValue('Taylor');
});

test('persisted wait deadline expires after worker recovery and leaves a recoverable job', async () => {
  await request('startQueue', { urls: [url('login-expired')], batchSize: 1, mode: 'continuous' });
  await expect.poll(async () => (await queue()).items[0].waitingFor).toBe('login');
  await panel.evaluate(() => new Promise<void>(resolve => {
    const r = indexedDB.open('job-autofill'); r.onsuccess = () => {
      const d = r.result, tx = d.transaction('applicationQueue', 'readwrite'), store = tx.objectStore('applicationQueue'), record = store.get('current');
      record.onsuccess = () => { const q = record.result; q.items[0].resumeUntil = Date.now() - 1000; store.put(q); };
      tx.oncomplete = () => { d.close(); resolve(); };
    };
  }));
  const cdp = await context.newCDPSession(panel); await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); await cdp.detach();
  await request('getQueue');
  await expect.poll(async () => (await queue()).items[0].waitingFor).toBeUndefined();
  expect((await queue()).items[0].note).toContain('30 minutes');
  await expect(panel.getByRole('button', { name: 'Retry autofill', exact: true })).toBeVisible();
  const app = await page('login-expired'); await app.getByRole('button', { name: 'Continue to application' }).click();
  await app.waitForTimeout(1200); await expect(app.locator('#first')).toHaveValue('');
});
