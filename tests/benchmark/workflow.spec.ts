import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

const hosts = ['job-boards.greenhouse.io', 'jobs.lever.co', 'jobs.ashbyhq.com'];
const urls = (id: string) => [`https://${hosts[0]}/fictional/jobs/${id}`, `https://${hosts[1]}/fictional/${id}/apply`, `https://${hosts[2]}/fictional/${id}/application`];
const fixture = `<!doctype html><title>Fictional Engineer at Fictional Company</title><style>body{font:16px system-ui;padding:24px}label{display:block;margin:12px}input,select,textarea{padding:8px}</style>
<h1>Fictional Engineer</h1><form id="application-form">
<label>First name<input id="first_name" autocomplete="given-name" required></label>
<label>Last name<input id="last_name" autocomplete="family-name" required></label>
<label>Email<input id="email" type="email" required></label>
<label>Phone<input id="phone" type="tel"></label>
<label>LinkedIn<input id="linkedin"></label><label>GitHub<input id="github"></label>
<label>Degree<select id="degree"><option value="">Select...</option><option>Bachelor's Degree</option><option>Master's Degree</option></select></label>
<label>Which fictional tools do you use?<select id="tools" multiple><option>TypeScript</option><option>Python</option><option>Rust</option></select></label>
<label>Can you work in our fictional lab?<select id="lab"><option value="">Select...</option><option>Yes</option><option>No</option></select></label>
<label>Academic transcript<input id="transcript" type="file"></label>
<label>Tell us about a unique project for this fictional company<textarea id="essay"></textarea></label>
<button type="submit">Submit application</button></form><script>
window.submits=0;document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submits++});
document.querySelector('#lab').addEventListener('change',()=>{if(document.querySelector('#lab').value==='Yes'&&!document.querySelector('#reference'))setTimeout(()=>document.querySelector('form').insertAdjacentHTML('beforeend','<label>Fictional lab reference<input id="reference"></label>'),50)});
</script>`;
const expected: Record<string, string | string[]> = {
  first_name: 'Taylor', last_name: 'Example', email: 'taylor@fictional.example', phone: '2025550141',
  linkedin: 'https://linkedin.com/in/fictional-example', github: 'https://github.com/fictional-example',
  degree: "Bachelor's Degree", tools: ['TypeScript', 'Python'], lab: 'Yes', reference: 'SYNTHETIC-REFERENCE',
};

test('measures a bounded three-platform queue against the same idle forms', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaf-benchmark-'));
  const openssl = process.platform === 'win32' ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(p => join(p!, 'Git/usr/bin/openssl.exe')).find(existsSync) ?? 'openssl.exe' : 'openssl';
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=fictional.example', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  const server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(fixture));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const common = { channel: 'chromium', headless: true, ignoreHTTPSErrors: true, args: [
    '--host-resolver-rules=' + hosts.map(h => `MAP ${h}:443 127.0.0.1:${port}`).join(', ') + ', MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--ignore-certificate-errors',
  ] };
  let baseline: BrowserContext | undefined, active: BrowserContext | undefined;
  const heap = async (pages: Page[]) => {
    let bytes = 0, nodes = 0;
    for (const page of pages) {
      const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
      const metrics = (await cdp.send('Performance.getMetrics')).metrics;
      bytes += metrics.find(m => m.name === 'JSHeapUsedSize')?.value ?? 0;
      nodes += metrics.find(m => m.name === 'Nodes')?.value ?? 0; await cdp.detach();
    }
    return { pageJsHeapBytes: bytes, domNodes: nodes };
  };
  try {
    // A separate browser context without the extension is the idle baseline, not just an unfilled extension tab.
    baseline = await chromium.launchPersistentContext(join(dir, 'baseline'), common);
    const idlePages = await Promise.all(urls('baseline').map(async url => { const p = await baseline!.newPage(); await p.goto(url); return p; }));
    const idle = await heap(idlePages); await baseline.close(); baseline = undefined;
    active = await chromium.launchPersistentContext(join(dir, 'active'), { ...common, args: [...common.args,
      '--disable-extensions-except=' + resolve('apps/extension/dist/chrome-mv3'), '--load-extension=' + resolve('apps/extension/dist/chrome-mv3')] });
    await active.route('https://api.lever.co/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
    await active.route('https://api.ashbyhq.com/**', r => r.fulfill({ contentType: 'application/json', body: '{"jobs":[]}' }));
    const worker = active.serviceWorkers()[0] ?? await active.waitForEvent('serviceworker');
    const panel = await active.newPage(); await panel.goto('chrome-extension://' + worker.url().split('/')[2] + '/sidepanel.html');
    const request = (type: string, data: object = {}) => panel.evaluate(payload => chrome.runtime.sendMessage(payload), { type, ...data });
    const base = (await request('getFillContext')).profile;
    await panel.evaluate(async profile => {
      await chrome.storage.local.set({ onboardingComplete: true, geminiApiKey: '' });
      await new Promise<void>((resolve, reject) => { const r = indexedDB.open('job-autofill'); r.onsuccess = () => {
        const d = r.result, tx = d.transaction('profile', 'readwrite'); tx.objectStore('profile').put(profile);
        tx.oncomplete = () => { d.close(); resolve(); }; tx.onabort = () => reject(tx.error);
      }; });
    }, { ...base, firstName: 'Taylor', lastName: 'Example', email: expected.email, phone: expected.phone,
      linkedin: expected.linkedin, github: expected.github, education: [{ school: 'Fictional University', degree: 'BS', major: 'Computer Science', gpa: '', startDate: '', endDate: '', honors: '' }] });
    for (const [question, target] of [
      ['Which fictional tools do you use?', { kind: 'answers', selections: [{ value: 'TypeScript', aliases: [] }, { value: 'Python', aliases: [] }] }],
      ['Can you work in our fictional lab?', { kind: 'answer', value: 'Yes' }],
      ['Fictional lab reference', { kind: 'answer', value: 'SYNTHETIC-REFERENCE' }],
    ] as const) expect((await request('saveRememberedMapping', { mapping: { question, aliases: [], scope: 'all', target } })).ok).toBe(true);
    const samples: object[] = [];
    const rounds = Number(process.env.BENCHMARK_ROUNDS ?? 3);
    expect(Number.isInteger(rounds) && rounds >= 1 && rounds <= 5).toBe(true);
    let total = 0, correct = 0, incorrect = 0;
    for (let round = 0; round < rounds; round++) {
      const jobs = urls(`benchmark-${round}`), start = performance.now();
      expect((await request('startQueue', { urls: jobs, batchSize: 3, mode: 'continuous' })).ok).toBe(true);
      const elapsed = new Map<string, number>();
      await expect.poll(async () => {
        const q = (await request('getQueue')).queue;
        for (const item of q.items) if (item.state === 'review' && !elapsed.has(item.id)) elapsed.set(item.id, performance.now() - start);
        return elapsed.size;
      }, { timeout: 50000, intervals: [100, 200, 400] }).toBe(3);
      const q = (await request('getQueue')).queue;
      const pages = jobs.map(url => active!.pages().find(p => p.url() === url)!);
      const measurements = await heap(pages);
      for (const [index, page] of pages.entries()) {
        for (const [id, value] of Object.entries(expected)) {
          const actual = await page.locator('#' + id).evaluate((e: HTMLInputElement | HTMLSelectElement) => e instanceof HTMLSelectElement && e.multiple ? [...e.selectedOptions].map(o => o.textContent) : e.value).catch(() => '');
          const normalized = id === 'phone' && typeof actual === 'string' ? actual.replace(/\D/g, '') : actual;
          total++; if (JSON.stringify(normalized) === JSON.stringify(value)) correct++;
          else if (typeof actual === 'string' && actual || Array.isArray(actual) && actual.length) incorrect++;
        }
        expect(await page.evaluate(() => (window as any).submits)).toBe(0);
        await expect(page.locator('#essay')).toHaveValue('');
        samples.push({ round: round + 1, platform: ['greenhouse', 'lever', 'ashby'][index], timeToReviewMs: Math.round(elapsed.get(q.items[index].id)!) });
      }
      samples.push({ round: round + 1, threeTabReview: measurements });
      // Refill must preserve a correction and reuse the same tracker record.
      await pages[0].locator('#first_name').fill('Manual correction');
      expect((await request('queueAction', { token: q.token, itemId: q.items[0].id, action: 'retry' })).ok).toBe(true);
      await expect.poll(async () => (await request('getQueue')).queue.items[0].state).toBe('review');
      await expect(pages[0].locator('#first_name')).toHaveValue('Manual correction');
      expect((await request('getQueue')).queue.items[0].applicationId).toBe(q.items[0].applicationId);
      for (const item of q.items) expect((await request('queueAction', { token: q.token, itemId: item.id, action: 'skip' })).ok).toBe(true);
    }
    const report = { schemaVersion: 1, recordedAt: new Date().toISOString(), node: process.version, chromium: active.browser()?.version(),
      manifestVersion: await panel.evaluate(() => chrome.runtime.getManifest().version), fixture: 'Ten reusable fields per fictional form; identical HTML through three platform adapters. No real employer forms.',
      rounds, queueCapacity: 3, eligibleFields: total, correctFields: correct, incorrectNonemptyFields: incorrect,
      eligibleCoverage: correct / total, exclusionsPerForm: ['Academic transcript upload', 'Unprepared company-specific essay'],
      baselineThreeTabsWithoutExtension: idle, samples,
      limitations: 'Page-reported JS heap and DOM nodes only, not total browser RAM or extension worker/sidebar memory. No forced GC. Timing includes local navigation and bounded waits. No manual-user timing or real-site throughput claim.' };
    const out = resolve('local-data/benchmarks'); mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ eligibleFields: total, correctFields: correct, incorrectNonemptyFields: incorrect, report: 'local-data/benchmarks/latest.json' }));
    expect(incorrect).toBe(0); expect(correct / total).toBeGreaterThanOrEqual(0.9);
  } finally { await baseline?.close(); await active?.close(); await new Promise<void>(r => server.close(() => r())); }
});
