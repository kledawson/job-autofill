import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
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
