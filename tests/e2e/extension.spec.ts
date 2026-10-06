import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

declare const chrome: any;

// `npm run test:e2e` builds first. The extension is loaded from apps/extension/dist/chrome-mv3.
const EXTENSION = resolve(import.meta.dirname, '../../apps/extension/dist/chrome-mv3');
const LEVER_URL = 'https://jobs.lever.co/contoso/6ed76ce8-4156-4b60-b120-403538bd66cd';
const LEVER_FIXTURE = readFileSync(resolve(import.meta.dirname, '../fixtures/lever.html'), 'utf8');

let context: BrowserContext;
let server: Server;
let worker: Worker;
let extensionId: string;
const geminiPrompts: string[] = [];
/** Requests asking which profile fact answers a question no rule recognised. */
const mappingPrompts: string[] = [];
let resumeUploads = 0;
const wordingPrompts: string[] = [];

function openSslExecutable(): string {
  if (process.platform !== 'win32') return 'openssl';
  const gitOpenSsl = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .filter((root): root is string => Boolean(root))
    .map((root) => join(root, 'Git', 'usr', 'bin', 'openssl.exe'))
    .find(existsSync);
  // Git for Windows ships OpenSSL, but its usr/bin folder is not always on PATH in PowerShell.
  return gitOpenSsl ?? 'openssl.exe';
}

/** A one-page text PDF. Each row is [left text, right-aligned text?], like a typical resume. */
function makeResumePdf(rows: [string, string?][]): Buffer {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  let y = 760;
  const ops = rows
    .map(([left, right]) => {
      const out = [`BT /F1 11 Tf 50 ${y} Td (${esc(left)}) Tj ET`];
      if (right) out.push(`BT /F1 11 Tf 430 ${y} Td (${esc(right)}) Tj ET`);
      y -= 16;
      return out.join('\n');
    })
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// Fictional resume used for setup.
const RESUME_PDF = makeResumePdf([
  ['Jordan Rivera'],
  ['San Francisco, CA | 415-555-0100 | jordan@example.com | github.com/jordanrivera'],
  ['EDUCATION'],
  ['University of California, Berkeley', 'Berkeley, CA'],
  ['Bachelor of Science in Computer Science', 'Aug 2022 - May 2026'],
  ['EXPERIENCE'],
  ['Software Engineering Intern', 'Jun 2025 - Present'],
  ['Acme Corp', 'San Francisco, CA'],
  ['- Built a billing dashboard in React used by 40 support agents.'],
  ['SKILLS'],
  ['Languages: TypeScript, React, Python'],
]);
// What the mocked Gemini "reads" from the uploaded resume.
const RESUME_REPLY = {
  firstName: 'Jordan',
  lastName: 'Rivera',
  email: 'jordan@example.com',
  phone: '415-555-0100',
  city: 'San Francisco',
  state: 'CA',
  country: 'United States',
  github: 'github.com/jordanrivera',
  currentTitle: 'Software Engineering Intern',
  education: [{ school: 'University of California, Berkeley', degree: 'Bachelor of Science', major: 'Computer Science', startDate: '2022-08', endDate: '2026' }],
  experience: [{ title: 'Software Engineering Intern', company: 'Acme Corp', current: true, bullets: '• Built a billing dashboard in React' }],
  skills: ['TypeScript', 'React'],
};
// Set SCREENSHOTS=<dir> to save screenshots of each screen.
const shot = async (page: Page, name: string) => {
  if (process.env.SCREENSHOTS) await page.screenshot({ path: join(process.env.SCREENSHOTS, `${name}.png`), fullPage: true });
};

test.beforeAll(async () => {
  // Hermetic by DNS: jobs.lever.co resolves to a local HTTPS server serving the saved form, and every
  // other hostname fails to resolve. (Playwright routing alone misses the first navigation of a tab
  // the extension opens.) The service worker's Gemini and Lever API calls are mocked with routes below.
  const dir = mkdtempSync(join(tmpdir(), 'jaf-e2e-'));
  execFileSync(openSslExecutable(), ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=jobs.lever.co',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
    if (req.url?.includes('/apply')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(LEVER_FIXTURE);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;

  process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      `--host-resolver-rules=MAP jobs.lever.co:443 127.0.0.1:${port}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`,
      '--ignore-certificate-errors',
    ],
  });
  await context.route('https://api.lever.co/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ descriptionPlain: 'Support the team with scheduling and operations.', lists: [] }),
    }),
  );
  await context.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const body = route.request().postDataJSON();
    const parts = body?.contents?.[0]?.parts ?? [];
    const isResume = parts.some((p: any) => p.inline_data?.mime_type === 'application/pdf');
    let reply: object = { name: 'models/gemini-flash-latest' };
    if (isResume) {
      resumeUploads++;
      reply = { candidates: [{ content: { parts: [{ text: JSON.stringify(RESUME_REPLY) }] } }] };
    } else if (body && /^Suggest up to five alternative wordings/.test(parts[0]?.text ?? '')) {
      wordingPrompts.push(parts[0].text);
      reply = { candidates: [{ content: { parts: [{ text: JSON.stringify(['How did you learn about this position?', 'Are you authorized to work in the US?']) }] } }] };
    } else if (body && /^You match job application form questions/.test(parts[0]?.text ?? '')) {
      mappingPrompts.push(parts[0].text);
      reply = { candidates: [{ content: { parts: [{ text: '[]' }] } }] };
    } else if (body) {
      geminiPrompts.push(parts[0].text);
      reply = { candidates: [{ content: { parts: [{ text: 'I led the Acme billing dashboard project and loved it.' }] } }] };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  server?.close();
});

async function onboardingPage(): Promise<Page> {
  const url = `chrome-extension://${extensionId}/onboarding.html`;
  const existing = context.pages().find((p) => p.url() === url);
  if (existing) return existing;
  return context.waitForEvent('page', { predicate: (p) => p.url() === url, timeout: 10_000 });
}

test('pins the extension ID used for the Google OAuth client', () => {
  expect(extensionId).toBe('kjepjmmbimmbpdfinkippakkmhbglccc');
});

test('onboarding reads the resume into the profile, then collects the rest', async () => {
  const page = await onboardingPage();
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.getByText('Apply faster, stay in control.')).toBeVisible();
  await shot(page, 'onboarding-welcome');
  await page.getByRole('button', { name: 'Get started' }).click();

  // Resume
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'Jordan Rivera Resume.pdf',
    mimeType: 'application/pdf',
    buffer: RESUME_PDF,
  });
  await expect(page.getByText('Jordan Rivera Resume.pdf')).toBeVisible();

  // The resume is read on this computer: no Gemini key needed, nothing sent anywhere.
  const started = Date.now();
  await page.getByRole('button', { name: 'Fill my profile from resume' }).click();
  await expect(page.getByText(/Filled from your resume: first name, last name, email/)).toBeVisible();
  expect(Date.now() - started).toBeLessThan(5000);
  expect(resumeUploads).toBe(0);
  await expect(page.getByText(/Couldn’t find your/)).toHaveCount(0);
  await shot(page, 'onboarding-resume');
  await page.getByRole('button', { name: 'Continue' }).click();

  // About you arrives pre-filled from the resume.
  await expect(page.getByLabel('First name')).toHaveValue('Jordan');
  await expect(page.getByLabel('Last name')).toHaveValue('Rivera');
  await expect(page.getByLabel('Email')).toHaveValue('jordan@example.com');
  await expect(page.getByLabel('Phone')).toHaveValue('415-555-0100');
  await expect(page.getByLabel('City')).toHaveValue('San Francisco');
  await expect(page.getByLabel('State')).toHaveValue('CA');
  await expect(page.getByLabel('Current position')).toHaveValue('Software Engineering Intern');
  await expect(page.getByLabel('GitHub')).toHaveValue('https://github.com/jordanrivera');
  await shot(page, 'onboarding-about');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Education, experience, and skills too.
  await expect(page.getByLabel('School', { exact: false }).first()).toHaveValue('University of California, Berkeley');
  await expect(page.getByLabel('Degree type')).toHaveValue("Bachelor's Degree");
  await expect(page.getByLabel('Field of study / discipline')).toHaveValue('Computer Science');
  await expect(page.getByLabel('End (or expected)')).toHaveValue('2026-05');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Software Engineering Intern');
  await expect(page.getByLabel('Company')).toHaveValue('Acme Corp');
  await expect(page.getByLabel('Skills')).toHaveValue('TypeScript, React, Python');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Common questions
  await page.getByLabel('Authorized to work in the US?').selectOption('yes');
  await page.getByLabel('Need sponsorship now or in the future?').selectOption('no');
  await page.getByLabel('Gender').selectOption('Female');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Connect: Gemini key is tested against the (mocked) API before it is saved.
  await page.getByLabel('API key').fill('test-key');
  await page.getByRole('button', { name: 'Save and test' }).click();
  await expect(page.getByText('Connected. Gemini will write your free responses.')).toBeVisible();
  await expect(page.getByText(/Google sign-in is not configured/)).toBeVisible();
  await shot(page, 'onboarding-connect');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Prompt, then done
  await expect(page.getByText('Free-response prompt')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('You’re set up.')).toBeVisible();

  // UI pages can tell a key exists but never read it back.
  const visible = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'getPublicSettings' }));
  expect(visible.hasGeminiKey).toBe(true);
  expect(JSON.stringify(visible)).not.toContain('test-key');
});

test('a pasted Lever link opens, fills, and waits for review without submitting', async () => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByLabel('Job link').fill(LEVER_URL);

  const opened = context.waitForEvent('page', { predicate: (p) => p.url().includes('/apply') });
  await panel.getByRole('button', { name: 'Open and fill' }).click();
  const form = await opened;
  await form.evaluate(() => {
    (window as any).__submits = 0;
    window.addEventListener('submit', () => (window as any).__submits++, true);
  });

  // The overlay card appears when the fill is done.
  await expect
    .poll(async () => form.locator('[data-jaf-state]').count(), { timeout: 30_000 })
    .toBeGreaterThan(8);
  await expect.poll(() => form.locator('textarea[data-jaf-state="ai"]').count(), { timeout: 30_000 }).toBe(2);

  expect(await form.inputValue('input[name="name"]')).toBe('Jordan Rivera');
  expect(await form.inputValue('input[name="email"]')).toBe('jordan@example.com');
  expect(await form.inputValue('input[name="org"]')).toBe('Acme Corp');
  expect(await form.inputValue('input[name="urls[GitHub]"]')).toBe('https://github.com/jordanrivera');
  expect(await form.inputValue('select[name="eeo[gender]"]')).toBe('Female');
  expect(await form.inputValue('select[name="eeo[race]"]')).toBe('Decline to self-identify');
  const resumeName = await form.evaluate(
    () => (document.querySelector('input[name="resume"]') as HTMLInputElement).files?.[0]?.name,
  );
  expect(resumeName).toBe('Jordan Rivera Resume.pdf');
  const radioChecked = await form.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input[type=radio]:checked')).map((r) => r.value),
  );
  expect(radioChecked.slice(0, 2)).toEqual(['Yes', 'No']);
  expect(await form.inputValue('textarea >> nth=0')).toContain('Acme billing dashboard');

  // Gemini got the question, company, role, and description, and nothing from the EEO section.
  expect(geminiPrompts.length).toBe(2);
  expect(geminiPrompts[0]).toContain('Contoso Labs');
  expect(geminiPrompts[0]).toContain('Support the team with scheduling');
  expect(geminiPrompts.join('\n')).not.toMatch(/Female|jordan@example.com|415-555/);
  // Field matching sends question wording only, never the person's answers.
  expect(mappingPrompts.join('\n')).not.toMatch(/Jordan|Female|jordan@example.com|415-555/);

  // Required questions the profile cannot answer are outlined red, and nothing was submitted.
  // AI answers are outlined as they are written; red outlines come from the final verify pass, a moment later.
  await expect.poll(() => form.locator('[data-jaf-state="missing"]').count(), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(await form.evaluate(() => (window as any).__submits)).toBe(0);
  expect(form.url()).toContain('/apply');
  await form.setViewportSize({ width: 1100, height: 900 });
  await form.waitForTimeout(1200);
  await shot(form, 'filled-form');

  // Side panel shows it as ready; marking it submitted updates the record.
  await panel.bringToFront();
  await panel.setViewportSize({ width: 380, height: 760 });
  const row = panel.getByRole('listitem').filter({ hasText: 'Administrative Business Partner' });
  await expect(row).toContainText('Contoso Labs');
  await expect(row).toContainText('Ready for review');
  await shot(panel, 'sidepanel');
  const apps = await panel.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'markSubmitted', applicationId: 1 });
    return true;
  });
  expect(apps).toBe(true);
  await expect(row).toContainText('Submitted');

  // Pasting the same job again warns before filling twice.
  await panel.getByLabel('Job link').fill(`${LEVER_URL}/apply`);
  await panel.getByRole('button', { name: 'Open and fill' }).click();
  await expect(panel.getByText(/You already filled this job/)).toBeVisible();
});

test('remembered mappings are taught in the panel, persisted, reused, edited and removed', async () => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const form = await context.newPage();
  await form.goto(`${LEVER_URL}/apply?remembered=1`);
  await form.evaluate(() => {
    const field = document.createElement('div');
    field.innerHTML = '<label for="learn-source">Application discovery channel*</label><select id="learn-source" required><option value="">Select…</option><option>Company website</option><option>Referral</option></select>';
    document.querySelector('form')!.appendChild(field);
  });
  await form.bringToFront();
  expect(await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }))).toMatchObject({ ok: true });
  await expect(form.locator('#learn-source')).toHaveAttribute('data-jaf-state', 'missing', { timeout: 30_000 });
  const missing = panel.getByRole('list', { name: 'Questions to review', exact: true }).getByRole('listitem').filter({ hasText: 'Application discovery channel' });
  await expect(missing.getByRole('button', { name: 'Remember answer', exact: true })).toHaveClass(/bg-white/);
  await form.locator('#learn-source').selectOption('Company website');
  await expect(missing).toContainText('Answer entered');
  await expect(missing.getByRole('button', { name: 'Save this answer', exact: true })).toHaveClass(/bg-indigo-600/);
  await form.locator('#learn-source').selectOption('');
  await expect(missing.getByRole('button', { name: 'Remember answer', exact: true })).toHaveClass(/bg-white/);
  await form.locator('#learn-source').selectOption('Company website');
  await expect(missing.getByRole('button', { name: 'Save this answer', exact: true })).toBeVisible();
  await panel.setViewportSize({ width: 380, height: 1000 });
  await shot(panel, 'answered-save-cue');
  if (process.env.SCREENSHOTS) await missing.screenshot({ path: join(process.env.SCREENSHOTS, 'save-this-answer-button.png') });
  await missing.getByRole('button', { name: 'Save this answer' }).click();
  await expect(panel.getByLabel('Your answer')).toHaveValue('Company website');
  await panel.getByLabel('Where should this answer be reused?').selectOption('all');
  await panel.getByText('Improve future matching', { exact: true }).click();
  await panel.getByRole('button', { name: 'Add wording', exact: true }).click();
  await panel.getByLabel('Question wording 1', { exact: true }).fill('How did you discover this opening?');
  await panel.setViewportSize({ width: 380, height: 1000 });
  await shot(panel, 'remembered-editor');
  await panel.getByRole('button', { name: 'Save & apply' }).click();
  await expect(panel.getByText('Saved for future applications.', { exact: false })).toBeVisible();

  // Reload the extension UI: the mapping must live in IndexedDB, not React state or worker globals.
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html#memories`);
  await expect(settings.getByRole('listitem').filter({ hasText: 'Application discovery channel' })).toContainText('Company website');
  await settings.reload();
  await expect(settings.getByRole('listitem').filter({ hasText: 'Application discovery channel' })).toContainText('How did you discover this opening?');
  await settings.setViewportSize({ width: 1000, height: 800 });
  await shot(settings, 'knowledge-base');

  // Reuse the approved alternate wording on a fresh form.
  await form.reload();
  await form.evaluate(() => {
    const field = document.createElement('div');
    field.innerHTML = '<label for="learn-source">How did you discover this opening?*</label><select id="learn-source" required><option value="">Select…</option><option>Company website</option><option>Referral</option></select>';
    document.querySelector('form')!.appendChild(field);
    (window as any).__submits = 0;
    window.addEventListener('submit', () => (window as any).__submits++, true);
  });
  await form.bringToFront();
  expect(await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }))).toMatchObject({ ok: true });
  await expect(form.locator('#learn-source')).toHaveValue('Company website', { timeout: 30_000 });
  await expect(form.locator('#learn-source')).toHaveAttribute('data-jaf-state', 'filled', { timeout: 30_000 });

  // Changing the page answer survives another fill.
  await form.locator('#learn-source').selectOption('Referral');
  await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.locator('#learn-source')).toHaveValue('Referral');
  expect(await form.evaluate(() => (window as any).__submits)).toBe(0);

  // Edits persist and re-teaching the same primary question does not duplicate rows.
  await settings.getByRole('listitem').filter({ hasText: 'Application discovery channel' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await settings.getByLabel('Your answer').fill('Referral');
  await settings.getByRole('button', { name: 'Save memory' }).click();
  await expect(settings.getByRole('listitem').filter({ hasText: 'Application discovery channel' })).toContainText('Referral');
  const saved = await settings.evaluate(() => chrome.runtime.sendMessage({
    type: 'saveRememberedMapping', mapping: {
      question: 'Application discovery channel', aliases: ['How did you discover this opening?'], scope: 'all',
      target: { kind: 'answer', value: 'Referral' },
    },
  }));
  expect(saved).toMatchObject({ ok: true });
  await settings.reload();
  await expect(settings.getByRole('listitem').filter({ hasText: 'Application discovery channel' })).toHaveCount(1);

  // Only trusted extension pages can create mappings; malformed targets are rejected.
  const rejected = await settings.evaluate(() => chrome.runtime.sendMessage({
    type: 'saveRememberedMapping', mapping: {
      question: 'Invalid target', aliases: [], scope: 'all', target: { kind: 'profile', key: '__proto__' },
    },
  }));
  expect(rejected).toMatchObject({ ok: false });
  const unrelatedRead = await settings.evaluate(() => chrome.runtime.sendMessage({
    type: 'getRememberedMappings', questions: ['Application discovery channel'],
  }));
  expect(unrelatedRead).toMatchObject({ ok: false });
  await settings.getByRole('listitem').filter({ hasText: 'Application discovery channel' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await settings.getByRole('button', { name: 'Delete memory', exact: true }).click();
  await expect(settings.getByText('No memories yet.', { exact: false })).toBeVisible();
  await settings.reload();
  await expect(settings.getByRole('listitem').filter({ hasText: 'Application discovery channel' })).toHaveCount(0);
});

test('saved meanings match new question and option wording locally, with scope and stale capture checks', async () => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const form = await context.newPage();
  await form.goto(`${LEVER_URL}/apply?semantic=1`);
  async function inject(label: string, options = ['Company website', 'Referral']) {
    await form.evaluate(({ label, options }) => {
      document.querySelector('#semantic-field')?.remove();
      const wrapper = document.createElement('div'); wrapper.id = 'semantic-field';
      const l = document.createElement('label'); l.htmlFor = 'semantic-choice'; l.textContent = `${label}*`;
      const select = document.createElement('select'); select.id = 'semantic-choice'; select.required = true;
      for (const choice of ['', ...options]) select.add(new Option(choice || 'Select…', choice));
      wrapper.append(l, select); document.querySelector('form')!.append(wrapper);
    }, { label, options });
  }
  const q = 'Which channel led you to this opening?';
  await inject(q);
  await form.bringToFront();
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  const card = panel.getByRole('list', { name: 'Questions to review', exact: true }).getByRole('listitem').filter({ hasText: q });
  await card.getByRole('button', { name: 'Remember answer', exact: true }).click();
  await panel.getByLabel('Your answer').selectOption('Company website');
  await panel.getByLabel('Where should this answer be reused?').selectOption('all');
  // Editing the page after capture must not be overwritten, even when the save itself succeeds.
  await form.locator('#semantic-choice').selectOption('Referral');
  await panel.getByRole('button', { name: 'Save & apply' }).click();
  await expect(panel.getByText('Answer saved, but could not apply:', { exact: false })).toBeVisible();
  await expect(form.locator('#semantic-choice')).toHaveValue('Referral');

  await form.reload();
  const variant = 'Which channel brought you to this opening?';
  await inject(variant);
  await form.bringToFront();
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  const suggestion = panel.getByRole('list', { name: 'Questions to review', exact: true }).getByRole('listitem').filter({ hasText: variant });
  await suggestion.getByRole('button', { name: 'Review suggestion' }).click();
  await panel.getByRole('button', { name: 'Save & apply' }).click();
  await expect(form.locator('#semantic-choice')).toHaveValue('Company website', { timeout: 30_000 });
  await form.reload(); await inject(variant);
  await form.bringToFront(); await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.locator('#semantic-choice')).toHaveValue('Company website', { timeout: 30_000 });

  // A confirmed meaning can handle a new wording AND option synonym without Gemini.
  const learned = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'saveRememberedMapping', mapping: {
    question: 'How did you hear about this job?', aliases: [], scope: 'all',
    target: { kind: 'answer', value: 'Company website' }, meaning: { intent: 'source', qualifier: '', negative: false },
  } }));
  expect(learned).toMatchObject({ ok: true });
  await form.reload(); await inject('Where did you discover this opportunity?', ['Careers page', 'Referral']);
  await form.bringToFront(); await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.locator('#semantic-choice')).toHaveValue('Careers page', { timeout: 30_000 });
  await expect(form.locator('#semantic-choice')).toHaveAttribute('data-jaf-state', 'filled', { timeout: 30_000 });

  // A scope on one exact application cannot affect another application URL.
  const scoped = await panel.evaluate(url => chrome.runtime.sendMessage({ type: 'saveRememberedMapping', mapping: {
    question: 'Which internal team recommended this role?', aliases: [], scope: `application:${url}`,
    target: { kind: 'answer', value: 'Referral' },
  } }), `${LEVER_URL}/apply?semantic=1`);
  expect(scoped).toMatchObject({ ok: true });
  await form.goto(`${LEVER_URL}/apply?semantic=2`); await inject('Which internal team recommended this role?');
  await form.bringToFront(); await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.locator('#semantic-choice')).toHaveAttribute('data-jaf-state', 'missing', { timeout: 30_000 });
  await expect(form.locator('#semantic-choice')).toHaveValue('');
  await panel.getByRole('list', { name: 'Questions to review', exact: true }).getByRole('listitem').filter({ hasText: 'Which internal team recommended' }).getByRole('button', { name: 'Remember answer' }).click();
  await panel.setViewportSize({ width: 380, height: 1100 });
  await shot(panel, 'simpler-remember-answer');
});

test('saves React-select answers and reuses both one-chip and multiple-chip lists', async () => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const form = await context.newPage();
  await form.goto(`${LEVER_URL}/apply?clearance-chip=1`);
  async function inject(question = 'Active Security Clearance(s)', choices = ['Never held a clearance', 'Secret', 'DOE Q']) {
    await form.evaluate(({ question, choices }) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = '<label for="chip-clearance">Active Security Clearance(s)*</label><div class="select__container"><div class="select__control"><input id="chip-clearance" role="combobox" aria-expanded="false" aria-multiselectable="true" required></div></div>';
      wrapper.querySelector('label')!.textContent = `${question}*`;
      document.querySelector('form')!.append(wrapper);
      const input = wrapper.querySelector('input')!, control = wrapper.querySelector('.select__control')!;
      input.addEventListener('mousedown', () => {
        if (control.querySelector('[role="listbox"]')) return;
        const menu = document.createElement('div'); menu.setAttribute('role', 'listbox');
        for (const label of choices) {
          const option = document.createElement('div'); option.setAttribute('role', 'option'); option.textContent = label;
          option.onclick = () => {
            const chip = document.createElement('div'); chip.className = 'select__multi-value';
            const text = document.createElement('span'); text.className = 'select__multi-value__label'; text.textContent = label;
            const remove = document.createElement('span'); remove.className = 'select__multi-value__remove'; remove.setAttribute('role', 'button'); remove.setAttribute('aria-label', `Remove ${label}`); remove.textContent = '×';
            remove.onclick = () => { chip.remove(); input.dispatchEvent(new Event('change', { bubbles: true })); };
            chip.append(text, remove); control.prepend(chip); menu.remove(); input.value = ''; input.setAttribute('aria-expanded', 'false');
            input.dispatchEvent(new Event('change', { bubbles: true }));
          };
          menu.append(option);
        }
        input.setAttribute('aria-expanded', 'true'); control.append(menu);
      });
    }, { question, choices });
  }
  await inject();
  await form.bringToFront();
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.locator('.select__control')).toHaveAttribute('data-jaf-state', 'missing', { timeout: 30_000 });
  await form.locator('#chip-clearance').click();
  await form.getByRole('option', { name: 'Never held a clearance', exact: true }).click();
  const card = panel.getByRole('list', { name: 'Questions to review', exact: true }).getByRole('listitem').filter({ hasText: 'Active Security Clearance(s)' });
  await card.getByRole('button', { name: 'Save these answers', exact: true }).click();
  await expect(panel.getByLabel('Selected answer 1', { exact: true })).toHaveValue('Never held a clearance');
  await expect(panel.getByText('Choose an answer from the dropdown before saving.', { exact: false })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Save & apply', exact: true }).click();
  await expect(panel.getByText('Saved for future applications.', { exact: false })).toBeVisible();
  await expect(form.locator('.select__multi-value__label')).toHaveText('Never held a clearance');
  await expect(form.locator('.select__multi-value')).toHaveCount(1);
  await form.reload(); await inject();
  await form.bringToFront(); await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.locator('.select__multi-value__label')).toHaveText('Never held a clearance', { timeout: 30_000 });
  await expect(form.locator('.select__multi-value')).toHaveCount(1);
  await expect(form.locator('#chip-clearance')).toHaveValue('');
  await form.reload(); await inject('Fictional coding tools', ['Python', 'TS', 'SQL']);
  await form.bringToFront(); await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.locator('.select__control')).toHaveAttribute('data-jaf-state', 'missing', { timeout: 30_000 });
  for (const label of ['Python', 'TS']) {
    await form.locator('#chip-clearance').click(); await form.getByRole('option', { name: label, exact: true }).click();
  }
  const multiple = panel.getByRole('list', { name: 'Questions to review', exact: true }).getByRole('listitem').filter({ hasText: 'Fictional coding tools' });
  await multiple.getByRole('button', { name: 'Save these answers', exact: true }).click();
  await expect(panel.getByLabel('Selected answer 1', { exact: true })).toHaveValue('TS');
  await expect(panel.getByLabel('Selected answer 2', { exact: true })).toHaveValue('Python');
  await panel.getByRole('button', { name: 'Save & apply', exact: true }).click();
  await expect(panel.getByText('Saved for future applications.', { exact: false })).toBeVisible();
  await form.reload(); await inject('Fictional coding tools', ['SQL', 'TS', 'Python']);
  await form.bringToFront(); await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.locator('.select__multi-value__label')).toHaveCount(2, { timeout: 30_000 });
  expect((await form.locator('.select__multi-value__label').allTextContents()).sort()).toEqual(['Python', 'TS']);
  await expect(form.locator('.select__control')).toHaveAttribute('data-jaf-state', 'filled');
  await expect(form.locator('#chip-clearance')).toHaveValue('');
});

test('Save all confirms native, checkbox and text answers together, persists them and reuses every choice', async () => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.setViewportSize({ width: 420, height: 1000 });
  // Opening a new tab invalidates the panel's current-tab capture. Keep this observer tab
  // open before starting the application so checking storage does not abandon the review.
  const settings = await context.newPage(); await settings.goto(`chrome-extension://${extensionId}/options.html#memories`);
  const form = await context.newPage();
  await form.goto(`${LEVER_URL}/apply?batch=1`);
  const inject = async () => form.evaluate(() => {
    document.querySelector('form')!.innerHTML = `<label for="languages">Tools used professionally*</label><select id="languages" multiple required><option>Python</option><option>TS</option><option>SQL</option></select>
      <fieldset><legend>Preferred fictional office regions*</legend><label><input type="checkbox" name="regions" value="North" required>North</label><label><input type="checkbox" name="regions" value="West">West</label><label><input type="checkbox" name="regions" value="East">East</label></fieldset>
      <label for="batch-code">Fictional project reference*</label><input id="batch-code" required>
      <label for="leave-empty">Untouched fictional question*</label><input id="leave-empty" required>`;
  });
  await inject(); await form.bringToFront();
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  const saveAll = panel.getByRole('button', { name: /^Save all answered questions/ });
  await expect(form.locator('#languages')).toHaveAttribute('data-jaf-state', 'missing', { timeout: 30_000 });
  await expect(form.locator('#batch-code')).toHaveAttribute('data-jaf-state', 'missing', { timeout: 30_000 });
  await expect(panel.getByRole('list', { name: 'Questions to review', exact: true }).getByRole('listitem').filter({ hasText: 'Fictional project reference' })).toBeVisible();
  await expect(saveAll).toBeDisabled({ timeout: 30_000 });
  await form.locator('#languages').selectOption(['Python', 'TS']);
  await form.getByLabel('North', { exact: true }).check(); await form.getByLabel('West', { exact: true }).check();
  await form.locator('#batch-code').fill('Synthetic reference');
  await expect(saveAll).toHaveText('Save all answered questions (3)');
  await saveAll.click();
  const review = panel.getByRole('region', { name: 'Review answers to remember' });
  await expect(review).toContainText('Python · TS');
  await expect(review).toContainText('North · West');
  await expect(review.getByLabel('Untouched fictional question')).toHaveCount(0);
  await review.getByLabel('Reuse answers for question 1').selectOption('all');
  await review.getByLabel('Reuse answers for question 2').selectOption('all');
  await review.getByLabel('Reuse answers for question 3').selectOption('all');
  await shot(panel, 'save-all-review');
  // All captured snapshots must be current; one changed answer prevents the entire save.
  await form.locator('#batch-code').fill('Changed synthetic reference');
  await review.getByRole('button', { name: 'Remember 3 answered questions' }).click();
  await expect(review.getByRole('alert')).toContainText('page answer changed');
  await settings.reload();
  await expect(settings.getByRole('listitem').filter({ hasText: 'Tools used professionally' })).toHaveCount(0);
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await saveAll.click();
  for (const index of [1, 2, 3]) await review.getByLabel(`Reuse answers for question ${index}`).selectOption('all');
  await review.getByRole('button', { name: 'Remember 3 answered questions' }).click();
  await expect(panel.getByText('3 questions remembered.', { exact: false })).toBeVisible();
  await expect(form.locator('#batch-code')).toHaveValue('Changed synthetic reference');
  await settings.reload();
  const tools = settings.getByRole('listitem').filter({ hasText: 'Tools used professionally' });
  await expect(tools).toContainText('2 remembered selections');
  await expect(tools).toContainText('Python · TS');
  await tools.getByRole('button', { name: 'Edit', exact: true }).click();
  await settings.getByText('Improve future matching', { exact: true }).click();
  await settings.getByRole('button', { name: 'Add label for answer 2', exact: true }).click();
  await settings.getByLabel('Answer 2 label 1', { exact: true }).fill('TypeScript');
  await settings.getByRole('button', { name: 'Save memory', exact: true }).click();
  await form.reload(); await inject();
  await form.evaluate(() => document.querySelectorAll('#languages option')[1]!.textContent = 'TypeScript');
  await form.bringToFront(); await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.locator('#batch-code')).toHaveValue('Changed synthetic reference', { timeout: 30_000 });
  await expect.poll(() => form.locator('#languages').evaluate((s: HTMLSelectElement) => [...s.selectedOptions].map(o => o.text))).toEqual(['Python', 'TypeScript']);
  await expect(form.getByLabel('North', { exact: true })).toBeChecked(); await expect(form.getByLabel('West', { exact: true })).toBeChecked();
  await expect(form.getByLabel('East', { exact: true })).not.toBeChecked();
  // A missing saved choice must leave the initially empty group alone.
  await form.reload(); await inject(); await form.evaluate(() => document.querySelectorAll('#languages option')[1]!.remove());
  await form.bringToFront(); await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.locator('#languages')).toHaveAttribute('data-jaf-state', 'missing', { timeout: 30_000 });
  await expect.poll(() => form.locator('#languages').evaluate((s: HTMLSelectElement) => s.selectedOptions.length)).toBe(0);
  await expect(panel.getByRole('list', { name: 'Questions to review', exact: true }).getByRole('listitem').filter({ hasText: 'Tools used professionally' })).toContainText('unavailable');
});

test('bulk conflicts roll back all new mappings and allow excluding the conflicting question', async () => {
  const settings = await context.newPage(); await settings.goto(`chrome-extension://${extensionId}/options.html#memories`);
  const tools = settings.getByRole('listitem').filter({ hasText: 'Tools used professionally' });
  await tools.getByRole('button', { name: 'Edit', exact: true }).click();
  await settings.getByLabel('Selected answer 1', { exact: true }).fill('Unavailable fictional choice');
  await settings.getByRole('button', { name: 'Save memory', exact: true }).click();
  const panel = await context.newPage(); await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const form = await context.newPage(); await form.goto(`${LEVER_URL}/apply?batch-conflict=1`);
  await form.evaluate(() => {
    document.querySelector('form')!.innerHTML = '<label for="first">Unique atomic batch reference*</label><input id="first" required><label for="tools">Tools used professionally*</label><select id="tools" multiple required><option>Python</option><option>TS</option></select>';
  });
  await form.bringToFront(); await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.locator('#tools')).toHaveAttribute('data-jaf-state', 'missing', { timeout: 30_000 });
  await form.locator('#first').fill('Atomic synthetic answer'); await form.locator('#tools').selectOption(['Python', 'TS']);
  await panel.getByRole('button', { name: 'Save all answered questions (2)' }).click();
  const review = panel.getByRole('region', { name: 'Review answers to remember' });
  for (const index of [1, 2]) await review.getByLabel(`Reuse answers for question ${index}`).selectOption('all');
  await review.getByRole('button', { name: 'Remember 2 answered questions' }).click();
  await expect(review.getByRole('alert')).toContainText('different memory');
  await settings.reload(); await expect(settings.getByRole('listitem').filter({ hasText: 'Unique atomic batch reference' })).toHaveCount(0);
  await review.getByLabel('Tools used professionally', { exact: true }).uncheck();
  await review.getByRole('button', { name: 'Remember 1 answered question', exact: true }).click();
  await expect(panel.getByText('1 question remembered.', { exact: false })).toBeVisible();
  await settings.reload(); await expect(settings.getByRole('listitem').filter({ hasText: 'Unique atomic batch reference' })).toContainText('Atomic synthetic answer');
  // Two identical question/answer pairs in one batch create one durable mapping.
  await form.reload(); await form.evaluate(() => {
    document.querySelector('form')!.innerHTML = '<label for="duplicate-one">Duplicate fictional reference*</label><input id="duplicate-one" required><label for="duplicate-two">Duplicate fictional reference*</label><input id="duplicate-two" required>';
  });
  await form.bringToFront(); await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.locator('#duplicate-two')).toHaveAttribute('data-jaf-state', 'missing', { timeout: 30_000 });
  await form.locator('#duplicate-one').fill('Same synthetic answer'); await form.locator('#duplicate-two').fill('Same synthetic answer');
  await panel.getByRole('button', { name: 'Save all answered questions (2)' }).click();
  for (const index of [1, 2]) await review.getByLabel(`Reuse answers for question ${index}`).selectOption('all');
  await review.getByRole('button', { name: 'Remember 2 answered questions' }).click();
  await expect(panel.getByText('1 question remembered.', { exact: false })).toBeVisible();
  await settings.reload(); await expect(settings.getByRole('listitem').filter({ hasText: 'Duplicate fictional reference' })).toHaveCount(1);
});


test('Memories supports visible inline editing, useful search and confirmed deletion without leaving the sidebar', async () => {
  const settings = await context.newPage(); await settings.goto(`chrome-extension://${extensionId}/options.html#knowledge`);
  await expect(settings).toHaveURL(/#memories$/); // Old bookmarks still work.
  await expect(settings.getByRole('button', { name: 'Memories', exact: true })).toHaveAttribute('aria-current', 'page');
  const seeded = await settings.evaluate(async () => {
    const ids: number[] = [];
    for (let i = 1; i <= 22; i++) {
      const result = await chrome.runtime.sendMessage({ type: 'saveRememberedMapping', mapping: {
        question: `UX memory question ${String(i).padStart(2, '0')}`, aliases: [], scope: 'all',
        target: { kind: 'answer', value: `Synthetic answer ${i}` },
      } });
      if (!result.ok) throw new Error(result.error);
      ids.push(result.id);
    }
    return ids;
  });
  await settings.setViewportSize({ width: 1000, height: 720 });
  await settings.getByLabel('Search memories').fill('UX memory');
  await settings.getByLabel('Sort by').selectOption('question');
  await expect(settings.getByRole('list', { name: 'Memories', exact: true }).getByRole('listitem')).toHaveCount(22);
  const last = settings.getByRole('listitem').filter({ hasText: 'UX memory question 22' });
  await last.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = last.getByRole('form', { name: 'Edit memory' });
  await expect(editor.getByLabel('Your answer')).toBeFocused();
  expect(await settings.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  const box = await editor.getByLabel('Your answer').boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(720);
  await expect(settings.getByLabel('Search memories')).toBeDisabled();
  await editor.getByLabel('Your answer').fill('Wrong unsaved draft');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(last).toContainText('Synthetic answer 22');
  await expect(last.getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
  await expect(settings.getByRole('status').filter({ hasText: 'Changes canceled.' })).toBeVisible();
  await last.getByRole('button', { name: 'Edit', exact: true }).click();
  await editor.getByLabel('Your answer').fill('Updated synthetic answer');
  await editor.getByRole('button', { name: 'Save memory', exact: true }).click();
  await expect(last).toContainText('Updated synthetic answer');
  await expect(settings.getByText('Memory saved.', { exact: true })).toBeVisible();
  await settings.reload();
  await settings.getByLabel('Search memories').fill('UPDATED question 22');
  await expect(settings.getByRole('list', { name: 'Memories', exact: true }).getByRole('listitem')).toHaveCount(1);
  await settings.getByLabel('Answer type').selectOption('answers');
  await expect(settings.getByText('No memories match these filters.', { exact: false })).toBeVisible();
  await settings.getByRole('button', { name: 'Clear filters' }).click();
  await expect(settings.getByLabel('Search memories')).toHaveValue('');
  await settings.getByLabel('Search memories').fill('UX memory');
  if (process.env.SCREENSHOTS) { await settings.getByLabel('Search memories').fill('UX memory question 22'); await settings.screenshot({ path: join(process.env.SCREENSHOTS, 'memories-search.png') }); await settings.getByLabel('Search memories').fill('UX memory'); }
  await last.getByRole('button', { name: 'Delete', exact: true }).click();
  await last.getByRole('button', { name: 'Keep memory', exact: true }).click();
  await expect(last).toContainText('Updated synthetic answer');
  // An edit stays reachable if another open extension window deletes its record.
  const first = settings.getByRole('listitem').filter({ hasText: 'UX memory question 01' });
  await first.getByRole('button', { name: 'Edit', exact: true }).click();
  await settings.evaluate(id => chrome.runtime.sendMessage({ type: 'removeRememberedMapping', id }), seeded[0]);
  await expect(first.getByRole('form', { name: 'Edit memory' })).toBeVisible();
  await first.getByRole('button', { name: 'Save memory', exact: true }).click();
  await expect(first.getByRole('alert')).toContainText('deleted in another window');
  await first.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(first).toHaveCount(0);

  const panel = await context.newPage(); await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.setViewportSize({ width: 380, height: 760 });
  const form = await context.newPage(); await form.goto(`${LEVER_URL}/apply?memory-management=1`);
  const inject = () => form.evaluate(() => {
    document.querySelector('form')!.innerHTML = '<label for="remembered-ux">UX memory question 22*</label><input id="remembered-ux" required><label for="ux-email">Email*</label><input id="ux-email" type="email" required>';
  });
  await inject(); await form.bringToFront(); await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.locator('#remembered-ux')).toHaveValue('Updated synthetic answer', { timeout: 30_000 });
  const library = panel.getByRole('region', { name: 'Page memories', exact: true });
  const card = library.getByRole('listitem').filter({ hasText: 'UX memory question 22' });
  await expect(card).toBeVisible(); // Completed fields remain manageable.
  await expect(card).toContainText('Last used');
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(card.getByLabel('Your answer')).toBeFocused();
  await card.getByLabel('Your answer').fill('Sidebar correction');
  await card.getByRole('button', { name: 'Save memory', exact: true }).click();
  await expect(library.getByText('Memory saved for future fills.', { exact: false })).toBeVisible();
  await expect(card).toContainText('Last used');
  await expect(form.locator('#remembered-ux')).toHaveValue('Updated synthetic answer');
  await panel.reload(); await form.bringToFront();
  await expect(card).toContainText('Sidebar correction');
  await form.reload(); await inject(); await form.bringToFront(); await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.locator('#remembered-ux')).toHaveValue('Sidebar correction', { timeout: 30_000 });
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await shot(panel, 'memories-sidebar-edit');
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  await card.getByRole('button', { name: 'Delete memory', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(library.getByText('Memory deleted.', { exact: false })).toBeVisible();
  await expect(form.locator('#remembered-ux')).toHaveValue('Sidebar correction');
  await library.getByRole('button', { name: /^All memories/ }).click();
  await library.getByLabel('Search memories').fill('UX memory question 21');
  await expect(library.getByRole('listitem')).toHaveCount(1);
  await settings.reload(); await settings.getByLabel('Search memories').fill('UX memory question 22');
  await expect(last).toHaveCount(0);
  // Do not leak synthetic records into subsequent tests.
  await settings.evaluate(async ids => { for (const id of ids) await chrome.runtime.sendMessage({ type: 'removeRememberedMapping', id }); }, seeded);
});

test('optional AI suggests wordings only after a click and requires individual approval', async () => {
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html#memories`);
  await settings.getByRole('button', { name: 'Add memory' }).click();
  await settings.getByRole('textbox', { name: 'Question', exact: true }).fill('Which recruiting event introduced this team?');
  await settings.getByLabel('Your answer').fill('Synthetic campus fair');
  await settings.getByLabel('Where should this answer be reused?').selectOption('company:');
  await settings.getByLabel('Company name').fill('Contoso Labs');
  await settings.getByRole('button', { name: 'Save memory' }).click();
  const created = settings.getByRole('listitem').filter({ hasText: 'Which recruiting event introduced this team?' });
  await expect(created).toContainText('Company: contoso labs');
  await created.getByRole('button', { name: 'Delete', exact: true }).click();
  await settings.getByRole('button', { name: 'Delete memory', exact: true }).click();
  const count = wordingPrompts.length;
  const card = settings.getByRole('listitem').filter({ hasText: 'How did you hear about this job?' });
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await settings.getByText('Improve future matching', { exact: true }).click();
  await settings.getByText('Get optional AI suggestions', { exact: true }).click();
  expect(wordingPrompts).toHaveLength(count);
  await settings.getByRole('button', { name: 'Suggest question variations' }).click();
  const approval = settings.getByRole('checkbox', { name: 'How did you learn about this position?' });
  await expect(approval).toBeVisible();
  await expect(approval).not.toBeChecked();
  await expect(settings.getByLabel('Question wording 1', { exact: true })).toHaveCount(0);
  expect(wordingPrompts).toHaveLength(count + 1);
  expect(wordingPrompts.at(-1)).not.toContain('jordan@example.com');
  expect(wordingPrompts.at(-1)).not.toContain('Company website');
  await expect(settings.getByRole('checkbox', { name: 'Are you authorized to work in the US?' })).toHaveCount(0);
  await approval.check();
  await settings.getByRole('button', { name: 'Save memory' }).click();
  await settings.reload();
  await card.getByText('Approved variations').click();
  await expect(card).toContainText('How did you learn about this position?');
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await settings.getByText('Improve future matching', { exact: true }).click();
  await settings.getByText('Get optional AI suggestions', { exact: true }).click();
  await context.route('https://generativelanguage.googleapis.com/**', route => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Rate limit', details: [{ retryDelay: '30s' }] } }) }));
  await settings.getByRole('button', { name: 'Suggest question variations' }).click();
  await expect(settings.getByText('Wording suggestions timed out.', { exact: false })).toBeVisible({ timeout: 20000 });
  await settings.getByLabel('Your answer').fill('Company website');
  await settings.getByRole('button', { name: 'Save memory' }).click();
  await expect(settings.getByText('Memory saved.', { exact: true })).toBeVisible();
});

test('guided variations preview real matching and scope, and profile links show the current value', async () => {
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html#memories`);
  await settings.getByRole('button', { name: 'Add memory' }).click();
  await settings.getByRole('textbox', { name: 'Question', exact: true }).fill('Which exam result applies?');
  await settings.getByLabel('Your answer').fill('Not taken');
  await expect(settings.getByRole('button', { name: 'Add wording', exact: true })).not.toBeVisible();
  await settings.getByText('Try a variation', { exact: true }).click();
  await settings.getByLabel('Question to try').fill('Which exam result applies to you?');
  await settings.getByRole('button', { name: 'Check matching', exact: true }).click();
  await expect(settings.getByText('Would ask you to confirm', { exact: true })).toBeVisible();

  await settings.getByText('Improve future matching', { exact: true }).click();
  await settings.getByRole('button', { name: 'Add wording', exact: true }).click();
  await settings.getByLabel('Question wording 1', { exact: true }).fill('Which exam result applies to you?');
  // A changed draft invalidates the previous preview.
  await expect(settings.getByText('Would ask you to confirm', { exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Check matching', exact: true }).click();
  await expect(settings.getByText('Would autofill', { exact: true })).toBeVisible();
  await settings.getByLabel('This question has a dropdown', { exact: true }).check();
  await settings.getByRole('button', { name: 'Add dropdown choice' }).click();
  await settings.getByLabel('Dropdown choice 1', { exact: true }).fill('Did not take');
  await settings.getByRole('button', { name: 'Check matching', exact: true }).click();
  await expect(settings.getByText('Would skip', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Add answer label', exact: true }).click();
  await settings.getByLabel('Answer label 1', { exact: true }).fill('Did not take');
  await settings.getByRole('button', { name: 'Check matching', exact: true }).click();
  await expect(settings.getByText('Would autofill', { exact: true })).toBeVisible();
  await expect(settings.getByText('Answer: Did not take', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Remove answer label 1' }).click();
  await settings.getByRole('button', { name: 'Check matching', exact: true }).click();
  await expect(settings.getByText('Would skip', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Add answer label', exact: true }).click();
  await settings.getByLabel('Answer label 1', { exact: true }).fill('Did not take');
  await settings.getByRole('button', { name: 'Remove question wording 1' }).click();
  await settings.getByRole('button', { name: 'Check matching', exact: true }).click();
  await expect(settings.getByText('Would ask you to confirm', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Add wording', exact: true }).click();
  await settings.getByLabel('Question wording 1', { exact: true }).fill('Which exam result applies to you?');
  await settings.getByLabel('Where should this answer be reused?').selectOption('company:');
  await settings.getByRole('textbox', { name: 'Company name', exact: true }).fill('Contoso Labs');
  await settings.getByLabel('Test another company or application').check();
  await settings.getByLabel('Example company', { exact: true }).fill('Different employer');
  await settings.getByRole('button', { name: 'Check matching', exact: true }).click();
  await expect(settings.getByText('Would skip', { exact: true })).toBeVisible();
  await expect(settings.getByText('This example is outside where you chose to reuse the answer.', { exact: true })).toBeVisible();
  await settings.getByLabel('Example company', { exact: true }).fill('Contoso Labs');
  await settings.getByRole('button', { name: 'Check matching', exact: true }).click();
  await expect(settings.getByText('Would autofill', { exact: true })).toBeVisible();
  await settings.setViewportSize({ width: 1000, height: 950 });
  await shot(settings, 'guided-answer-matching');
  // Trying an invalid example must not block saving a valid actual answer.
  await settings.getByLabel('Example application URL', { exact: true }).fill('invalid example');
  await settings.getByRole('button', { name: 'Check matching', exact: true }).click();
  await expect(settings.getByText('Would skip', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Save memory', exact: true }).click();
  const card = settings.getByRole('listitem').filter({ hasText: 'Which exam result applies?' });
  await expect(card).toBeVisible();
  await settings.reload();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await settings.getByText('Improve future matching', { exact: true }).click();
  await expect(settings.getByLabel('Question wording 1', { exact: true })).toHaveValue('Which exam result applies to you?');
  await expect(settings.getByLabel('Answer label 1', { exact: true })).toHaveValue('Did not take');
  await settings.getByLabel('Use a value from my profile', { exact: false }).check();
  await settings.getByLabel('Use this profile detail', { exact: false }).selectOption('phone');
  await expect(settings.getByText('Current value:', { exact: false })).toContainText('415-555-0100');
  await expect(settings.getByLabel('Answer label 1', { exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Save memory', exact: true }).click();
  await expect(card).toContainText('Linked profile detail');
  await expect(card).toContainText('Phone');
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(settings.getByLabel('Use this profile detail', { exact: false })).toHaveValue('phone');
  await expect(settings.getByText('Current value:', { exact: false })).toContainText('415-555-0100');
  await settings.getByText('Try a variation', { exact: true }).click();
  await settings.getByLabel('Question to try').fill('Which exam result applies?');
  await settings.getByRole('button', { name: 'Check matching', exact: true }).click();
  await expect(settings.getByText('Answer: 415-555-0100', { exact: true })).toBeVisible();
  const profileSettings = await context.newPage();
  await profileSettings.goto(`chrome-extension://${extensionId}/options.html#profile`);
  await profileSettings.getByRole('textbox', { name: 'Phone', exact: true }).fill('415-555-0111');
  await profileSettings.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(settings.getByText('Current value:', { exact: false })).toContainText('415-555-0111');
  await expect(settings.getByText('Would autofill', { exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Check matching', exact: true }).click();
  await expect(settings.getByText('Answer: 415-555-0111', { exact: true })).toBeVisible();
  await profileSettings.close();
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  await settings.getByRole('button', { name: 'Delete memory', exact: true }).click();
});

test('upgrades the actual old IndexedDB schema without losing legacy answers or profile data', async () => {
  // This is the isolated fictional browser profile created by beforeAll, never the person's Chrome profile.
  const raw = await context.newPage();
  await raw.goto(`chrome-extension://${extensionId}/manifest.json`);
  for (const page of context.pages()) if (page !== raw) await page.close();
  const cdp = await context.newCDPSession(raw);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await raw.evaluate(async () => {
    await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase('job-autofill'); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error('Old database is still open')); });
    // Dexie version 2 corresponds to native IndexedDB version 20.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('job-autofill', 20);
      request.onupgradeneeded = () => {
        const d = request.result;
        d.createObjectStore('profile', { keyPath: 'id' });
        d.createObjectStore('files', { keyPath: 'kind' });
        const answers = d.createObjectStore('savedAnswers', { keyPath: 'id', autoIncrement: true }); answers.createIndex('key', 'key', { unique: true }); answers.createIndex('lastUsed', 'lastUsed');
        const fields = d.createObjectStore('fieldMappings', { keyPath: 'id', autoIncrement: true }); fields.createIndex('[platform+label]', ['platform', 'label']);
        const apps = d.createObjectStore('applications', { keyPath: 'id', autoIncrement: true }); for (const k of ['jobKey', 'status', 'tabId', 'filledAt']) apps.createIndex(k, k);
        const remembered = d.createObjectStore('rememberedMappings', { keyPath: 'id', autoIncrement: true }); remembered.createIndex('scope', 'scope'); remembered.createIndex('updatedAt', 'updatedAt');
        remembered.add({ id: 7, schemaVersion: 1, updatedAt: 10, question: 'Legacy channel', aliases: ['Approved old alias'], scope: 'lever', target: { kind: 'answer', value: 'Referral' } });
        request.transaction!.objectStore('profile').put({ id: 'me', firstName: 'Migration', lastName: 'Fixture' });
      };
      request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
    });
  });
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html#memories`);
  await expect(settings.getByRole('listitem').filter({ hasText: 'Legacy channel' })).toContainText('Referral');
  const result = await raw.evaluate(() => new Promise<any>((resolve, reject) => {
    const request = indexedDB.open('job-autofill');
    request.onsuccess = () => {
      const d = request.result;
      const tx = d.transaction(['rememberedMappings', 'profile']);
      const record = tx.objectStore('rememberedMappings').get(7), profile = tx.objectStore('profile').get('me');
      tx.oncomplete = () => { resolve({ version: d.version, record: record.result, profile: profile.result }); d.close(); };
    }; request.onerror = () => reject(request.error);
  }));
  expect(result).toMatchObject({ version: 30, record: { id: 7, schemaVersion: 2, target: { value: 'Referral' }, aliases: ['Approved old alias'] }, profile: { firstName: 'Migration' } });
  expect(result.record.meaning).toBeUndefined();
});
