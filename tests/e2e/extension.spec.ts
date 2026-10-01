import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

declare const chrome: any;

// Later tests exercise the profile created by the onboarding flow.
test.describe.configure({ mode: 'serial' });

// `npm run test:e2e` builds first. The extension is loaded from apps/extension/dist/chrome-mv3.
const EXTENSION = resolve(import.meta.dirname, '../../apps/extension/dist/chrome-mv3');
const LEVER_URL = 'https://jobs.lever.co/contoso/6ed76ce8-4156-4b60-b120-403538bd66cd';
const LEVER_FIXTURE = readFileSync(resolve(import.meta.dirname, '../fixtures/lever.html'), 'utf8');
const GREENHOUSE_FIXTURE = readFileSync(resolve(import.meta.dirname, '../fixtures/greenhouse-dropdowns.html'), 'utf8');
const GREENHOUSE_URL = 'https://job-boards.greenhouse.io/example/jobs/123';

let context: BrowserContext;
let server: Server;
let worker: Worker;
let extensionId: string;
const geminiPrompts: string[] = [];
let resumeUploads = 0;

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
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=jobs.lever.co',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
    if (req.url?.startsWith('/example/jobs/123')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(GREENHOUSE_FIXTURE);
    } else if (req.url?.includes('/apply')) {
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
      `--host-resolver-rules=MAP jobs.lever.co:443 127.0.0.1:${port}, MAP job-boards.greenhouse.io:443 127.0.0.1:${port}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`,
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
  await expect(page.getByLabel('Degree')).toHaveValue('Bachelor of Science');
  await expect(page.getByLabel('End (or expected)')).toHaveValue('2026-05');
  await expect(page.getByLabel('Major')).toHaveValue('Computer Science');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Software Engineering Intern');
  await expect(page.getByLabel('Company')).toHaveValue('Acme Corp');
  await expect(page.getByLabel('Skills')).toHaveValue('TypeScript, React, Python');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Common questions
  await page.getByLabel('Authorized to work in the US?').selectOption('yes');
  await page.getByLabel('Need sponsorship now or in the future?').selectOption('no');
  await page.getByLabel('Willing to relocate?').selectOption('yes');
  await page.getByRole('combobox', { name: 'Gender', exact: true }).selectOption('Female');
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
  expect(await form.inputValue('select[name="eeo[gender]"]')).toBe('');
  expect(await form.inputValue('select[name="eeo[race]"]')).toBe('');
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

  // Required questions the profile cannot answer are outlined red, and nothing was submitted.
  expect(await form.locator('[data-jaf-state="missing"]').count()).toBeGreaterThan(0);
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

test('Greenhouse dropdowns select real options and hide previous failures during a retry', async () => {
  const panel = await context.newPage();
  await panel.goto('chrome-extension://' + extensionId + '/sidepanel.html');
  await panel.getByLabel('Job link').fill(GREENHOUSE_URL);
  const opened = context.waitForEvent('page', { predicate: page => page.url().includes('/example/jobs/123') });
  await panel.getByRole('button', { name: 'Open and fill' }).click();
  const form = await opened;
  await expect(form.getByText('Ready for review', { exact: true })).toBeVisible({ timeout: 30_000 });

  const expected: Record<string, string> = {
    country: 'United States +1',
    'candidate-location': 'San Francisco, California, United States',
    'school--1': 'University of California, Berkeley',
    'degree--1': "Bachelor's Degree",
    'discipline--1': 'Computer Science',
    'end-month--1': 'May',
    authorization: 'Yes',
    relocation: 'Yes',
  };
  for (const [id, text] of Object.entries(expected)) {
    const control = form.locator('input[id="' + id + '"]').locator('xpath=ancestor::div[contains(@class,"select__control")]');
    await expect(control.locator('.select__single-value')).toHaveText(text);
    await expect(control).toHaveAttribute('data-jaf-state', 'filled');
  }
  await expect(form.locator('#gender').locator('xpath=ancestor::div[contains(@class,"select__control")]')).toHaveAttribute('data-jaf-state', 'missing');
  expect(await form.locator('.select__menu [role=option]').count()).toBe(0);
  expect(await form.locator('body').getAttribute('data-submits')).toBe('0');

  await form.bringToFront();
  await expect(panel.getByText(/Missing saved profile answer.*Active security clearance/)).toBeVisible();
  await expect(panel.getByText('Upload this document on the application page.')).toBeVisible();
  await expect(panel.getByText(/Results from the last fill attempt/)).toBeVisible();
  await form.setViewportSize({ width: 1100, height: 900 });
  await shot(form, 'greenhouse-filled-dropdowns');
  await panel.setViewportSize({ width: 400, height: 900 });
  await shot(panel, 'greenhouse-field-reasons');
  await form.reload();
  await form.bringToFront();
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(panel.getByText('Filling', { exact: true }).first()).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Hide fields that need you' })).toBeHidden();
  await expect(form.getByText('Ready for review', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole('button', { name: 'Hide fields that need you' })).toBeVisible();
  expect(await form.locator('body').getAttribute('data-submits')).toBe('0');
});

test('partial profile import preserves existing details and fills eligibility dropdowns', async () => {
  const stale = await context.newPage();
  await stale.goto(`chrome-extension://${extensionId}/options.html#profile`);
  await expect(stale.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue('jordan@example.com');
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html#data`);
  await settings.locator('input[type=file]').setInputFiles({
    name: 'synthetic-answers.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      version: 2, kind: 'profile-patch', profile: { workAuth: {
        authorizedUS: 'yes', authorizationScope: 'any-employer', usCitizen: 'yes',
        exportStatus: 'US Citizen', activeClearance: 'Never held a clearance', clearanceEligible: 'no',
      } },
    })),
  });
  await expect(settings.getByText('Saved answers updated; other profile details preserved.')).toBeVisible();
  // Saving an unrelated edit from a tab opened before the import must not erase it.
  await stale.getByRole('textbox', { name: 'Street address', exact: true }).fill('123 Example Street');
  await stale.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(stale.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
  await expect(stale.getByRole('combobox', { name: 'US citizen?', exact: true })).toHaveValue('yes');
  await settings.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(settings.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue('jordan@example.com');
  await expect(settings.getByRole('textbox', { name: 'School', exact: true }).first()).toHaveValue('University of California, Berkeley');
  await expect(settings.getByRole('combobox', { name: 'US citizen?', exact: true })).toHaveValue('yes');
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const form = await context.newPage();
  await form.goto(GREENHOUSE_URL);
  await form.bringToFront();
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.getByText('Ready for review', { exact: true })).toBeVisible({ timeout: 30_000 });
  for (const [id, value] of Object.entries({
    authorization: 'I am authorized to work in the United States for any employer',
    clearance: 'Never held a clearance', 'clearance-eligible': 'No',
    citizen: 'Yes, I am currently a US Citizen', 'export-status': 'US Citizen',
  })) {
    await expect(form.locator(`#${id}`).locator('xpath=ancestor::div[contains(@class,"select__control")]').locator('.select__single-value')).toHaveText(value);
  }
  await expect(form.locator('#gender').locator('xpath=ancestor::div[contains(@class,"select__control")]')).toHaveAttribute('data-jaf-state', 'missing');
  expect(await form.locator('body').getAttribute('data-submits')).toBe('0');
  await shot(form, 'greenhouse-saved-eligibility');
});

test('missing saved answers can be repaired in the side panel and reused on a later fill', async () => {
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html#data`);
  await settings.locator('input[type=file]').setInputFiles({
    name: 'synthetic-clear.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      version: 2, kind: 'profile-patch', profile: { workAuth: {
        authorizationScope: '', usCitizen: '', exportStatus: '', activeClearance: '', clearanceEligible: '',
      } },
    })),
  });
  await expect(settings.getByText('Saved answers updated; other profile details preserved.')).toBeVisible();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const form = await context.newPage();
  await form.goto(GREENHOUSE_URL);
  await form.bringToFront();
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.getByText('Ready for review', { exact: true })).toBeVisible({ timeout: 30_000 });
  await panel.getByRole('button', { name: 'Fix saved eligibility answers' }).click();
  await expect(panel.getByRole('combobox', { name: 'US citizen?', exact: true })).toHaveValue('');
  await panel.getByRole('combobox', { name: 'US citizen?', exact: true }).selectOption('yes');
  await panel.getByRole('combobox', { name: 'Authorization scope', exact: true }).selectOption('any-employer');
  await panel.getByLabel('Import saved answers (JSON)', { exact: true }).setInputFiles({
    name: 'synthetic-windows-answers.json', mimeType: 'application/json', buffer: Buffer.from('\uFEFF' + JSON.stringify({
      version: 2, kind: 'profile-patch', profile: { workAuth: {
        activeClearance: 'Never held a clearance', exportStatus: 'US Citizen', clearanceEligible: 'no',
      } },
    })),
  });
  await expect(panel.getByText('Answers saved in this browser. Retry autofill to use them.')).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'US citizen?', exact: true })).toHaveValue('yes');
  await expect(panel.getByRole('combobox', { name: 'Authorization scope', exact: true })).toHaveValue('any-employer');
  await form.bringToFront();
  await panel.getByRole('button', { name: 'Save answers and retry autofill' }).click();
  await expect(form.locator('#citizen').locator('xpath=ancestor::div[contains(@class,"select__control")]').locator('.select__single-value'))
    .toHaveText('Yes, I am currently a US Citizen', { timeout: 30_000 });
  await expect(panel.getByText(/Missing saved profile answer.*US citizen/)).toBeHidden();
  await form.reload();
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.getByText('Ready for review', { exact: true })).toBeVisible({ timeout: 30_000 });
  for (const [id, value] of Object.entries({
    clearance: 'Never held a clearance', 'clearance-eligible': 'No',
    citizen: 'Yes, I am currently a US Citizen', 'export-status': 'US Citizen',
  })) {
    await expect(form.locator(`#${id}`).locator('xpath=ancestor::div[contains(@class,"select__control")]').locator('.select__single-value')).toHaveText(value);
  }
  expect(await form.locator('body').getAttribute('data-submits')).toBe('0');
  await shot(panel, 'saved-answer-recovery-complete');
});

test('saved citizen category and enabled self-identification choices fill all four reported dropdowns', async () => {
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html#data`);
  await settings.locator('input[type=file]').setInputFiles({
    name: 'synthetic-self-id.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      version: 2, kind: 'profile-patch', profile: {
        workAuth: { usCitizen: '', status: 'US Citizen', exportStatus: 'US Citizen' },
        eeo: { gender: 'Male', hispanic: 'No', race: 'Asian', veteran: 'I am not a protected veteran', autofillSaved: false },
      },
    })),
  });
  await expect(settings.getByText('Saved answers updated; other profile details preserved.')).toBeVisible();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const form = await context.newPage();
  await form.goto(GREENHOUSE_URL);
  await form.bringToFront();
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.getByText('Ready for review', { exact: true })).toBeVisible({ timeout: 30_000 });
  const control = (id: string) => form.locator(`#${id}`).locator('xpath=ancestor::div[contains(@class,"select__control")]');
  await expect(control('citizen').locator('.select__single-value')).toHaveText('Yes, I am currently a US Citizen');
  await expect(control('gender')).toHaveAttribute('data-jaf-state', 'missing');
  await expect(control('race')).toHaveAttribute('data-jaf-state', 'missing');
  await panel.getByRole('button', { name: 'Fix saved eligibility answers' }).click();
  await panel.getByRole('checkbox', { name: 'Autofill my saved gender, Hispanic/Latino, race, and veteran answers' }).check();
  await form.bringToFront();
  await panel.getByRole('button', { name: 'Save answers and retry autofill' }).click();
  await expect(control('gender').locator('.select__single-value')).toHaveText('Male', { timeout: 30_000 });
  await expect(control('hispanic_ethnicity').locator('.select__single-value')).toHaveText('No');
  await expect(control('race').locator('.select__single-value')).toHaveText('Asian');
  await expect(control('veteran_status').locator('.select__single-value')).toHaveText('I am not a protected veteran');
  await expect(panel.getByText('Voluntary self-identification: choose your answer on the page.')).toBeHidden();
  await form.reload();
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
  await expect(form.getByText('Ready for review', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(control('gender').locator('.select__single-value')).toHaveText('Male');
  await expect(control('race').locator('.select__single-value')).toHaveText('Asian');
  await expect(control('citizen').locator('.select__single-value')).toHaveText('Yes, I am currently a US Citizen');
  expect(await form.locator('body').getAttribute('data-submits')).toBe('0');
  await shot(form, 'greenhouse-self-identification-filled');
});

test('conditional race fills before AI starts and offscreen fields do not move the viewport', async () => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const form = await context.newPage();
  await form.setViewportSize({ width: 1000, height: 700 });
  await form.goto(`${GREENHOUSE_URL}?conditional-race=1`);
  await form.evaluate(async () => {
    window.scrollTo(0, 250);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    (window as any).__fillScrollPositions = [window.scrollY];
    window.addEventListener('scroll', () => (window as any).__fillScrollPositions.push(window.scrollY));
  });
  let requested = false;
  let raceAtRequest = '';
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const aiRoute = async (route: import('@playwright/test').Route) => {
    raceAtRequest = await form.evaluate(() => document.querySelector('#race')?.closest('.select__control')
      ?.querySelector('.select__single-value')?.textContent ?? '');
    requested = true;
    await gate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Synthetic accomplishment paragraph.' }] } }],
    }) });
  };
  await context.route('https://generativelanguage.googleapis.com/**', aiRoute);
  try {
    await form.bringToFront();
    await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'fillActiveTab' }));
    await expect.poll(() => requested, { timeout: 30_000 }).toBe(true);
    expect(raceAtRequest).toBe('Asian');
    expect(await form.inputValue('#essay')).toBe('');
    release();
    await expect(form.getByText('Ready for review', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(form.locator('#essay')).toHaveValue('Synthetic accomplishment paragraph.');
    const positions: number[] = await form.evaluate(() => (window as any).__fillScrollPositions);
    expect(positions.every(y => Math.abs(y - 250) <= 2)).toBe(true);
    expect(await form.locator('body').getAttribute('data-submits')).toBe('0');
  } finally {
    release();
    await context.unroute('https://generativelanguage.googleapis.com/**', aiRoute);
  }
});
