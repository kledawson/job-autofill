import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

declare const chrome: any;
const EXTENSION = resolve(import.meta.dirname, '../../apps/extension/dist/chrome-mv3');
const URL = 'https://jobs.lever.co/contoso/backup-proof/apply';
let context: BrowserContext, server: Server, page: Page, extensionId: string;
const request = (type: string, data: object = {}) => page.evaluate(payload => chrome.runtime.sendMessage(payload), { type, ...data });
const readMemories = () => page.evaluate(() => new Promise<any[]>((resolve, reject) => {
  const req = indexedDB.open('job-autofill');
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const d = req.result, tx = d.transaction('rememberedMappings'), rows = tx.objectStore('rememberedMappings').getAll();
    tx.oncomplete = () => { d.close(); resolve(rows.result); };
    tx.onabort = () => { d.close(); reject(tx.error); };
  };
}));
const writeState = (storeName: string, values: any[], clear = false) => page.evaluate(({ storeName, values, clear }) => new Promise<void>((resolve, reject) => {
  const req = indexedDB.open('job-autofill'); req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const d = req.result, tx = d.transaction(storeName, 'readwrite'), store = tx.objectStore(storeName);
    if (clear) store.clear(); for (const value of values) store.put(value);
    tx.oncomplete = () => { d.close(); resolve(); }; tx.onabort = () => { d.close(); reject(tx.error); };
  };
}), { storeName, values, clear });
const upload = (text: string) => page.getByLabel('Choose Memories backup').setInputFiles({ name: 'fictional-memories.json', mimeType: 'application/json', buffer: Buffer.from(text) });
const preview = () => page.getByRole('region', { name: 'Review Memories restore' });
const screenshot = async (name: string) => {
  if (process.env.SCREENSHOTS) await page.screenshot({ path: join(process.env.SCREENSHOTS, name + '.png'), fullPage: true });
};
const rules = [
  { id: 501, schemaVersion: 3, updatedAt: 1780000000000, lastUsed: 1780000001000, question: 'Can you commute to Cupertino?', aliases: ['Can you travel to the Cupertino office?'], scope: 'all', target: { kind: 'answer', value: 'Yes' }, answerAliases: ['Yes, daily'] },
  { id: 502, schemaVersion: 3, updatedAt: 1780000000000, question: 'Fictional tools', aliases: ['Select fictional tools'], scope: 'site:https://jobs.lever.co', target: { kind: 'answers', selections: [{ value: 'SQL', aliases: ['Structured Query Language'] }, { value: 'TS', aliases: ['TypeScript'] }] } },
  { id: 503, schemaVersion: 2, updatedAt: 1780000000000, question: 'Backup contact destination', aliases: [], scope: 'application:' + URL, target: { kind: 'profile', key: 'email' } },
];

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaf-backup-e2e-'));
  const openssl = process.platform === 'win32'
    ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(p => join(p!, 'Git', 'usr', 'bin', 'openssl.exe')).find(existsSync) ?? 'openssl.exe'
    : 'openssl';
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=jobs.lever.co', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(
    '<!doctype html><title>Contoso application</title><style>body{font:18px system-ui;padding:32px;max-width:740px}label{display:block;margin:20px 0 8px}input,select{font:inherit;padding:12px;width:95%}</style><h1>Fictional Engineer</h1><h2>Contoso</h2><form><label for="commute">Can you travel to the Cupertino office?</label><select id="commute" required><option value="">Select...</option><option>Yes, daily</option><option>No</option></select><label for="tools">Select fictional tools</label><select id="tools" multiple required><option>TypeScript</option><option>Structured Query Language</option><option>Rust</option></select><label for="contact">Backup contact destination</label><input id="contact" required></form>'
  ));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, ignoreHTTPSErrors: true,
    args: ['--disable-extensions-except=' + EXTENSION, '--load-extension=' + EXTENSION, '--host-resolver-rules=MAP jobs.lever.co:443 127.0.0.1:' + port + ', MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--ignore-certificate-errors'],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = worker.url().split('/')[2]!;
  page = await context.newPage(); await page.goto('chrome-extension://' + extensionId + '/options.html#memories');
  const profile = (await request('getFillContext')).profile;
  await writeState('profile', [{ ...profile, firstName: 'Taylor', lastName: 'Example', email: 'taylor@fictional.example' }], true);
});
test.afterAll(async () => { await context?.close(); await new Promise<void>(r => server?.close(() => r())); });

test('Memories backup downloads all rules and restores multi-select, aliases and profile links', async () => {
  await writeState('rememberedMappings', rules, true);
  await page.reload();
  await page.getByLabel('Search memories').fill('Cupertino');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup Memories', exact: true }).click();
  const download = await downloadPromise, file = readFileSync((await download.path())!, 'utf8');
  const backup = JSON.parse(file);
  expect(download.suggestedFilename()).toMatch(/^job-autofill-memories-\d{4}-\d{2}-\d{2}\.json$/);
  expect(backup.memories).toHaveLength(3); expect(backup.memories.every((m: any) => !('id' in m))).toBe(true);
  expect(backup).not.toHaveProperty('profile'); expect(file).not.toContain('taylor@fictional.example');
  await writeState('rememberedMappings', [], true); await page.reload(); await upload(file);
  await expect(preview().getByRole('region', { name: 'New Memories to add' })).toBeVisible();
  await expect(preview().getByRole('checkbox')).toHaveCount(3);
  expect(await readMemories()).toEqual([]);
  await screenshot('memories-backup-preview');
  // Preview approval must survive a Manifest V3 worker shutdown, without in-memory tokens.
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); await cdp.detach();
  await preview().getByRole('button', { name: 'Apply these choices', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restore complete.' })).toContainText('3 new Memories added');
  const restored = await readMemories();
  expect(restored).toHaveLength(3);
  expect(restored[0].id).not.toBe(501);
  expect(restored.map(({ id, ...m }) => m)).toEqual(backup.memories);
  expect((await request('getFillContext')).profile.email).toBe('taylor@fictional.example');
  await upload(file);
  await expect(preview()).toContainText('Already saved (3)');
  await expect(preview()).toContainText('Nothing needs restoring');
  await preview().getByRole('button', { name: 'Finish without changes', exact: true }).click();
  expect(await readMemories()).toEqual(restored);
  await screenshot('memories-backup-restored');
  const form = await context.newPage(); await form.goto(URL); await form.bringToFront();
  expect((await request('fillActiveTab')).ok).toBe(true);
  await expect(form.locator('#commute')).toHaveValue('Yes, daily', { timeout: 30_000 });
  await expect(form.locator('#tools')).toHaveValues(['TypeScript', 'Structured Query Language']);
  await expect(form.locator('#contact')).toHaveValue('taylor@fictional.example');
  if (process.env.SCREENSHOTS) await form.screenshot({ path: join(process.env.SCREENSHOTS, 'memories-backup-autofill.png'), fullPage: true });
  // Same rules are persisted and available after both extension and form pages reload.
  await page.reload(); await form.reload(); await form.bringToFront(); await request('fillActiveTab');
  await expect(form.locator('#commute')).toHaveValue('Yes, daily', { timeout: 30_000 });
  await expect(form.locator('#tools')).toHaveValues(['TypeScript', 'Structured Query Language']);
  await form.close();
});

test('Memories restore keeps or overrides conflicts and rejects stale, malformed and unconfirmed batches atomically', async () => {
  const current = [{ ...rules[0], target: { kind: 'answer', value: 'No' }, aliases: [], answerAliases: [] }, { ...rules[1], target: { kind: 'answers', selections: [{ value: 'Rust', aliases: [] }] } }];
  await writeState('rememberedMappings', current, true); await page.reload();
  const file = JSON.stringify({ format: 'job-autofill-memories', version: 1, createdAt: 1780000000000, memories: rules.map(({ id, ...m }) => m) });
  await upload(file); await expect(preview().getByRole('region', { name: 'Different versions to review' })).toBeVisible();
  const rows = preview().getByRole('listitem').filter({ has: page.locator('[name^="restore-choice-"]') });
  expect(await rows.count()).toBe(2);
  await expect(rows.nth(0).getByRole('radio', { name: 'Keep my saved answer', exact: true })).toBeChecked();
  await rows.nth(1).getByRole('radio', { name: 'Use the backup answer', exact: true }).check();
  await screenshot('memories-backup-conflict-choices');
  // A concurrent edit invalidates the entire batch, including its new profile-link Memory.
  const concurrent = current.map(m => ({ ...m, updatedAt: 555 }));
  await writeState('rememberedMappings', concurrent, true);
  await preview().getByRole('button', { name: 'Apply these choices', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed after the preview');
  expect(await readMemories()).toEqual(concurrent);
  await preview().getByRole('button', { name: 'Refresh preview', exact: true }).click();
  await expect(rows.nth(1).getByRole('radio', { name: 'Keep my saved answer', exact: true })).toBeChecked();
  await rows.nth(1).getByRole('radio', { name: 'Use the backup answer', exact: true }).check();
  await preview().getByRole('button', { name: 'Apply these choices', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restore complete.' })).toContainText('1 saved Memory kept');
  const restored = await readMemories();
  expect(restored).toHaveLength(3);
  expect(restored.find(m => m.question === current[0].question)).toEqual(concurrent[0]);
  expect(restored.find(m => m.question === rules[1].question).target).toEqual(rules[1].target);
  await screenshot('memories-backup-conflicts-restored');
  await upload(file); await preview().getByRole('button', { name: 'Cancel restore', exact: true }).click();
  expect(await readMemories()).toEqual(restored);
  for (const invalid of ['{bad', JSON.stringify({ format: 'job-autofill-memories', version: 99 }), JSON.stringify({ format: 'job-autofill-memories', version: 1, createdAt: 0, memories: [{ ...rules[0], target: { kind: 'answer', value: '' } }] })]) {
    await upload(invalid); await expect(page.getByRole('alert')).toBeVisible(); expect(await readMemories()).toEqual(restored);
  }

});
test('backup and restore work with eight stored Memories when worker messages return no response', async () => {
  const eight = [...rules, ...Array.from({ length: 5 }, (_, i) => ({
    id: 600 + i, schemaVersion: 1, updatedAt: 1780000000000,
    question: 'Fictional backup question ' + (i + 1), aliases: [], scope: 'all', target: { kind: 'answer', value: 'Fictional answer ' + (i + 1) },
  }))];
  await writeState('rememberedMappings', eight, true); await page.reload();
  await page.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    (window as any).missingBackupRequests = 0;
    chrome.runtime.sendMessage = (payload: any, ...args: any[]) => {
      if (['exportMemoryBackup', 'previewMemoryRestore', 'restoreMemoryBackup'].includes(payload?.type)) {
        (window as any).missingBackupRequests++;
        return Promise.resolve(undefined);
      }
      return original(payload, ...args);
    };
  });
  await page.getByRole('button', { name: 'Backup Memories', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Backup downloaded:' })).toContainText('8 Memories', { timeout: 5000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await screenshot('memories-eight-backup-success');
  const downloads = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup Memories', exact: true }).click();
  const downloaded = await downloads;
  const file = readFileSync((await downloaded.path())!, 'utf8');
  expect(JSON.parse(file).memories).toHaveLength(8);
  expect(await readMemories()).toEqual(eight);
  await writeState('rememberedMappings', [], true);
  await upload(file); await expect(preview().getByRole('checkbox')).toHaveCount(8);
  await preview().getByRole('button', { name: 'Apply these choices', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restore complete.' })).toContainText('8 new Memories added');
  expect(await readMemories()).toHaveLength(8);
  expect(await page.evaluate(() => (window as any).missingBackupRequests)).toBe(0);
});
test('restore review separates new and identical items, explains matching-rule conflicts, and summarizes grouped replacements', async () => {
  const alpha = { id: 701, schemaVersion: 3, updatedAt: 1780000000000, question: 'Fictional Alpha question', aliases: ['Fictional Beta question'], scope: 'all', target: { kind: 'answer', value: 'Saved combined answer' } };
  const current = [{ ...rules[0], target: { kind: 'answer', value: 'No' } }, rules[1], rules[2], alpha];
  const incoming = [
    rules[0], rules[1], { ...rules[2], aliases: ['Current backup contact'] },
    { ...alpha, id: 702, question: 'Fictional new office preference', aliases: [], target: { kind: 'answer', value: 'Remote' } },
    { ...alpha, aliases: [], target: { kind: 'answer', value: 'Alpha backup answer' } },
    { ...alpha, id: 703, question: 'Fictional Beta question', aliases: [], target: { kind: 'answer', value: 'Beta backup answer' } },
  ];
  await writeState('rememberedMappings', current, true); await page.reload();
  const file = JSON.stringify({ format: 'job-autofill-memories', version: 1, createdAt: 1780000000000, memories: incoming.map(({ id, ...m }) => m) });
  await upload(file);
  const review = preview(), conflicts = review.getByRole('region', { name: 'Different versions to review' }), fresh = review.getByRole('region', { name: 'New Memories to add' });
  await expect(page.getByLabel('Search memories')).toBeHidden();
  await expect(page.getByRole('list', { name: 'Memories', exact: true })).toBeHidden();
  await expect(conflicts.locator('[data-restore-key]')).toHaveCount(3);
  await expect(fresh.getByRole('checkbox')).toHaveCount(1);
  await expect(review.getByRole('list', { name: 'Already saved Memories' })).toBeHidden();
  await review.getByText('Already saved (1) — no action needed', { exact: true }).click();
  await expect(review.getByRole('list', { name: 'Already saved Memories' })).toBeVisible();
  const sameAnswer = conflicts.locator('[data-restore-key]').filter({ hasText: 'Backup contact destination' });
  await expect(sameAnswer).toContainText('The answer is the same');
  await expect(sameAnswer.getByText('Question variations: Current backup contact', { exact: true })).toBeVisible();
  const grouped = conflicts.locator('[data-restore-key]').filter({ hasText: 'Fictional Alpha question' });
  await expect(grouped).toContainText('replace them with 2 backup Memories');
  const summary = review.locator('[aria-label="Restore changes summary"]');
  await expect(summary).toContainText('1 new Memory will be added');
  await fresh.getByRole('button', { name: 'Skip all new', exact: true }).click();
  await expect(fresh).toContainText('Skipped — will not be added');
  await expect(summary).toContainText('0 new Memories will be added');
  await fresh.getByRole('button', { name: 'Select all new', exact: true }).click();
  await expect(summary).toContainText('1 new Memory will be added');
  await fresh.getByRole('checkbox', { name: 'Fictional new office preference', exact: true }).uncheck();
  await grouped.getByRole('radio', { name: 'Use the backup answer', exact: true }).check();
  await expect(summary).toContainText('1 saved Memory will be replaced');
  await expect(summary).toContainText('2 saved Memories will be kept');
  expect(await readMemories()).toEqual(current);
  await screenshot('memories-restore-clear-groups');
  if (process.env.SCREENSHOTS) {
    await conflicts.locator('[data-restore-key]').first().screenshot({ path: join(process.env.SCREENSHOTS, 'memories-restore-answer-comparison.png') });
    await summary.screenshot({ path: join(process.env.SCREENSHOTS, 'memories-restore-change-summary.png') });
  }
  await page.setViewportSize({ width: 420, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await screenshot('memories-restore-mobile');
  await review.getByRole('button', { name: 'Apply these choices', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restore complete.' })).toContainText('1 saved Memory replaced with 2 backup Memories');
  const restored = await readMemories();
  expect(restored).toHaveLength(5);
  expect(restored.find(m => m.question === alpha.question).target.value).toBe('Alpha backup answer');
  expect(restored.find(m => m.question === 'Fictional Beta question').target.value).toBe('Beta backup answer');
  expect(restored.find(m => m.question === 'Fictional new office preference')).toBeUndefined();
  expect(restored.find(m => m.question === rules[0].question)).toEqual(current[0]);
  expect(restored.find(m => m.question === rules[2].question)).toEqual(rules[2]);
  await expect(page.getByLabel('Search memories')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
});
