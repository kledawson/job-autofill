import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

let context: BrowserContext, panel: Page, server: Server, extensionId: string;
const url = 'https://job-boards.greenhouse.io/fictional-controls/jobs/101';
const request = (type: string, data: object = {}) => panel.evaluate(payload => chrome.runtime.sendMessage(payload), { type, ...data });
const rows = (table: string) => panel.evaluate(table => new Promise<any[]>((resolve, reject) => {
  const r = indexedDB.open('job-autofill'); r.onerror = () => reject(r.error); r.onsuccess = () => {
    const db = r.result, tx = db.transaction(table), read = tx.objectStore(table).getAll();
    read.onsuccess = () => resolve(read.result); tx.oncomplete = () => db.close();
  };
}), table);
const fixture = `<!doctype html><title>Job Application for Fictional Engineer at Fictional Controls</title>
<style>body{font:16px system-ui;margin:24px}label{display:block;margin:12px 0}input{padding:8px}#scroll-area{height:300px;overflow:auto;border:1px solid gray}#target-label{display:contents}</style>
<h1>Fictional Engineer</h1><form id="application-form">
<section><h2>Personal information</h2><label>First name<input id="first_name" autocomplete="given-name" required></label><label>Email<input id="email" type="email" required></label><label>Phone<input id="phone" autocomplete="tel"></label><label>Address<input id="home" autocomplete="street-address"></label></section>
<fieldset><legend>Work history</legend><label>Company Phone<input id="company-phone" autocomplete="tel"></label><label>Address<input id="company-address" autocomplete="street-address"></label><label>City<input id="company-city"></label></fieldset>
<div id="attachments"></div><div id="uploader"></div><label>Cover letter<input type="file" id="cover"></label>
<label>Earliest start date<input type="date" id="start"></label>
<div id="scroll-area"><div style="height:900px"></div><label id="target-label">Fictional review reference<input id="reference" required></label><div style="height:400px"></div></div>
<button type="submit">Submit application</button></form>
<script>window.uploads=0;window.submits=0;
function widget(){document.getElementById('uploader').innerHTML='<label>Resume<input type="file" id="resume-'+window.uploads+'" data-field-path="resume-'+window.uploads+'"></label>';
document.querySelector('#uploader input').addEventListener('change',()=>{window.uploads++;document.getElementById('attachments').insertAdjacentHTML('beforeend','<table><tr><td>Fictional_Resume.pdf</td><td><button type="button">Remove</button></td></tr></table>');widget()})}widget();
document.getElementById('reference').addEventListener('focus',()=>{document.getElementById('scroll-area').scrollTop=0});
document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submits++});</script>`;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaf-controls-'));
  const openssl = process.platform === 'win32' ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(p => join(p!, 'Git', 'usr', 'bin', 'openssl.exe')).find(existsSync) ?? 'openssl.exe' : 'openssl';
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=job-boards.greenhouse.io', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(fixture));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const port = (server.address() as AddressInfo).port;
  context = await chromium.launchPersistentContext(join(dir, 'browser'), { channel: 'chromium', headless: true, ignoreHTTPSErrors: true, args: [
    '--disable-extensions-except=' + resolve(import.meta.dirname, '../../apps/extension/dist/chrome-mv3'), '--load-extension=' + resolve(import.meta.dirname, '../../apps/extension/dist/chrome-mv3'),
    '--host-resolver-rules=MAP job-boards.greenhouse.io:443 127.0.0.1:' + port + ', MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--ignore-certificate-errors'] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); extensionId = worker.url().split('/')[2]!;
  panel = await context.newPage(); await panel.goto('chrome-extension://' + extensionId + '/sidepanel.html'); await panel.setViewportSize({ width: 360, height: 900 });
  const base = (await request('getFillContext')).profile;
  await panel.evaluate(async base => {
    await chrome.storage.local.set({ onboardingComplete: true, geminiApiKey: '' });
    await new Promise<void>((resolve, reject) => { const r = indexedDB.open('job-autofill'); r.onsuccess = () => {
      const d = r.result, tx = d.transaction(['profile', 'files'], 'readwrite');
      tx.objectStore('profile').put({ ...base, firstName: 'Taylor', lastName: 'Example', email: 'taylor@fictional.example', phone: '2025550123', address: '100 Fictional Lane', city: 'San Francisco', state: 'CA', country: 'United States', education: [], experience: [], workAuth: { ...base.workAuth, authorizedUS: 'yes', needsSponsorship: 'no', status: 'US Citizen' }, preferences: { ...base.preferences, startDate: 'tomorrow' } });
      tx.objectStore('files').put({ kind: 'resume', name: 'Fictional_Resume.pdf', type: 'application/pdf', blob: new Blob(['%PDF-1.4 synthetic'], { type: 'application/pdf' }), updatedAt: 1 });
      tx.oncomplete = () => { d.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    }; });
  }, base);
  await panel.reload();
});
test.afterAll(async () => { await context?.close(); await new Promise<void>(r => server?.close(() => r())); });

test('upload rerenders, repeat fills, employer facts, nested Show field, Stop fill and compact review work together', async () => {
  expect(await request('startQueue', { urls: [url], batchSize: 1, mode: 'continuous' })).toMatchObject({ ok: true });
  await expect.poll(async () => (await rows('applicationQueue'))[0]?.items[0]?.state, { timeout: 35000 }).toBe('review');
  const page = context.pages().find(p => p.url().startsWith(url))!; await page.bringToFront();
  expect(await page.evaluate(() => (window as any).uploads)).toBe(1);
  await expect(page.locator('#phone')).toHaveValue('2025550123');
  await expect(page.locator('#home')).toHaveValue('100 Fictional Lane');
  for (const id of ['company-phone', 'company-address', 'company-city']) await expect(page.locator('#' + id)).toHaveValue('');
  const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await expect(page.locator('#start')).toHaveValue(tomorrow);
  const q = (await rows('applicationQueue'))[0];
  await request('queueAction', { token: q.token, itemId: q.items[0].id, action: 'retry' });
  await expect.poll(async () => (await rows('applicationQueue'))[0].items[0].state, { timeout: 35000 }).toBe('review');
  expect(await page.evaluate(() => (window as any).uploads)).toBe(1);
  const details = panel.getByRole('button', { name: 'Details & submission' }); await expect(details).toHaveAttribute('aria-expanded', 'false');
  await details.click(); await panel.getByRole('button', { name: 'Hide application details' }).click();
  await panel.reload(); await expect(panel.getByRole('button', { name: 'Details & submission' })).toHaveAttribute('aria-expanded', 'false');
  await panel.getByRole('button', { name: /^Review & remember \(/ }).click();
  const card = panel.getByRole('list', { name: 'Questions to review', exact: true }).getByRole('listitem').filter({ hasText: 'Fictional review reference' });
  await card.getByRole('button', { name: 'Show field', exact: true }).click();
  await expect(page.locator('#reference')).toBeFocused();
  expect(await page.locator('#scroll-area').evaluate(el => el.scrollTop)).toBeGreaterThan(500);
  // Harmless tracking/query changes retain the same job and field tokens.
  await page.evaluate(() => history.replaceState({}, '', location.pathname + '?source=changed#section'));
  await page.locator('#reference').fill('Fictional reusable reference');
  await card.getByRole('button', { name: 'Save this answer' }).click();
  await expect(panel.getByLabel('Your answer')).toHaveValue('Fictional reusable reference');
  await panel.getByRole('button', { name: 'Save & apply' }).click();
  await panel.getByRole('button', { name: 'Stop fill', exact: true }).click();
  await expect(panel.getByText('Autofill stopped. Your answers were kept.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).submits)).toBe(0);
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.evaluate(() => scrollTo(0, 0));
  if (process.env.SCREENSHOTS) {
    mkdirSync(process.env.SCREENSHOTS, { recursive: true });
    await panel.screenshot({ path: join(process.env.SCREENSHOTS, 'compact-fill-controls.png') });
    await page.screenshot({ path: join(process.env.SCREENSHOTS, 'show-field-and-employer-fields.png') });
  }
});

test('Profile exposes Today, Tomorrow and fixed-date choices without overwriting the saved preference on view', async () => {
  const options = await context.newPage(); await options.goto('chrome-extension://' + extensionId + '/options.html#profile');
  const choice = options.getByRole('combobox', { name: 'Earliest start date choice' }); await expect(choice).toHaveValue('tomorrow');
  await choice.selectOption('today'); await options.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect.poll(async () => (await request('getFillContext')).profile.preferences.startDate).toBe('today');
  await choice.selectOption('date'); await expect(options.getByRole('combobox', { name: 'Day', exact: true })).toBeVisible();
  await choice.selectOption('tomorrow'); await options.getByRole('button', { name: 'Save profile', exact: true }).click();
  if (process.env.SCREENSHOTS) await options.locator('section').filter({ has: choice }).screenshot({ path: join(process.env.SCREENSHOTS, 'relative-start-date.png') });
  await options.close();
});

test('an explicit handoff attaches a new application tab, retains the description tab and original link, and survives worker restart', async () => {
  const originalQueue = (await rows('applicationQueue'))[0], original = context.pages().find(p => p.url().startsWith(url))!;
  const destination = url.replace('/101', '/102'), page = await context.newPage(); await page.goto(destination); await page.bringToFront();
  await expect(page.locator('#first_name')).toHaveValue('');
  // Title/company are deliberately identical: no automatic ownership or Profile transfer.
  expect((await rows('applicationQueue'))[0].items[0].tabId).toBe(originalQueue.items[0].tabId);
  const card = panel.locator('[data-queue-item="' + originalQueue.items[0].id + '"]');
  await card.getByRole('button', { name: 'More', exact: true }).click();
  await card.getByRole('button', { name: 'Use this page for this job', exact: true }).click();
  await expect.poll(async () => (await rows('applicationQueue'))[0].items[0].resolvedUrl).toBe(destination);
  await expect.poll(async () => (await rows('applicationQueue'))[0].items[0].state, { timeout: 35000 }).toBe('review');
  await expect(page.locator('#first_name')).toHaveValue('Taylor');
  expect(original.isClosed()).toBe(false); expect((await rows('applicationQueue'))[0].items[0].url).toBe(url);
  const cdp = await context.newCDPSession(panel); await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); await cdp.detach();
  expect((await request('getQueue')).queue.items[0].resolvedUrl).toBe(destination);
  await page.locator('#reference').fill('Fictional redirected reference');
  await panel.getByRole('button', { name: /^Review & remember \(/ }).click();
  const field = panel.getByRole('list', { name: 'Questions to review', exact: true }).getByRole('listitem').filter({ hasText: 'Fictional review reference' });
  await field.getByRole('button', { name: 'Save this answer' }).click();
  await expect(panel.getByLabel('Your answer')).toHaveValue('Fictional redirected reference');
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  if (process.env.SCREENSHOTS) await panel.screenshot({ path: join(process.env.SCREENSHOTS, 'manual-queue-handoff.png') });
});

test('Stop fill also drains standalone conditional writers that start after the initial fill finished', async () => {
  let release!: () => void, asks = 0; const held = new Promise<void>(r => { release = r; });
  await context.route('https://generativelanguage.googleapis.com/**', async route => {
    asks++; await held;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Late fictional draft' }] } }] }) });
  });
  await panel.evaluate(() => chrome.storage.local.set({ geminiApiKey: 'synthetic-e2e-key' }));
  const page = await context.newPage();
  try {
    await page.goto(url.replace('/101', '/103')); await page.bringToFront();
    expect(await request('fillActiveTab')).toMatchObject({ ok: true });
    await expect.poll(async () => (await rows('applications')).find(a => a.url.endsWith('/103'))?.status, { timeout: 35000 }).toBe('Ready for review');
    await page.locator('form').evaluate(form => form.insertAdjacentHTML('beforeend', '<label>Tell us about your proudest accomplishment<textarea id="late-essay" required></textarea></label>'));
    await expect.poll(() => asks).toBe(1);
    await panel.getByRole('button', { name: 'Stop fill', exact: true }).click();
    await expect(panel.getByText('Autofill stopped. Your answers were kept.', { exact: true })).toBeVisible();
    await page.locator('#late-essay').fill('My fictional accomplishment for manual review.');
    await panel.getByRole('button', { name: /^Review & remember \(/ }).click();
    const card = panel.getByRole('list', { name: 'Questions to review', exact: true }).getByRole('listitem').filter({ hasText: 'proudest accomplishment' });
    await card.getByRole('button', { name: 'Save this answer', exact: true }).click();
    await expect(panel.getByLabel('Your answer')).toHaveValue('My fictional accomplishment for manual review.');
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    release(); await expect(page.locator('#late-essay')).toHaveValue('My fictional accomplishment for manual review.');
  } finally {
    release(); await panel.evaluate(() => chrome.storage.local.set({ geminiApiKey: '' }));
    await context.unroute('https://generativelanguage.googleapis.com/**'); await page.close();
  }
});
