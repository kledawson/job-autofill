import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

declare const chrome: any;
const EXTENSION = resolve(import.meta.dirname, '../../apps/extension/dist/chrome-mv3');
const URL = 'https://jobs.lever.co/contoso/preset-proof/apply';
let context: BrowserContext, server: Server, page: Page, extensionId: string;
let softwareId: string, hardwareId: string;
const prompts: string[] = [];
const request = (type: string, data: object = {}) => page.evaluate(payload => chrome.runtime.sendMessage(payload), { type, ...data });
const readRows = (storeName: string) => page.evaluate(storeName => new Promise<any[]>((resolve, reject) => {
  const req = indexedDB.open('job-autofill'); req.onerror = () => reject(req.error);
  req.onsuccess = () => { const d = req.result, tx = d.transaction(storeName), rows = tx.objectStore(storeName).getAll();
    rows.onsuccess = () => resolve(rows.result); rows.onerror = () => reject(rows.error); tx.oncomplete = () => d.close(); };
}), storeName);
const putRow = (storeName: string, row: any) => page.evaluate(({ storeName, row }) => new Promise<void>((resolve, reject) => {
  const req = indexedDB.open('job-autofill'); req.onerror = () => reject(req.error);
  req.onsuccess = () => { const d = req.result, tx = d.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(row);
    tx.oncomplete = () => { d.close(); resolve(); }; tx.onabort = () => reject(tx.error); };
}), { storeName, row });
const screenshot = async (target: Page, name: string) => {
  if (!process.env.SCREENSHOTS) return;
  mkdirSync(process.env.SCREENSHOTS, { recursive: true });
  await target.screenshot({ path: join(process.env.SCREENSHOTS, name + '.png'), fullPage: true });
};
const presetRow = (name: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fictional preset document') });
const editor = () => page.getByRole('region', { name: 'Edit application preset' });

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaf-presets-e2e-'));
  const openssl = process.platform === 'win32'
    ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(p => join(p!, 'Git', 'usr', 'bin', 'openssl.exe')).find(existsSync) ?? 'openssl.exe'
    : 'openssl';
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=jobs.lever.co', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(
    '<!doctype html><title>Contoso application</title><style>body{font:17px system-ui;padding:32px;max-width:740px}label{display:block;margin:18px 0 7px}input,select,textarea{font:inherit;padding:10px;width:95%}textarea{height:100px}</style><h1>Fictional Engineer</h1><h2>Contoso</h2><form><label for="first">First name</label><input id="first" autocomplete="given-name" required><label for="email">Email</label><input id="email" type="email" required><label for="portfolio">Portfolio</label><input id="portfolio"><label for="resume">Resume</label><input id="resume" type="file" required><label for="essay">Describe your proudest accomplishment</label><textarea id="essay" required></textarea><label for="auth">Are you legally authorized to work in the United States?</label><select id="auth" required><option value="">Select...</option><option>Yes</option><option>No</option></select><label for="commute">Can you commute to Cupertino?</label><select id="commute" required><option value="">Select...</option><option>Yes</option><option>No</option></select><button type="submit">Submit application</button></form>'
  ));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, ignoreHTTPSErrors: true,
    args: ['--disable-extensions-except=' + EXTENSION, '--load-extension=' + EXTENSION, '--host-resolver-rules=MAP jobs.lever.co:443 127.0.0.1:' + port + ', MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--ignore-certificate-errors'] });
  await context.route('https://api.lever.co/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ descriptionPlain: 'A fictional role for a synthetic applicant.', lists: [] }) }));
  await context.route('https://generativelanguage.googleapis.com/**', route => {
    const body = route.request().postDataJSON(), prompt = body?.contents?.[0]?.parts?.[0]?.text ?? '';
    prompts.push(prompt);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'A fictional answer using my original software focus.' }] } }] }) });
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = worker.url().split('/')[2]!;
  page = await context.newPage(); page.on('pageerror', error => console.error('Preset UI error:', error.message)); await page.goto('chrome-extension://' + extensionId + '/options.html#presets');
  const profile = (await request('getFillContext')).profile;
  await putRow('profile', { ...profile, firstName: 'Taylor', lastName: 'Example', email: 'taylor@fictional.example', portfolio: 'https://example.com/shared', workAuth: { ...profile.workAuth, authorizedUS: 'yes', needsSponsorship: 'no' } });
  await putRow('rememberedMappings', { id: 51, schemaVersion: 3, updatedAt: 1, question: 'Can you commute to Cupertino?', aliases: [], scope: 'all', target: { kind: 'answer', value: 'Yes' } });
  await page.evaluate(async () => { await chrome.storage.local.set({ onboardingComplete: true }); });
  await page.reload();
});
test.afterAll(async () => { await context?.close(); await new Promise<void>(r => server?.close(() => r())); });

test('creates and duplicates easy-to-select presets without changing the shared profile or Memories', async () => {
  const original = (await request('getFillContext')).profile, memories = await readRows('rememberedMappings');
  await expect(presetRow('Default')).toContainText('Selected for next fill');
  await page.getByRole('button', { name: 'Create preset', exact: true }).click();
  await page.getByLabel(/^Preset name/).fill('Software Engineer');
  await page.getByLabel('Upload resume for this preset', { exact: true }).setInputFiles(pdf('Taylor_Software.pdf'));
  await page.getByLabel('AI writing focus', { exact: true }).fill('Original software focus: emphasize verified software projects.');
  await page.getByRole('button', { name: 'Add prepared response', exact: true }).click();
  await page.getByLabel('Application question', { exact: true }).fill('Tell us about your proudest accomplishment');
  await page.getByLabel('Your prepared answer', { exact: true }).fill('I built a fictional billing dashboard.');
  await page.getByText('Use this answer for another wording', { exact: true }).click();
  await page.getByRole('button', { name: 'Add another wording', exact: true }).click();
  await page.getByLabel('Alternate wording 1 for response 1', { exact: true }).fill('Describe your proudest accomplishment');
  await page.getByRole('checkbox', { name: 'Use my Profile portfolio link', exact: true }).uncheck();
  await page.getByLabel('Portfolio link', { exact: true }).fill('https://example.com/software');
  await screenshot(page, 'preset-editor');
  await page.getByRole('button', { name: 'Save and use preset', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Software Engineer saved and selected');
  await expect(presetRow('Software Engineer')).toContainText('Taylor_Software.pdf');
  softwareId = (await readRows('presets')).find(p => p.name === 'Software Engineer').id;
  await presetRow('Software Engineer').getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.getByLabel(/^Preset name/)).toHaveValue('Software Engineer copy');
  await page.getByLabel(/^Preset name/).fill('Hardware Engineer');
  await page.getByLabel('Upload resume for this preset', { exact: true }).setInputFiles(pdf('Taylor_Hardware.pdf'));
  await page.getByLabel('AI writing focus', { exact: true }).fill('Hardware focus: emphasize verified robotics work.');
  await page.getByLabel('Your prepared answer', { exact: true }).fill('I built a fictional robotics prototype.');
  await page.getByLabel('Portfolio link', { exact: true }).fill('https://example.com/hardware');
  await page.getByRole('button', { name: 'Save and use preset', exact: true }).click();
  await expect(presetRow('Hardware Engineer')).toContainText('Selected for next fill');
  hardwareId = (await readRows('presets')).find(p => p.name === 'Hardware Engineer').id;
  await expect(presetRow('Software Engineer').getByRole('button', { name: 'Use preset', exact: true })).toBeEnabled();
  await screenshot(page, 'preset-library');
  const storedProfile = (await readRows('profile'))[0];
  expect(storedProfile).toEqual(original);
  expect(await readRows('rememberedMappings')).toEqual(memories);
  expect((await readRows('presetFiles')).map(f => f.name).sort()).toEqual(['Taylor_Hardware.pdf', 'Taylor_Software.pdf']);
  const sidebar = await context.newPage(); await sidebar.goto('chrome-extension://' + extensionId + '/sidepanel.html');
  await sidebar.setViewportSize({ width: 380, height: 920 });
  await expect(sidebar.locator('#sidebar-fill').getByRole('combobox', { name: 'Application Preset', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('combobox', { name: 'Application Preset', exact: true })).toHaveValue(hardwareId);
  await expect(sidebar.getByRole('region', { name: 'Application preset' })).toContainText('Taylor_Hardware.pdf');
  await sidebar.getByRole('combobox', { name: 'Application Preset', exact: true }).selectOption(softwareId);
  await expect(sidebar.getByRole('region', { name: 'Application preset' })).toContainText('Taylor_Software.pdf');
  await screenshot(sidebar, 'preset-sidebar');
  await sidebar.reload();
  await expect(sidebar.getByRole('combobox', { name: 'Application Preset', exact: true })).toHaveValue(softwareId);
  await expect(sidebar.getByRole('button', { name: 'Fill this page', exact: true })).toBeEnabled();
  await expect(sidebar.getByRole('region', { name: 'Application preset' })).toContainText('Taylor_Software.pdf');
  expect(await sidebar.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await sidebar.close();
});

test('pins documents, responses and AI context to the application despite preset switches and worker restarts', async () => {
  await page.evaluate(async () => { await chrome.storage.local.set({ geminiApiKey: 'fictional-key' }); });
  const form = await context.newPage(); await form.goto(URL); await form.bringToFront();
  const result = await request('fillActiveTab', { presetId: softwareId }); expect(result.ok).toBe(true);
  await expect(form.locator('#essay')).toHaveValue('I built a fictional billing dashboard.', { timeout: 30_000 });
  await expect(form.locator('#first')).toHaveValue('Taylor');
  await expect(form.locator('#email')).toHaveValue('taylor@fictional.example');
  await expect(form.locator('#portfolio')).toHaveValue('https://example.com/software');
  await expect(form.locator('#auth')).toHaveValue('Yes');
  await expect(form.locator('#commute')).toHaveValue('Yes');
  expect(await form.locator('#resume').evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe('Taylor_Software.pdf');
  await expect.poll(async () => (await readRows('applications'))[0]?.status).toBe('Ready for review');
  const application = (await readRows('applications'))[0];
  expect(application.presetName).toBe('Software Engineer'); expect(application.resumeName).toBe('Taylor_Software.pdf');
  await page.bringToFront();
  await presetRow('Hardware Engineer').getByRole('button', { name: 'Use preset', exact: true }).click();
  const originalSoftware = (await readRows('presets')).find(p => p.id === softwareId);
  await presetRow('Software Engineer').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('AI writing focus', { exact: true }).fill('Changed guidance for future software fills.');
  await page.getByLabel('Your prepared answer', { exact: true }).fill('Changed future software response.');
  await page.getByRole('button', { name: 'Save and use preset', exact: true }).click();
  await presetRow('Hardware Engineer').getByRole('button', { name: 'Use preset', exact: true }).click();
  await page.evaluate(async () => { await chrome.storage.local.set({ geminiApiKey: 'fictional-key' }); });
  const run = (await readRows('fillRuns')).find(r => r.id === application.runId);
  expect(run.context.hasGeminiKey).toBe(true);
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); await cdp.detach();
  // Fetch its existing context after the worker restart: same application, same immutable run.
  const captured = await page.evaluate(async tabId => {
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: async () => await chrome.runtime.sendMessage({ type: 'getFillContext' }) });
    return results[0].result;
  }, application.tabId);
  expect(captured.preset.emphasis).toBe(originalSoftware.emphasis);
  expect(captured.resume.name).toBe('Taylor_Software.pdf');
  await form.evaluate(() => {
    const label = document.createElement('label'); label.htmlFor = 'conditional'; label.textContent = 'Why this team?';
    const input = document.createElement('textarea'); input.id = 'conditional'; input.required = true;
    document.querySelector('form')!.append(label, input);
  });
  await expect(form.locator('#conditional')).toHaveValue('A fictional answer using my original software focus.', { timeout: 30_000 });
  expect(prompts.at(-1)).toContain('Original software focus');
  expect(prompts.at(-1)).not.toContain('Hardware focus');
  expect(prompts.at(-1)).not.toContain('Changed guidance');
  await screenshot(form, 'preset-software-filled');
  await form.bringToFront();
  await form.locator('#essay').fill('My later manual edit');
  const switchResult = await request('fillActiveTab', { presetId: hardwareId });
  expect(switchResult.ok).toBe(false); expect(switchResult.error).toMatch(/another preset|still filling/);
  expect((await readRows('applications'))[0].presetName).toBe('Software Engineer');
  await expect(form.locator('#essay')).toHaveValue('My later manual edit');
  expect(await form.locator('#resume').evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe('Taylor_Software.pdf');
  // A fresh application uses hardware, including its independent document and response.
  const second = await context.newPage(); await second.goto(URL.replace('preset-proof', 'hardware-proof')); await second.bringToFront();
  expect((await request('fillActiveTab', { presetId: hardwareId })).ok).toBe(true);
  await expect(second.locator('#essay')).toHaveValue('I built a fictional robotics prototype.', { timeout: 30_000 });
  expect(await second.locator('#resume').evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe('Taylor_Hardware.pdf');
  await expect(second.locator('#portfolio')).toHaveValue('https://example.com/hardware');
  await screenshot(second, 'preset-hardware-filled');
  // A run token from a different tab cannot expose or use the software applicant context.
  await expect.poll(async () => (await readRows('applications')).find(a => a.url.includes('hardware-proof'))?.tabId).toBeTruthy();
  const secondApp = (await readRows('applications')).find(a => a.url.includes('hardware-proof'));
  const denied = await page.evaluate(async ({ tabId, runId }) => {
    const results = await chrome.scripting.executeScript({ target: { tabId }, args: [runId], func: async (runId: string) => await chrome.runtime.sendMessage({ type: 'getFillContext', runId }) });
    return results[0].result;
  }, { tabId: secondApp.tabId, runId: application.runId });
  expect(denied.ok).toBe(false);
  await second.close(); await form.close();
  await page.evaluate(async () => { await chrome.storage.local.set({ geminiApiKey: '' }); });
});

test('rejects stale edits atomically, confirms deletion, and lays out the editor at narrow widths', async () => {
  await page.bringToFront();
  await presetRow('Hardware Engineer').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel(/^Preset name/).fill('Unsaved hardware edit');
  const hardware = (await readRows('presets')).find(p => p.id === hardwareId);
  await putRow('presets', { ...hardware, revision: hardware.revision + 1 });
  await page.getByLabel('Upload resume for this preset', { exact: true }).setInputFiles(pdf('Must_Not_Persist.pdf'));
  await page.getByRole('button', { name: 'Save and use preset', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed in another window');
  expect((await readRows('presets')).find(p => p.id === hardwareId).name).toBe('Hardware Engineer');
  expect((await readRows('presetFiles')).some(f => f.name === 'Must_Not_Persist.pdf')).toBe(false);
  await page.setViewportSize({ width: 420, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, 'preset-editor-mobile');
  page.once('dialog', d => d.dismiss());
  await page.getByRole('combobox', { name: 'Settings section', exact: true }).selectOption('memories');
  await expect(editor()).toBeVisible();
  await expect(page.getByLabel(/^Preset name/)).toHaveValue('Unsaved hardware edit');
  page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await page.setViewportSize({ width: 1180, height: 900 });
  await presetRow('Hardware Engineer').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await readRows('presets')).some(p => p.id === hardwareId)).toBe(true);
  await presetRow('Hardware Engineer').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete preset', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Hardware Engineer deleted');
  await expect(presetRow('Default')).toContainText('Selected for next fill');
  expect((await readRows('presetFiles')).some(f => f.name === 'Taylor_Hardware.pdf')).toBe(false);
  expect((await readRows('profile'))[0].firstName).toBe('Taylor');
  expect(await readRows('rememberedMappings')).toHaveLength(1);
});

test('opening a pasted link pins the requested preset before loading and cleans up its run on close', async () => {
  await page.bringToFront();
  if (!softwareId) {
    await page.getByRole('button', { name: 'Create preset', exact: true }).click();
    await page.getByLabel(/^Preset name/).fill('Software Engineer');
    await page.getByLabel('Upload resume for this preset', { exact: true }).setInputFiles(pdf('Taylor_Software.pdf'));
    await page.getByRole('button', { name: 'Add prepared response', exact: true }).click();
    await page.getByLabel('Application question', { exact: true }).fill('Describe your proudest accomplishment');
    await page.getByLabel('Your prepared answer', { exact: true }).fill('Changed future software response.');
    await page.getByRole('button', { name: 'Save and use preset', exact: true }).click();
    await expect(presetRow('Software Engineer')).toContainText('Selected for next fill');
    softwareId = (await readRows('presets')).find(p => p.name === 'Software Engineer').id;
  } else await presetRow('Software Engineer').getByRole('button', { name: 'Use preset', exact: true }).click();
  const baseline = await readRows('profile'), memories = await readRows('rememberedMappings');
  const software = (await readRows('presets')).find(p => p.id === softwareId);
  const result = await request('startFill', { url: URL.replace('/preset-proof/apply', '/opened-proof'), presetId: softwareId });
  expect(result.ok).toBe(true);
  await presetRow('Default').getByRole('button', { name: 'Use preset', exact: true }).click();
  await expect.poll(() => context.pages().some(p => p.url().includes('/opened-proof/apply')), { timeout: 15000 }).toBe(true);
  const form = context.pages().find(p => p.url().includes('/opened-proof/apply'))!;
  await expect(form.locator('#essay')).toHaveValue('Changed future software response.', { timeout: 30_000 });
  expect(await form.locator('#resume').evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe('Taylor_Software.pdf');
  const app = (await readRows('applications')).find(a => a.url.includes('opened-proof'));
  expect(app.presetId).toBe(softwareId); expect(app.presetRevision).toBe(software.revision);
  expect(await readRows('profile')).toEqual(baseline); expect(await readRows('rememberedMappings')).toEqual(memories);
  await form.close();
  await expect.poll(async () => (await readRows('fillRuns')).length).toBe(0);
});

test('tracking without autofill still reads the posting and deletes its record without filling the form', async () => {
  const baseline = await readRows('profile');
  const url = URL.replace('preset-proof', 'tracking-proof');
  const form = await context.newPage();
  await form.goto(url);
  await form.evaluate(() => {
    document.title = 'Contoso - Fictional Hardware Engineer';
    const description = document.createElement('div');
    description.dataset.qa = 'job-description';
    description.textContent = 'A fictional engineering role.';
    document.body.prepend(description);
  });
  const sidebar = await context.newPage();
  await sidebar.goto('chrome-extension://' + extensionId + '/sidepanel.html');
  const appearance = await context.newPage();
  await appearance.goto('chrome-extension://' + extensionId + '/options.html#sidebar');
  await appearance.getByRole('checkbox',{name:/^Track without autofill/}).check();
  await expect(appearance.getByRole('status')).toContainText('Track without autofill shown');
  await appearance.close();
  await sidebar.getByRole('button', { name: 'Toggle Track Without Autofill', exact: true }).click();
  const tracking = sidebar.locator('#sidebar-track-body');
  await tracking.getByLabel('Application Link', { exact: true }).fill(url);
  await tracking.getByRole('button', { name: 'Mark as submitted', exact: true }).click();
  await expect(tracking).toContainText('Marked as submitted.');
  const application = (await readRows('applications')).find(a => a.url === url);
  expect(application).toMatchObject({ company: 'Contoso', role: 'Fictional Hardware Engineer', status: 'Submitted', filledCount: 0 });
  expect(application.presetId).toBeUndefined();
  expect(application.runId).toBeUndefined();
  await expect(form.locator('#first')).toHaveValue('');
  await expect(form.locator('#email')).toHaveValue('');
  expect(await form.locator('#resume').evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
  await sidebar.getByRole('button', { name: 'Toggle Applications', exact: true }).click();
  const row = sidebar.locator('#sidebar-history-body').getByRole('listitem').filter({ has: sidebar.getByRole('link', { name: 'Fictional Hardware Engineer', exact: true }) });
  await row.getByRole('button', { name: 'Delete Fictional Hardware Engineer at Contoso from this list', exact: true }).click();
  await sidebar.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect((await readRows('applications')).some(a => a.url === url)).toBe(false);
  expect(await readRows('profile')).toEqual(baseline);
  await sidebar.close(); await form.close();
});
