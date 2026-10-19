import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
declare const chrome: any;
let context: BrowserContext, server: Server, panel: Page, extensionId: string;
const url = (id: number) => 'https://job-boards.greenhouse.io/fictionalspace/jobs/' + id;
const request = (type: string, data: object = {}) => panel.evaluate(payload => chrome.runtime.sendMessage(payload), { type, ...data });
const rows = (table: string) => panel.evaluate(table => new Promise<any[]>((resolve, reject) => {
  const r = indexedDB.open('job-autofill'); r.onerror = () => reject(r.error); r.onsuccess = () => {
    const d = r.result, tx = d.transaction(table), read = tx.objectStore(table).getAll(); read.onsuccess = () => resolve(read.result); tx.oncomplete = () => d.close();
  };
}), table);
const queue = async () => (await rows('applicationQueue'))[0];
const ready = (index: number) => expect.poll(async () => (await queue()).items[index].state, { timeout: 35000 }).toBe('review');
const form = (id: number) => context.pages().find(p => p.url().startsWith(url(id)))!;
const siteQuestion = 'Are you available to immediately work on-site in our San Jose location three days a week?';
const priorityFixture = (ai: boolean) => `<!doctype html><title>Job Application for Fictional Engineer at Fictional Space</title><style>body{font:16px system-ui;padding:24px}label{display:block;margin:16px 0}input,select,textarea{font:inherit;padding:10px}</style><h1>Fictional Engineer</h1><form id="application-form"><label>First name<input id="first_name" autocomplete="given-name" required></label><label>Email<input id="email" type="email" required></label>${ai ? '' : '<label>Phone<input id="phone" value="2025550141"></label><div style="height:1100px" aria-hidden="true"></div>'}<label>${siteQuestion}<select id="onsite" required><option value="">Select...</option><option>Yes</option><option>No</option></select></label>${ai ? '<label>Why are you interested in this fictional role?<textarea id="review-essay" required></textarea></label>' : '<label>Fictional review reference<input id="review-custom" required></label><label>Academic transcript<input id="review-file" type="file" required></label><label>Fictional optional note<input id="review-optional"></label>'}</form>`;
const fixture = (ai: boolean, redirect = false) => `<!doctype html><title>Job Application for Fictional Engineer at Fictional Space</title><style>body{font:16px system-ui;padding:20px}label{display:block;margin-top:12px}input,select,textarea{padding:8px;font:inherit}</style><h1>Fictional Engineer</h1><form id="application-form"><label for="first_name">First Name</label><input id="first_name" autocomplete="given-name" required><label for="email">Email</label><input id="email" type="email" required>${ai ? '<label for="essay">Tell us about your proudest accomplishment</label><textarea id="essay" required></textarea>' : '<label for="custom">Fictional launch reference</label><input id="custom" required>'}<button type="submit">Submit application</button></form><script>
window.submits=0;window.outcome='success';
${ai ? '' : `setTimeout(()=>document.querySelector('form').insertAdjacentHTML('beforeend','<label for="onsite">${siteQuestion}</label><select id="onsite" required><option value="">Select...</option><option>Yes</option><option>No</option></select><label for="mission">Which fictional mission would you support?</label><select id="mission" required><option value="">Select...</option><option>Orbital</option><option>Ground</option></select>'),500);`}
document.addEventListener('submit', e=>{e.preventDefault();window.submits++;if(window.outcome==='error'){document.querySelector('form').insertAdjacentHTML('beforeend','<p role="alert">Please fix this fictional validation error.</p>');return;}if(window.outcome==='wait')return;if(${redirect}){location.href=location.pathname+'/confirmation';return;}document.querySelector('form').remove();document.body.insertAdjacentHTML('beforeend','<h2>Application submitted successfully.</h2>');});</script>`;

const locationFixture = (matching: boolean) => `<!doctype html><title>Job Application for Fictional Engineer at Fictional Space</title><style>body{font:16px system-ui;padding:24px}label{display:block;margin:16px 0 4px}input{padding:10px}[role=option]{padding:10px;cursor:pointer}.select__single-value{padding:10px}</style><h1>Fictional Engineer</h1><form id="application-form"><label for="first_name">First Name</label><input id="first_name" autocomplete="given-name"><label for="email">Email</label><input id="email" type="email"><label for="location">Location (City)*</label><div class="select__container"><div class="select__control"><input id="location" role="combobox" aria-expanded="false" required></div></div></form><script>
const input=document.getElementById('location'), control=input.parentElement;
let timer, staleTimer;window.locationQueries=[];
function render(choices){
document.getElementById('places')?.remove();const list=document.createElement('div');list.id='places';list.setAttribute('role','listbox');
for(const text of choices){
const option=document.createElement('div');option.setAttribute('role','option');option.textContent=text;option.addEventListener('click',()=>{clearTimeout(timer);clearTimeout(staleTimer);list.remove();input.value='';input.setAttribute('aria-expanded','false');const value=document.createElement('div');value.className='select__single-value';value.textContent=text;control.appendChild(value)});list.appendChild(option)}
input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','true');control.appendChild(list)}
input.addEventListener('input',()=>{clearTimeout(timer);clearTimeout(staleTimer);if(!input.value)return;const query=input.value;
staleTimer=setTimeout(()=>{window.locationQueries.push(query);render(['San José del Castillo, Jalisco, Mexico','San Jose, California, California'])},30);
timer=setTimeout(()=>{if(input.value!==query)return;render(${matching} && query==='San Jose, California, United States'?['San José del Castillo, Jalisco, Mexico','San Jose, California, California','San Jose, California, United States']:['San José del Castillo, Jalisco, Mexico'])},250)});
input.addEventListener('keydown',e=>{if(e.key==='Escape'){clearTimeout(timer);clearTimeout(staleTimer);document.getElementById('places')?.remove();input.setAttribute('aria-expanded','false')}});
</script>`;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaf-review-e2e-'));
  const openssl = process.platform === 'win32' ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(p => join(p!, 'Git', 'usr', 'bin', 'openssl.exe')).find(existsSync) ?? 'openssl.exe' : 'openssl';
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=job-boards.greenhouse.io', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(req.url?.includes('/86') ? priorityFixture(req.url.includes('/861')) : req.url?.includes('/85') ? locationFixture(!req.url.includes('/851')) : req.url?.endsWith('/confirmation') ? '<!doctype html><h1>Thank you for applying.</h1>' : fixture(req.url?.includes('/900') ?? false, req.url?.includes('/801') ?? false)));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const port = (server.address() as AddressInfo).port;
  process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
  context = await chromium.launchPersistentContext(join(dir, 'browser'), { channel: 'chromium', headless: true, ignoreHTTPSErrors: true, args: [
    '--disable-extensions-except=' + resolve(import.meta.dirname, '../../apps/extension/dist/chrome-mv3'), '--load-extension=' + resolve(import.meta.dirname, '../../apps/extension/dist/chrome-mv3'),
    '--host-resolver-rules=MAP job-boards.greenhouse.io:443 127.0.0.1:' + port + ', MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--ignore-certificate-errors'] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); extensionId = worker.url().split('/')[2]!;
  panel = await context.newPage(); await panel.goto('chrome-extension://' + extensionId + '/sidepanel.html'); await panel.setViewportSize({ width: 400, height: 960 });
  const base = (await request('getFillContext')).profile;
  await panel.evaluate(async base => {
    await chrome.storage.local.set({ onboardingComplete: true, geminiApiKey: '' });
    await new Promise<void>((resolve, reject) => { const r = indexedDB.open('job-autofill'); r.onsuccess = () => {
      const d = r.result, tx = d.transaction('profile', 'readwrite'); tx.objectStore('profile').put({ ...base, firstName: 'Taylor', lastName: 'Example', email: 'taylor@fictional.example', city: 'San Jose', state: 'CA', country: 'United States' }); tx.oncomplete = () => { d.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    }; });
  }, base);
  for (const [question, value] of [[siteQuestion, 'Yes'], ['Which fictional mission would you support?', 'Orbital']]) {
    expect(await request('saveRememberedMapping', { mapping: { question, aliases: [], scope: 'company:fictional space', target: { kind: 'answer', value } } })).toMatchObject({ ok: true });
  }
  await panel.reload();
  await expect(panel.getByRole('region', { name: 'Fill this page', exact: true }).getByRole('button', { name: 'Fill this page', exact: true })).toBeEnabled();
});
test.afterAll(async () => { await context?.close(); await new Promise<void>(r => server?.close(() => r())); });
async function shot(name: string) {
  if (!process.env.SCREENSHOTS) return; mkdirSync(process.env.SCREENSHOTS, { recursive: true });
  await panel.evaluate(() => window.scrollTo(0, 0));
  await panel.screenshot({ path: join(process.env.SCREENSHOTS, name + '.png'), fullPage: false });
}
async function reviewShot(name: string) {
  if (!process.env.SCREENSHOTS) return;
  mkdirSync(process.env.SCREENSHOTS, { recursive: true });
  const previous = panel.viewportSize();
  await panel.setViewportSize({ width: 400, height: 1600 });
  try { await panel.locator('#sidebar-review-body').screenshot({ path: join(process.env.SCREENSHOTS, name + '.png') }); }
  finally { if (previous) await panel.setViewportSize(previous); }
}
test('queued hydration matches manual Memories, preserves review edits, saves and refills one slot only after success', async () => {
  await panel.getByLabel('Job links', { exact: true }).fill([url(701), url(702), url(703)].join('\n'));
  await panel.getByLabel('Applications open at once', { exact: true }).selectOption('2'); await panel.getByRole('button', { name: 'Start queue', exact: true }).click();
  await ready(0); await ready(1); expect((await queue()).items[2].batch).toBe(0);
  for (const id of [701, 702]) { await expect(form(id).locator('#onsite')).toHaveValue('Yes'); await expect(form(id).locator('#mission')).toHaveValue('Orbital'); expect(await form(id).evaluate(() => (window as any).submits)).toBe(0); }
  const first = form(701); const before = await first.locator('select').evaluateAll(selects => selects.map(s => (s as HTMLSelectElement).value));
  const initial = await queue(); expect(await request('queueAction', { token: initial.token, itemId: initial.items[0].id, action: 'retry' })).toMatchObject({ ok: true }); await ready(0);
  expect(await first.locator('select').evaluateAll(selects => selects.map(s => (s as HTMLSelectElement).value))).toEqual(before);
  await request('queueAction', { token: initial.token, itemId: initial.items[0].id, action: 'open' });
  await panel.evaluate(() => { const t = document.getElementById('sidebar-review-toggle')!; if (t.getAttribute('aria-expanded') === 'false') t.click(); });
  // Replace the entire form during manual review, as React can do after an answer.
  await first.evaluate(() => {
    const f = document.querySelector('form')!, values = [...f.querySelectorAll('select')].map(s => s.value);
    f.replaceWith(f.cloneNode(true)); document.querySelectorAll('select').forEach((s, i) => { s.value = values[i]!; });
  });
  await first.locator('#custom').fill('Reusable fictional reference');
  const card = panel.getByRole('list', { name: 'Questions to review', exact: true }).getByRole('listitem').filter({ hasText: 'Fictional launch reference' });
  await expect(card.getByRole('button', { name: 'Save this answer', exact: true })).toBeVisible(); await card.getByRole('button', { name: 'Save this answer', exact: true }).click();
  await expect(panel.getByLabel('Your answer')).toHaveValue('Reusable fictional reference'); await panel.getByRole('button', { name: 'Save & apply', exact: true }).click();
  await expect(panel.getByText('Saved for future applications.', { exact: false })).toBeVisible(); await shot('queue-review-memory');
  await first.evaluate(() => { (window as any).outcome = 'error'; }); await first.getByRole('button', { name: 'Submit application', exact: true }).click();
  await expect(first.getByRole('alert')).toBeVisible(); expect(first.isClosed()).toBe(false); expect((await queue()).items[0].state).toBe('review'); expect((await queue()).items[2].batch).toBe(0);
  const second = form(702); await second.locator('#custom').fill('Manual second reference');
  await second.getByRole('button', { name: 'Submit application', exact: true }).click();
  await expect.poll(() => second.isClosed()).toBe(true); await ready(2); expect(first.isClosed()).toBe(false);
  await expect.poll(() => !!form(703)).toBe(true);
  const third = form(703); await expect(third.locator('#custom')).toHaveValue('Reusable fictional reference');
  expect(context.pages().filter(p => p.url().startsWith('https://job-boards.greenhouse.io/')).length).toBe(2);
  await shot('queue-rolling-review');
  await first.evaluate(() => { document.querySelector('[role="alert"]')!.remove(); (window as any).outcome = 'success'; }); await first.getByRole('button', { name: 'Submit application', exact: true }).click();
  await expect.poll(() => first.isClosed()).toBe(true); await third.getByRole('button', { name: 'Submit application', exact: true }).click();
  await expect.poll(async () => (await queue()).status).toBe('complete'); expect((await rows('applications')).filter(a => a.status === 'Submitted')).toHaveLength(3);
});
test('no click/failed validation is not success; a persisted intent survives worker restart and a confirmation redirect', async () => {
  expect(await request('startQueue', { urls: [url(801), url(802)], batchSize: 1, mode: 'continuous', autoDetectSubmission: true })).toMatchObject({ ok: true }); await ready(0);
  const first = form(801);
  await first.locator('#custom').fill('');
  await first.getByRole('button', { name: 'Submit application', exact: true }).click(); expect(await first.evaluate(() => (window as any).submits)).toBe(0); expect((await queue()).items[0].state).toBe('review');
  // Visible success text without a user intent cannot manufacture a submission.
  const q = await queue(); expect(await request('queueSubmissionConfirmed', { runId: q.items[0].attempt })).toMatchObject({ ok: false });
  await first.bringToFront();
  await first.locator('#custom').fill('Fictional reference'); await first.getByRole('button', { name: 'Submit application', exact: true }).click();
  await expect.poll(() => first.isClosed()).toBe(true); await ready(1);
  const second = form(802); await second.locator('#custom').fill('Another fictional reference');
  await expect.poll(() => panel.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id)).toBe((await queue()).items[1].tabId);
  await second.evaluate(() => { (window as any).outcome = 'wait'; }); await second.getByRole('button', { name: 'Submit application', exact: true }).click();
  await expect.poll(async () => !!(await queue()).items[1].submitIntentAt).toBe(true); expect(second.isClosed()).toBe(false);
  const cdp = await context.newCDPSession(panel); await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); await cdp.detach();
  await second.evaluate(() => { document.querySelector('form')!.remove(); document.body.insertAdjacentHTML('beforeend', '<h2>Your application has been received.</h2>'); });
  await expect.poll(() => second.isClosed()).toBe(true); await expect.poll(async () => (await queue()).status).toBe('complete');
});
test('Stop autofill & review releases a stalled AI response, permits remembering, and ignores the late writer', async () => {
  let release!: () => void; const held = new Promise<void>(r => { release = r; }); let asks = 0;
  await context.route('https://generativelanguage.googleapis.com/**', async route => { asks++; await held; await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Late fictional response' }] } }] }) }); });
  await panel.evaluate(() => chrome.storage.local.set({ geminiApiKey: 'synthetic-e2e-key' }));
  expect(await request('startQueue', { urls: [url(900)], batchSize: 1, mode: 'continuous' })).toMatchObject({ ok: true });
  await expect.poll(() => asks).toBe(1); const page = form(900); await expect(page.locator('#first_name')).toHaveValue('Taylor');
  await panel.getByRole('button', { name: 'Stop autofill & review', exact: true }).click(); await ready(0);
  await page.locator('#essay').fill('My own fictional accomplishment');
  const field = panel.getByRole('list', { name: 'Questions to review', exact: true }).getByRole('listitem').filter({ hasText: 'proudest accomplishment' });
  await expect(field.getByRole('button', { name: 'Save this answer', exact: true })).toBeVisible(); await field.getByRole('button', { name: 'Save this answer', exact: true }).click();
  await expect(panel.getByLabel('Your answer')).toHaveValue('My own fictional accomplishment'); await panel.getByRole('button', { name: 'Save & apply', exact: true }).click();
  release(); await expect(page.locator('#essay')).toHaveValue('My own fictional accomplishment'); await shot('queue-manual-review');
  const q = await queue(); await request('queueAction', { token: q.token, itemId: q.items[0].id, action: 'skip' });
  await panel.evaluate(() => chrome.storage.local.set({ geminiApiKey: '' })); await context.unroute('https://generativelanguage.googleapis.com/**');
});
test('a success screen without user submit intent stays open for manual confirmation', async () => {
  expect(await request('startQueue', { urls: [url(804)], batchSize: 1, mode: 'continuous', autoDetectSubmission: true })).toMatchObject({ ok: true }); await ready(0);
  const page = form(804), q = await queue();
  await page.evaluate(() => { document.querySelector('form')!.remove(); document.body.insertAdjacentHTML('beforeend', '<h2>Application submitted successfully.</h2>'); });
  await panel.evaluate(async ({ tabId, runId }) => chrome.scripting.executeScript({ target: { tabId }, func: (runId: string) => chrome.runtime.sendMessage({ type: 'queueSubmissionConfirmed', runId }), args: [runId] }), { tabId: q.items[0].tabId, runId: q.items[0].attempt });
  expect((await queue()).items[0].state).toBe('review'); expect(page.isClosed()).toBe(false);
  expect(await request('queueAction', { token: q.token, itemId: q.items[0].id, action: 'submitted' })).toMatchObject({ ok: true }); expect(page.isClosed()).toBe(true);
});

test('manual and queued location search reject the misleading first city and commit California', async () => {
  const page = await context.newPage(); await page.goto(url(850)); await page.bringToFront();
  await panel.getByRole('region', { name: 'Fill this page', exact: true }).getByRole('button', { name: 'Fill this page', exact: true }).click();
  await expect(page.locator('.select__single-value')).toHaveText('San Jose, California, United States');
  expect(await page.evaluate(() => (window as any).locationQueries)).toEqual(['San Jose, California, United States']);
  await expect.poll(() => page.locator('#location').evaluate(el => el.closest('[data-jaf-state]')?.getAttribute('data-jaf-state'))).toBe('filled');
  if (process.env.SCREENSHOTS) await page.screenshot({ path: join(process.env.SCREENSHOTS, 'verified-location.png') });
  await page.close();
  expect(await request('startQueue', { urls: [url(852)], batchSize: 1, mode: 'continuous' })).toMatchObject({ ok: true }); await ready(0);
  await expect(form(852).locator('.select__single-value')).toHaveText('San Jose, California, United States');
  expect(await form(852).evaluate(() => (window as any).locationQueries)).toEqual(['San Jose, California, United States']);
  const q = await queue(); await request('queueAction', { token: q.token, itemId: q.items[0].id, action: 'skip' });
});

test('a saved City containing California does not duplicate California in location searches', async () => {
  await panel.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('job-autofill'); request.onsuccess = () => {
      const database = request.result, transaction = database.transaction('profile', 'readwrite'), table = transaction.objectStore('profile'), read = table.get('me');
      read.onsuccess = () => table.put({ ...read.result, city: 'San Jose, California, California' });
      transaction.oncomplete = () => { database.close(); resolve(); }; transaction.onabort = () => reject(transaction.error);
    };
  }));
  expect(await request('startQueue', { urls: [url(853)], batchSize: 1, mode: 'continuous' })).toMatchObject({ ok: true }); await ready(0);
  await expect(form(853).locator('.select__single-value')).toHaveText('San Jose, California, United States');
  expect(await form(853).evaluate(() => (window as any).locationQueries)).toEqual(['San Jose, California, United States']);
  const q = await queue(); await request('queueAction', { token: q.token, itemId: q.items[0].id, action: 'skip' });
});

test('a city search with only the wrong location stays missing instead of green', async () => {
  expect(await request('startQueue', { urls: [url(851)], batchSize: 1, mode: 'continuous' })).toMatchObject({ ok: true }); await ready(0);
  const page = form(851), q = await queue();
  await expect(page.locator('.select__single-value')).toHaveCount(0); await expect(page.locator('#location')).toHaveValue('');
  expect((await rows('applications')).find(a => a.id === q.items[0].applicationId).missingLabels).toContain('Location (City)');
  await expect.poll(() => page.locator('#location').evaluate(el => el.closest('[data-jaf-state]')?.getAttribute('data-jaf-state'))).toBe('missing');
  await request('queueAction', { token: q.token, itemId: q.items[0].id, action: 'skip' });
});

test('prioritized review locates fields, preserves edits and clearly confirms Profile or Memory destinations', async () => {
  await panel.getByLabel('Job links', { exact: true }).fill(url(860));
  await panel.getByLabel('Applications open at once', { exact: true }).selectOption('1');
  await panel.getByRole('button', { name: 'Start queue', exact: true }).click(); await ready(0);
  const page = form(860), q = await queue(), item = q.items[0];
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await request('queueAction', { token: q.token, itemId: item.id, action: 'open' });
  await panel.evaluate(() => { const t = document.getElementById('sidebar-review-toggle')!; if (t.getAttribute('aria-expanded') === 'false') t.click(); });
  const list = panel.getByRole('list', { name: 'Questions to review', exact: true });
  await expect(list.getByRole('listitem').first()).toContainText('Fictional review reference');
  const upload = list.getByRole('listitem').filter({ hasText: 'Academic transcript' });
  await expect(upload).toContainText('Upload this document'); await expect(upload.getByRole('button', { name: /Remember/ })).toHaveCount(0);
  const feedback = (await rows('applications')).find(a => a.id === item.applicationId).fieldFeedback;
  expect(feedback.find((f: any) => f.label === 'First name')).toMatchObject({ status: 'verified', source: 'profile' });
  expect(feedback.find((f: any) => f.label === siteQuestion)).toMatchObject({ status: 'verified', source: 'memory' });
  expect(feedback.find((f: any) => f.label === 'Phone')).toMatchObject({ status: 'entered', source: 'page' });
  await panel.getByText(/^Verified & entered answers \(/).click();
  await reviewShot('review-priorities-panel');
  const custom = list.getByRole('listitem').filter({ hasText: 'Fictional review reference' });
  await custom.getByRole('button', { name: 'Show field', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('review-custom');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await page.locator('#review-custom').fill('Reusable fictional review answer');
  await custom.getByRole('button', { name: 'Save this answer', exact: true }).click();
  const editor = panel.getByRole('region', { name: 'Review save destination', exact: true });
  await expect(editor).toBeFocused(); await expect(editor).toContainText('Destination: Memory.');
  await expect(panel.getByLabel('Your answer')).toHaveValue('Reusable fictional review answer');
  await reviewShot('review-memory-destination');
  await panel.getByRole('button', { name: 'Save & apply', exact: true }).click();
  const memoryCount = (await rows('rememberedMappings')).length;
  await page.locator('#review-optional').fill('An optional manual answer');
  const optional = list.getByRole('listitem').filter({ hasText: 'Fictional optional note' });
  await expect(optional.getByRole('button', { name: 'Save this answer', exact: true })).toBeVisible();
  await page.locator('#review-optional').fill('');
  await expect(optional.getByRole('button', { name: 'Remember answer', exact: true })).toBeVisible();
  await page.locator('#first_name').fill('Morgan');
  await expect(page.locator('#first_name')).toHaveAttribute('data-jaf-state', 'entered');
  const changed = list.getByRole('listitem').filter({ hasText: 'First name' });
  await expect(changed).toContainText('Entered by you'); await changed.getByRole('button', { name: 'Save this answer', exact: true }).click();
  const profileEditor = panel.getByRole('region', { name: 'Confirm profile update', exact: true });
  await expect(profileEditor).toContainText('Destination: Profile');
  await reviewShot('review-profile-destination');
  await expect(profileEditor.getByRole('button', { name: 'Save to profile', exact: true })).toBeDisabled();
  await profileEditor.getByRole('checkbox', { name: /Replace my current value/ }).check();
  await profileEditor.getByRole('button', { name: 'Save to profile', exact: true }).click();
  expect((await request('getFillContext')).profile.firstName).toBe('Morgan'); expect((await rows('rememberedMappings')).length).toBe(memoryCount);
  await shot('review-priorities');
  const token = feedback.find((f: any) => f.label === 'Fictional review reference').token;
  await page.goto(url(862));
  expect(await request('showApplicationField', { applicationId: item.applicationId, token })).toMatchObject({ ok: false });
  await request('queueAction', { token: q.token, itemId: item.id, action: 'skip' });
});

test('AI drafts are amber and remain visible for review even without missing answers', async () => {
  await context.route('https://generativelanguage.googleapis.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'A fictional AI draft to inspect.' }] } }] }) }));
  await panel.evaluate(() => chrome.storage.local.set({ geminiApiKey: 'synthetic-e2e-key' }));
  expect(await request('startQueue', { urls: [url(861)], batchSize: 1, mode: 'continuous' })).toMatchObject({ ok: true }); await ready(0);
  const page = form(861), q = await queue(); await request('queueAction', { token: q.token, itemId: q.items[0].id, action: 'open' });
  await panel.evaluate(() => { const t = document.getElementById('sidebar-review-toggle')!; if (t.getAttribute('aria-expanded') === 'false') t.click(); });
  await expect(page.locator('#review-essay')).toHaveAttribute('data-jaf-state', 'ai');
  expect(await page.locator('#review-essay').evaluate(el => el.style.outline)).toContain('217, 119, 6');
  const card = panel.getByRole('list', { name: 'Questions to review', exact: true }).getByRole('listitem').filter({ hasText: 'Why are you interested' });
  await expect(card).toContainText('Review this AI draft'); await expect(card.getByRole('button', { name: 'Show field' })).toBeVisible();
  await reviewShot('review-ai-panel');
  await shot('review-ai-draft');
  await request('queueAction', { token: q.token, itemId: q.items[0].id, action: 'skip' });
  await panel.evaluate(() => chrome.storage.local.set({ geminiApiKey: '' })); await context.unroute('https://generativelanguage.googleapis.com/**');
});
