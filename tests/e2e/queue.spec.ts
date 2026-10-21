import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
declare const chrome: any;
let context: BrowserContext, server: Server, panel: Page, extensionId: string;
let userDataDir: string, launchOptions: Parameters<typeof chromium.launchPersistentContext>[1];
const request = async (type: string, data: object = {}) => {
  if (type === 'controlQueue' && !('token' in data)) {
    const result = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'getQueue' }));
    data = { ...data, token: result.queue?.token };
  }
  return panel.evaluate(payload => chrome.runtime.sendMessage(payload), { type, ...data });
};
const url = (n: string | number) => 'https://jobs.lever.co/contoso/queue-' + n;
const rows = (table: string) => panel.evaluate(table => new Promise<any[]>((resolve, reject) => {
  const req = indexedDB.open('job-autofill'); req.onerror = () => reject(req.error); req.onsuccess = () => {
    const d = req.result, tx = d.transaction(table), r = tx.objectStore(table).getAll(); r.onsuccess = () => resolve(r.result); tx.oncomplete = () => d.close();
  };
}), table);
const state = async () => (await rows('applicationQueue'))[0];
const form = (n: string | number) => context.pages().find(p => p.url().includes('/queue-' + n + '/apply'))!;
const ready = async (n: number) => expect.poll(async () => (await state()).items[n].state, { timeout: 30000 }).toBe('review');
const action = async (index: number, action: string) => { const q = await state(); return request('queueAction', { token: q.token, itemId: q.items[index].id, action }); };
async function shot(name: string) {
  if (!process.env.SCREENSHOTS) return;
  await panel.setViewportSize({width:400,height:960});
  mkdirSync(process.env.SCREENSHOTS, { recursive: true });
  await panel.evaluate(() => window.scrollTo(0, 0));
  await panel.screenshot({ path: join(process.env.SCREENSHOTS, name + '.png'), fullPage: false });
}
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaf-queue-e2e-'));
  const openssl = process.platform === 'win32' ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(p => join(p!, 'Git','usr','bin','openssl.exe')).find(existsSync) ?? 'openssl.exe' : 'openssl';
  execFileSync(openssl, ['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=jobs.lever.co','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem')], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(join(dir,'key.pem')), cert: readFileSync(join(dir,'cert.pem')) }, (req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(req.url?.includes('login') ? '<!doctype html><h1>Sign in to continue</h1>' : req.url?.includes('parallel') ?
    '<!doctype html><title>Contoso - Fictional Engineer</title><h1>Fictional Engineer</h1><form><label for="first">First name</label><input id="first" autocomplete="given-name" required><label for="email">Email</label><input id="email" type="email" required>'+ (req.url.includes('parallel-slow') ? '<label for="slow-essay">Tell us about your proudest accomplishment</label><textarea id="slow-essay" required></textarea>' : '') + '</form>' :
    '<!doctype html><title>Contoso - Fictional Engineer</title><style>body{font:17px system-ui;padding:30px}label{display:block;margin-top:16px}input,textarea,select{font:inherit;padding:8px}</style><h1>Fictional Engineer</h1><form><label for="first">First name</label><input id="first" autocomplete="given-name" required><label for="email">Email</label><input id="email" type="email" required><label for="resume">Resume</label><input id="resume" type="file" required><label for="portfolio">Portfolio</label><input id="portfolio"><label for="essay">Why this team?</label><textarea id="essay" required></textarea><label for="custom">Fictional project reference</label><input id="custom" required><button type="submit">Submit application</button></form><script>window.submits=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();window.submits++}</script>'));
  await new Promise<void>(r => server.listen(0,'127.0.0.1',r));
  const port = (server.address() as AddressInfo).port;
  process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
  userDataDir=join(dir,'browser-profile');
  launchOptions={ channel:'chromium', headless:true, ignoreHTTPSErrors:true, args:[
    '--disable-extensions-except=' + resolve(import.meta.dirname,'../../apps/extension/dist/chrome-mv3'),
    '--load-extension=' + resolve(import.meta.dirname,'../../apps/extension/dist/chrome-mv3'),
    '--host-resolver-rules=MAP jobs.lever.co:443 127.0.0.1:' + port + ', MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--ignore-certificate-errors'] };
  context=await chromium.launchPersistentContext(userDataDir,launchOptions);
  await context.route('https://api.lever.co/**', r => r.fulfill({ contentType:'application/json', body:'{"descriptionPlain":"A fictional role","lists":[]}' }));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = worker.url().split('/')[2]!;
  panel = await context.newPage(); await panel.goto('chrome-extension://' + extensionId + '/sidepanel.html');
  const base = (await request('getFillContext')).profile;
  await panel.evaluate(async ({ base }) => {
    await chrome.storage.local.set({ onboardingComplete:true, geminiApiKey:'' });
    await new Promise<void>((resolve,reject) => {
      const r = indexedDB.open('job-autofill'); r.onsuccess=()=>{
        const db=r.result, tx=db.transaction(['profile','presets','files'],'readwrite');
        tx.objectStore('profile').put({...base,firstName:'Taylor',lastName:'Example',email:'taylor@fictional.example'});
        tx.objectStore('presets').put({id:'default',schemaVersion:1,revision:2,updatedAt:1,name:'Software Engineer',resume:'profile',coverLetter:'none',links:{portfolio:'https://example.com/software',github:null,website:null},emphasis:'',responses:[{question:'Why this team?',answer:'I enjoy building fictional software.',aliases:[]}]});
        tx.objectStore('files').put({kind:'resume',name:'Taylor_Software.pdf',type:'application/pdf',blob:new Blob(['%PDF-1.4 synthetic software resume'],{type:'application/pdf'}),updatedAt:1});
        tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error);
      };
    });
  }, { base });
  await panel.reload(); await panel.setViewportSize({ width:400,height:960 });
});
test.afterAll(async () => { await context?.close(); await new Promise<void>(r => server?.close(()=>r())); });

test('build information is keyboard accessible at narrow sidebar widths', async () => {
  const info = await context.newPage(); await info.goto('chrome-extension://' + extensionId + '/sidepanel.html');
  await info.setViewportSize({ width: 320, height: 800 });
  const summary = info.locator('footer summary');
  await expect(summary).toContainText('Version ' + await info.evaluate(() => chrome.runtime.getManifest().version));
  await summary.focus(); await summary.press('Enter');
  await expect(info.locator('footer time')).toBeVisible();
  expect(await info.locator('footer time').getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(await info.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.SCREENSHOTS) {
    mkdirSync(process.env.SCREENSHOTS, { recursive: true });
    await info.screenshot({ path: join(process.env.SCREENSHOTS, 'checkpoint-6-build-info.png'), fullPage: true });
  }
  await info.getByRole('button', { name: 'Fill this page', exact: true }).focus();
  await expect(info.getByRole('button', { name: 'Fill this page', exact: true })).toBeFocused();
  await summary.focus(); await summary.press('Space'); await expect(info.locator('footer time')).toBeHidden();
  await info.close();
});

test('closure retry keeps a completed live tab in capacity until removal succeeds', async () => {
  expect((await request('startQueue', { urls: [url('close-fails'), url('close-next')], batchSize: 1, mode: 'continuous' })).ok).toBe(true);
  await ready(0);
  const original = await state(), tabId = original.items[0].tabId, first = form('close-fails');
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(tabId => {
    const remove = chrome.tabs.remove.bind(chrome.tabs);
    (globalThis as any).__closeFixture = { remove, failures: 0 };
    chrome.tabs.remove = async (id: number) => {
      if (id === tabId) { (globalThis as any).__closeFixture.failures++; throw new Error('Fictional tab closure failure'); }
      return remove(id);
    };
  }, tabId);
  try {
    expect((await action(0, 'submitted')).ok).toBe(false);
    await panel.evaluate(() => chrome.alarms.create('application-queue', { when: Date.now() + 1 }));
    await expect.poll(() => worker.evaluate(() => (globalThis as any).__closeFixture.failures)).toBeGreaterThan(1);
    const q = await state(); expect(q.items[0].tabId).toBe(tabId); expect(q.items[1].state).toBe('queued');
    expect(first.isClosed()).toBe(false);
    expect((await rows('applications')).find(a => a.id === q.items[0].applicationId).status).toBe('Submitted');
  } finally {
    await worker.evaluate(() => { chrome.tabs.remove = (globalThis as any).__closeFixture.remove; delete (globalThis as any).__closeFixture; });
  }
  const cdp = await context.newCDPSession(panel); await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); await cdp.detach();
  await request('getQueue'); await ready(1);
  expect(first.isClosed()).toBe(true);
  expect((await state()).items[0].tabId).toBeUndefined();
  await action(1, 'skip');
  for (const item of (await state()).items) if (item.applicationId) await request('deleteApplication', { applicationId: item.applicationId });
});

test('bounded review batches pin role/documents, preserve edits and survive worker restarts', async () => {
  await panel.getByRole('checkbox', { name: 'Open the next job when an application finishes', exact: true }).uncheck();
  await panel.getByLabel('Job links', { exact:true }).fill([url(1),url(2),url(3),url(4),url(5),url(1)+'/apply?utm_source=x','https://linkedin.com/jobs/42'].join('\n'));
  const region=panel.getByRole('region',{name:'Application queue'});
  await expect(region).toContainText('5 new applications ready'); await expect(region).toContainText('1 duplicate link removed');
  await shot('queue-link-preview');
  await region.getByRole('button',{name:'Start queue',exact:true}).click();
  await ready(0); await ready(1); await ready(2);
  expect((await state()).items.map((i:any)=>i.state)).toEqual(['review','review','review','queued','queued']);
  expect(context.pages().filter(p=>p.url().includes('/queue-')).length).toBe(3);
  expect(await rows('queueContexts')).toHaveLength(1);
  expect(await rows('fillRuns')).toHaveLength(3);
  expect(await state()).not.toHaveProperty('snapshot');
  expect((await state()).items.slice(3).every((i:any)=>i.tabId===undefined)).toBe(true);
  for(const n of [1,2,3]) {
    await expect(form(n).locator('#first')).toHaveValue('Taylor');
    await expect(form(n).locator('#essay')).toHaveValue('I enjoy building fictional software.');
    expect(await form(n).locator('#resume').evaluate((i:HTMLInputElement)=>i.files?.[0]?.name)).toBe('Taylor_Software.pdf');
    expect(await form(n).evaluate(()=> (window as any).submits)).toBe(0);
  }
  const card=region.locator('[data-queue-item]').first();
  await expect(card.getByRole('button',{name:'Review',exact:true})).toBeVisible();
  await expect(card.getByRole('button',{name:'Fill this step',exact:true})).toBeHidden();
  await card.getByRole('button',{name:'More',exact:false}).click();
  await expect(card.getByRole('button',{name:'Fill this step',exact:true})).toBeVisible();
  await expect(card.getByRole('button',{name:'Abandon — close tab',exact:true})).toBeVisible();
  await card.getByRole('button',{name:'Less',exact:false}).click();
  await shot('queue-batch-review');
  await form(2).evaluate(()=>{for(let i=0;i<30;i++)document.querySelector('form')!.insertAdjacentHTML('beforeend','<label for="extra-'+i+'">Fictional extra review field '+i+'</label><input id="extra-'+i+'" required>');});
  await form(2).locator('#custom').fill('My later manual answer');
  await action(1,'open');
  await panel.evaluate(() => { const t = document.getElementById('sidebar-review-toggle')!; if (t.getAttribute('aria-expanded') === 'false') t.click(); });
  const remembered=panel.getByRole('list',{name:'Questions to review',exact:true}).getByRole('listitem').filter({hasText:'Fictional project reference'});
  await expect(remembered.getByRole('button',{name:'Save this answer',exact:true})).toBeVisible();
  await expect(panel.locator('#sidebar-fill').getByRole('list',{name:'Questions to review',exact:true})).toHaveCount(0);
  await expect.poll(()=>panel.getByRole('list',{name:'Questions to review',exact:true}).getByRole('listitem').count()).toBeGreaterThan(25);
  const reviewList=panel.getByRole('list',{name:'Questions to review',exact:true});
  expect((await panel.locator('#sidebar-fill').boundingBox())!.height).toBeLessThan(400);
  expect((await reviewList.boundingBox())!.height).toBeLessThanOrEqual(322);
  expect(await reviewList.evaluate(element=>element.scrollHeight>element.clientHeight)).toBe(true);
  await shot('sidebar-review-separated');
  await expect(form(2).locator('#custom')).toHaveValue('My later manual answer');
  await panel.evaluate(async()=>{
    await new Promise<void>(resolve=>{
      const r=indexedDB.open('job-autofill');r.onsuccess=()=>{
        const d=r.result,tx=d.transaction(['profile','presets','files'],'readwrite'), p=tx.objectStore('profile').get('me'), s=tx.objectStore('presets').get('default');
        p.onsuccess=()=>tx.objectStore('profile').put({...p.result,firstName:'Morgan'});
        s.onsuccess=()=>tx.objectStore('presets').put({...s.result,revision:3,name:'Hardware Engineer',links:{...s.result.links,portfolio:'https://example.com/hardware'},responses:[]});
        tx.objectStore('files').put({kind:'resume',name:'Taylor_Hardware.pdf',type:'application/pdf',blob:new Blob(['%PDF-1.4 synthetic hardware resume']),updatedAt:2});
        tx.oncomplete=()=>{d.close();resolve()};
      };
    });
  });
  await region.getByRole('button',{name:'Pause queue',exact:true}).click(); await expect(region).toContainText('Paused');
  const cdp=await context.newCDPSession(panel);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await cdp.detach();
  expect((await request('getQueue')).queue.status).toBe('paused');
  expect((await action(0,'submitted')).ok).toBe(true);expect((await action(1,'skip')).ok).toBe(true);
  expect((await state()).items[3].batch).toBe(0);
  await region.getByRole('button',{name:'Resume queue',exact:true}).click();expect((await state()).items[3].batch).toBe(0);
  const q=await state(),last=q.items[2];
  const results=await panel.evaluate(async ({token,id})=>Promise.all([
    chrome.runtime.sendMessage({type:'queueAction',token,itemId:id,action:'submitted'}),
    chrome.runtime.sendMessage({type:'queueAction',token,itemId:id,action:'submitted'})
  ]),{token:q.token,id:last.id});
  expect(results.some(r=>r.ok)).toBe(true);
  await ready(3);await ready(4);expect(context.pages().filter(p=>p.url().includes('/queue-')).length).toBe(2);
  await expect(form(4).locator('#first')).toHaveValue('Morgan');
  await expect(form(4).locator('#portfolio')).toHaveValue('https://example.com/software');
  await expect(form(4).locator('#essay')).toHaveValue('I enjoy building fictional software.');
  expect(await form(4).locator('#resume').evaluate((i:HTMLInputElement)=>i.files?.[0]?.name)).toBe('Taylor_Software.pdf');
  expect((await rows('applications')).filter(a=>a.status==='Submitted')).toHaveLength(2);
  const item=(await state()).items[3];
  expect((await request('queueFinished',{runId:item.attempt,applicationId:item.applicationId})).ok).toBe(false);
  expect((await state()).items[3].state).toBe('review');
  await form(4).locator('#first').fill('My manual edit');
  expect((await action(3,'retry')).ok).toBe(true);await ready(3);
  await expect(form(4).locator('#first')).toHaveValue('My manual edit');
  await action(3,'skip');await action(4,'skip');
  await expect.poll(async()=> (await state()).status).toBe('complete');await expect(region).toContainText('Queue complete');await shot('queue-complete');
});
test('closed tabs and missing forms need action, retry safely, and Stop preserves pages', async()=>{
  expect((await request('startQueue',{urls:[url('closed'),url('login'),url('later')],batchSize:3,presetId:'default'})).ok).toBe(true);
  await ready(0);await form('closed').close();
  await expect.poll(async()=> (await state()).items[0].state).toBe('needs-action');
  await expect.poll(async()=> (await state()).items[1].state,{timeout:45000}).toBe('needs-action');await ready(2);
  const before=context.pages().filter(p=>p.url().includes('/queue-')).length;
  await action(0,'retry');await ready(0);expect(context.pages().filter(p=>p.url().includes('/queue-')).length).toBe(before+1);
  await shot('queue-needs-action');await request('controlQueue',{action:'stop'});
  expect((await state()).status).toBe('stopped');expect(context.pages().filter(p=>p.url().includes('/queue-')).length).toBe(before+1);
  expect((await rows('applications')).filter(a=>a.url.includes('login')&&a.status==='Submitted')).toHaveLength(0);
  await action(0,'open');
  const previousRun=(await rows('applications')).find(a=>a.url.includes('queue-closed')).runId;
  await panel.getByRole('region',{name:'Fill this page',exact:true}).getByRole('button',{name:'Fill this page',exact:true}).click();
  await expect.poll(async()=> (await rows('applications')).find(a=>a.url.includes('queue-closed')).runId).not.toBe(previousRun);
  expect((await state()).status).toBe('stopped');
  for(const p of context.pages().filter(p=>p.url().includes('/queue-'))) await p.close();
});

test('a fresh browser session pauses durable progress and never closes unrelated tabs', async () => {
  expect((await request('startQueue',{urls:[url('restart-one'),url('restart-two'),url('restart-three')],batchSize:2,presetId:'default'})).ok).toBe(true);
  await ready(0);await ready(1);
  const previous=await state();
  await context.close();
  context=await chromium.launchPersistentContext(userDataDir, launchOptions);
  await context.route('https://api.lever.co/**',r=>r.fulfill({contentType:'application/json',body:'{"descriptionPlain":"A fictional role","lists":[]}'}));
  panel=await context.newPage();await panel.goto('chrome-extension://'+extensionId+'/sidepanel.html');
  await expect.poll(async()=> (await request('getQueue')).queue.status).toBe('paused');
  const restored=await state();expect(restored.token).toBe(previous.token);
  expect(restored.items.every((i:any)=>i.tabId===undefined)).toBe(true);
  expect(restored.items.map((i:any)=>i.state)).toEqual(['needs-action','needs-action','queued']);
  const unrelated=await context.newPage();await unrelated.goto(url('unrelated')+'/apply');await unrelated.locator('#first').fill('Keep this unowned answer');
  await request('controlQueue',{action:'resume'});await action(0,'retry');await ready(0);
  await action(0,'skip');await action(1,'skip');await ready(2);
  expect(unrelated.isClosed()).toBe(false);await expect(unrelated.locator('#first')).toHaveValue('Keep this unowned answer');
  await action(2,'skip');await expect.poll(async()=> (await state()).status).toBe('complete');
  await unrelated.close();
});

test('recovers a persisted opening intent through the page handshake without duplicate tabs', async () => {
  const ctx=(await request('getFillContext'));
  const { profile:_profile,hasGeminiKey:_key,runId:_run,queue:_queue,...snapshot }=ctx;
  const token=crypto.randomUUID(),attempt=crypto.randomUUID(),itemId=crypto.randomUUID(),target=url('handshake');
  const queue={id:'current',schemaVersion:1,token,status:'running',batchSize:1,batch:1,createdAt:Date.now(),presetName:snapshot.preset.name,resumeName:snapshot.resume?.name,items:[{id:itemId,url:target,key:'jobs.lever.co/contoso/queue-handshake',state:'opening',batch:1,attempt,deadline:Date.now()+60000}]};
  await panel.evaluate(async({queue,snapshot})=>{
    await new Promise<void>((resolve,reject)=>{
      const r=indexedDB.open('job-autofill');r.onsuccess=()=>{
        const d=r.result,tx=d.transaction(['applicationQueue','queueContexts'],'readwrite');
        tx.objectStore('applicationQueue').put(queue);tx.objectStore('queueContexts').put({id:queue.token,snapshot});
        tx.oncomplete=()=>{d.close();resolve()};tx.onabort=()=>reject(tx.error);
      };
    });
  },{queue,snapshot});
  const cdp=await context.newCDPSession(panel);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await cdp.detach();
  await panel.evaluate(async attempt=>{await chrome.tabs.create({url:chrome.runtime.getURL('/opening.html')+'#queue='+attempt,active:false})},attempt);
  await ready(0);
  expect((await state()).items[0].attempt).toBe(attempt);
  expect(context.pages().filter(p=>p.url().includes('/queue-handshake')).length).toBe(1);
  await expect(form('handshake').locator('#first')).toHaveValue('Morgan');
  await action(0,'skip');await expect.poll(async()=> (await state()).status).toBe('complete');
});

test('fills a whole background batch while one AI response stalls; restart preserves edits and rejects late writes', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let asks = 0;
  await context.route('https://generativelanguage.googleapis.com/**', async route => {
    asks++;
    const old = asks === 1;
    if (old) await held;
    await route.fulfill({contentType:'application/json',body:JSON.stringify({candidates:[{content:{parts:[{text:old?'Stale fictional answer':'Current fictional answer'}]}}]})}).catch(()=>undefined);
  });
  await panel.evaluate(() => chrome.storage.local.set({geminiApiKey:'synthetic-key'}));
  await panel.getByLabel('Job links',{exact:true}).fill([url('parallel-slow'),url('parallel-two'),url('parallel-three'),url('parallel-next')].join('\n'));
  await panel.getByRole('region',{name:'Application queue'}).getByRole('button',{name:'Start queue',exact:true}).click();
  await expect.poll(()=>asks).toBe(1);
  await ready(1);await ready(2);
  const q=await state();expect(q.items[0].state).toBe('filling');expect(q.items[3].batch).toBe(0);
  expect(context.pages().filter(p=>p.url().includes('/queue-parallel')).length).toBe(3);
  await expect(form('parallel-slow').locator('#first')).toHaveValue('Morgan');
  // Standalone filling stays available while an unrelated queue attempt is waiting on AI.
  const independent = await context.newPage(); await independent.goto(url('parallel-independent') + '/apply'); await independent.bringToFront();
  await panel.getByRole('region',{name:'Fill this page',exact:true}).getByRole('button',{name:'Fill this page',exact:true}).click();
  await expect(independent.locator('#first')).toHaveValue('Morgan');
  await expect.poll(async()=> (await rows('applications')).find(a=>a.url.includes('parallel-independent'))?.status).toBe('Ready for review');
  expect((await state()).items[0].state).toBe('filling');
  await independent.close();
  await form('parallel-slow').locator('#first').fill('Keep my correction');
  await shot('compact-queue-background');
  await request('controlQueue',{action:'pause'});
  await action(0,'open');
  await panel.getByRole('region',{name:'Fill this page',exact:true}).getByRole('button',{name:'Restart autofill',exact:true}).click();
  release();await ready(0);
  expect((await state()).status).toBe('paused');
  await expect(form('parallel-slow').locator('#slow-essay')).toHaveValue('Current fictional answer');
  await expect(form('parallel-slow').locator('#first')).toHaveValue('Keep my correction');
  expect((await state()).items[0].attempt).not.toBe(q.items[0].attempt);
  await request('controlQueue',{action:'resume'});
  await action(0,'skip');await action(1,'skip');await action(2,'skip');await ready(3);await action(3,'skip');
  await panel.evaluate(()=>chrome.storage.local.set({geminiApiKey:''}));await context.unroute('https://generativelanguage.googleapis.com/**');
});

test('compact sidebar defaults and user layout/link drafts survive reopening', async () => {
  await panel.evaluate(()=>chrome.storage.local.remove(['sidebarVisibility','sidebarSection:review','sidebarOrder','sidebarSection:fill','sidebarSection:queue','sidebarSection:setup','sidebarSection:track','sidebarSection:history','sidebarSection:presets']));
  await panel.reload();
  const toggle=(name:string)=>panel.locator('#sidebar-'+name+'-toggle');
  await expect(toggle('fill')).toHaveCount(0);
  await expect(panel.locator('#sidebar-fill').getByRole('button',{name:'Fill this page',exact:true})).toBeVisible();
  await expect(panel.locator('#sidebar-fill-move')).toHaveCount(0);
  await expect(toggle('queue')).toHaveAttribute('aria-expanded','true');
  await expect(panel.locator('#sidebar-setup')).toBeHidden();
  await expect(panel.locator('#sidebar-track')).toBeHidden();
  for(const name of ['review','history'])await expect(toggle(name)).toHaveAttribute('aria-expanded','false');
  const order=await panel.locator('[id^="sidebar-"][id$="-toggle"]:visible').evaluateAll(nodes=>nodes.map(n=>n.id));
  expect(order[0]).toBe('sidebar-queue-toggle');expect(order.at(-1)).toBe('sidebar-history-toggle');
  await panel.getByLabel('Job links',{exact:true}).fill(url('draft-test'));
  await panel.getByRole('combobox',{name:/^Applications (?:per batch|open at once)$/}).selectOption('2');
  await toggle('queue').click();await toggle('history').click();
  await expect.poll(()=>panel.evaluate(async()=> (await chrome.storage.local.get('sidebarSection:queue'))['sidebarSection:queue'])).toBe(false);
  await panel.reload();
  await expect(toggle('queue')).toHaveAttribute('aria-expanded','false');await expect(toggle('history')).toHaveAttribute('aria-expanded','true');
  await toggle('queue').click();await expect(panel.getByLabel('Job links',{exact:true})).toHaveValue(url('draft-test'));
  await expect(panel.getByRole('combobox',{name:/^Applications (?:per batch|open at once)$/})).toHaveValue('2');
  expect(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await shot('compact-sidebar-preferences');
});


test('drag and keyboard section ordering preserve live drafts, open sections and the saved layout', async () => {
  const order=()=>panel.locator('[id^="sidebar-"][id$="-toggle"]:visible').evaluateAll(nodes=>nodes.map(n=>n.id.replace('sidebar-','').replace('-toggle','')));
  const handle=(id:string)=>panel.locator('#sidebar-'+id+'-move');
  await panel.getByLabel('Job links',{exact:true}).evaluate((input:HTMLTextAreaElement)=>input.dataset.layoutProof='stays-mounted');
  await panel.locator('#sidebar-queue-toggle').click(); // Collapse without discarding the link draft.
  await handle('history').dragTo(panel.locator('#sidebar-queue-toggle'),{targetPosition:{x:90,y:8}});
  await expect.poll(order).toEqual(['history','queue','review']);
  await expect(panel.locator('#sidebar-history-toggle')).toHaveAttribute('aria-expanded','true');
  await expect(panel.locator('#sidebar-queue-toggle')).toHaveAttribute('aria-expanded','false');
  await expect(panel.getByLabel('Job links',{exact:true})).toHaveAttribute('data-layout-proof','stays-mounted');
  await handle('history').focus();await handle('history').press('ArrowDown');
  await expect.poll(order).toEqual(['queue','history','review']);
  await expect(handle('history')).toBeFocused();
  await handle('history').click();
  await panel.locator('#sidebar-history-arrange').getByRole('button',{name:'Move up'}).click();
  await expect.poll(order).toEqual(['history','queue','review']);
  await panel.locator('#sidebar-history-arrange').getByRole('button',{name:'Done',exact:true}).click();
  await expect.poll(()=>panel.evaluate(async()=> (await chrome.storage.local.get('sidebarOrder')).sidebarOrder.order.filter((id:string)=>!['setup','track'].includes(id)))).toEqual(['fill','history','queue','review']);
  await panel.reload();await expect.poll(order).toEqual(['history','queue','review']);
  await expect(panel.locator('#sidebar-history-toggle')).toHaveAttribute('aria-expanded','true');
  await panel.locator('#sidebar-queue-toggle').click();
  await expect(panel.getByLabel('Job links',{exact:true})).toHaveValue(url('draft-test'));
  await expect(panel.getByRole('combobox',{name:/^Applications (?:per batch|open at once)$/})).toHaveValue('2');
  await shot('sidebar-reordered');
  await panel.getByRole('button',{name:'Reset order',exact:true}).click();
  await expect.poll(order).toEqual(['queue','review','history']);
  await panel.evaluate(()=>chrome.storage.local.set({sidebarOrder:{version:1,order:['fill',42]}}));
  await panel.reload();await expect.poll(order).toEqual(['queue','review','history']);
  // Older/removed IDs cannot hide sections or mount the same form twice.
  await panel.evaluate(()=>chrome.storage.local.set({'sidebarSection:fill':false,sidebarOrder:{version:1,order:['queue','retired-section','queue','fill']}}));
  await expect.poll(order).toEqual(['queue','review','history']);
  await panel.setViewportSize({width:400,height:420});
  await panel.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  expect(await panel.evaluate(()=>window.scrollY)).toBeGreaterThan(0);
  await expect(panel.locator('#sidebar-fill').getByRole('button',{name:'Fill this page',exact:true})).toBeInViewport();
  await expect(panel.locator('#sidebar-fill')).toBeInViewport();
  expect(await panel.locator('#sidebar-fill').evaluate(el => getComputedStyle(el).position)).toBe('sticky');
  await panel.setViewportSize({width:400,height:960});
  await expect(panel.getByLabel('Job links',{exact:true})).toHaveCount(1);
  await panel.getByRole('button',{name:'Reset order',exact:true}).click();
  expect(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await shot('sidebar-draggable-default');
});


test('Sidebar settings toggle optional categories live, preserve drafts, and keep Fill available', async () => {
  const settings=await context.newPage();await settings.goto('chrome-extension://'+extensionId+'/options.html#sidebar');
  const checkbox=(title:string)=>settings.getByRole('checkbox',{name:new RegExp('^'+title)});
  await expect(checkbox('Fill this page')).toBeChecked();await expect(checkbox('Fill this page')).toBeDisabled();
  await expect(checkbox('Track without autofill')).not.toBeChecked();
  await expect(checkbox('Setup & connections')).not.toBeChecked();
  await checkbox('Track without autofill').check();await expect(settings.getByRole('status')).toContainText('Track without autofill shown');
  await expect(panel.locator('#sidebar-track')).toBeVisible();
  await panel.locator('#sidebar-track-toggle').click();await panel.getByLabel('Application Link',{exact:true}).fill(url('manual-draft'));
  await checkbox('Track without autofill').uncheck();await expect(settings.getByRole('status')).toContainText('Track without autofill hidden');
  await expect(panel.locator('#sidebar-track')).toBeHidden();
  await checkbox('Track without autofill').check();await expect(settings.getByRole('status')).toContainText('Track without autofill shown');
  await expect(panel.getByLabel('Application Link',{exact:true})).toHaveValue(url('manual-draft'));
  await checkbox('Applications').uncheck();await expect(settings.getByRole('status')).toContainText('Applications hidden');
  await expect(panel.locator('#sidebar-history')).toBeHidden();
  await checkbox('Application queue').uncheck();await expect(settings.getByRole('status')).toContainText('Application queue hidden');
  await expect(panel.locator('#sidebar-queue')).toBeHidden();
  await checkbox('Setup & connections').check();await expect(settings.getByRole('status')).toContainText('Setup & connections shown');
  await panel.locator('#sidebar-setup-toggle').click();await expect(panel.getByRole('link',{name:'Manage connections',exact:true})).toBeVisible();
  await settings.reload();await expect(checkbox('Applications')).not.toBeChecked();await expect(checkbox('Application queue')).not.toBeChecked();
  await checkbox('Application queue').check();await expect(settings.getByRole('status')).toContainText('Application queue shown');
  await expect(panel.getByLabel('Job links',{exact:true})).toHaveValue(url('draft-test'));
  await checkbox('Setup & connections').uncheck();await expect(settings.getByRole('status')).toContainText('Setup & connections hidden');
  await checkbox('Track without autofill').uncheck();await expect(settings.getByRole('status')).toContainText('Track without autofill hidden');
  await settings.setViewportSize({width:1000,height:850});
  if(process.env.SCREENSHOTS)await settings.screenshot({path:join(process.env.SCREENSHOTS,'sidebar-settings.png'),fullPage:true});
  // Corrupted preferences cannot hide the recovery action or treat strings as booleans.
  await panel.evaluate(()=>chrome.storage.local.set({sidebarVisibility:{version:1,categories:{fill:false,queue:'false',setup:'true'}}}));
  await expect(panel.locator('#sidebar-fill')).toBeVisible();await expect(panel.locator('#sidebar-queue')).toBeVisible();await expect(panel.locator('#sidebar-setup')).toBeHidden();
  await panel.evaluate(()=>chrome.storage.local.remove('sidebarVisibility'));await settings.close();
  await shot('sidebar-clean-default');
});

test('live queue controls add links, change 3→5→2 capacity and survive pause/restart without duplicate claims', async () => {
  test.setTimeout(150000);
  await panel.getByRole('checkbox', { name: 'Open the next job when an application finishes', exact: true }).check();
  await panel.getByLabel('Job links', { exact: true }).fill([0,1,2,3,4].map(i => url('live-' + i)).join('\n'));
  await panel.getByLabel('Applications open at once', { exact: true }).selectOption('3');
  await panel.getByRole('button', { name: 'Start queue', exact: true }).click();
  await ready(0); await ready(1); await ready(2);
  const initial = await state(), region = panel.getByRole('region', { name: 'Application queue' });
  const activeTabs = () => context.pages().filter(p => p.url().includes('/queue-live-'));
  expect(activeTabs()).toHaveLength(3);
  await region.getByLabel('Open application limit', { exact: true }).selectOption('5');
  await ready(3); await ready(4); expect(activeTabs()).toHaveLength(5);
  expect(new Set((await state()).items.map((i:any) => i.attempt)).size).toBe(5);
  await region.getByLabel('Open application limit', { exact: true }).selectOption('2');
  await expect(region).toContainText('Above the new limit'); expect(activeTabs()).toHaveLength(5);
  await region.getByRole('button', { name: 'Pause queue', exact: true }).click();
  for (const i of [0,1,2]) expect(await action(i, 'skip')).toMatchObject({ ok: true });
  expect(activeTabs()).toHaveLength(2);
  await region.getByText('Add job links', { exact: true }).click();
  await region.getByLabel('More job links', { exact: true }).fill([url('live-5'),url('live-6'),url('live-5')+'/apply?utm_source=test',url('live-0')].join('\n'));
  await expect(region).toContainText('1 duplicate link removed'); await expect(region).toContainText('Already in this queue');
  await region.getByRole('button', { name: 'Add to queue (2)', exact: true }).click();
  await expect(region).toContainText('2 jobs added. They will open after you resume.');
  expect((await state()).items).toHaveLength(7); expect(activeTabs()).toHaveLength(2);
  expect((await rows('queueContexts'))).toHaveLength(1); expect((await state()).token).toBe(initial.token);
  const cdp = await context.newCDPSession(panel); await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); await cdp.detach();
  expect((await request('getQueue')).queue.status).toBe('paused');
  expect(await action(3, 'skip')).toMatchObject({ ok: true }); expect((await state()).items[5].batch).toBe(0);
  await region.getByRole('button', { name: 'Resume queue', exact: true }).click();
  await ready(5); expect((await state()).items[6].batch).toBe(0); expect(activeTabs()).toHaveLength(2);
  const token = (await state()).token;
  const concurrent = await Promise.all([request('addQueueLinks', { token, urls: [url('live-7')] }), request('addQueueLinks', { token, urls: [url('live-7')] })]);
  expect(concurrent.every(r => r.ok)).toBe(true); expect(concurrent.map(r => r.added).sort()).toEqual([0,1]);
  expect((await state()).items.filter((i:any) => i.url === url('live-7'))).toHaveLength(1);
  const stale = '00000000-0000-4000-8000-000000000000';
  expect(await request('controlQueue', { token: stale, action: 'size', batchSize: 5 })).toMatchObject({ ok: false });
  expect(await request('addQueueLinks', { token: stale, urls: [url('live-stale')] })).toMatchObject({ ok: false });
  expect((await state()).batchSize).toBe(2); expect((await state()).items).toHaveLength(8);
  const overflow = await request('addQueueLinks', { token, urls: Array.from({ length: 93 }, (_, i) => url('overflow-' + i)) });
  expect(overflow).toMatchObject({ ok: false }); expect(overflow.error).toContain('92 more jobs');
  expect((await state()).items).toHaveLength(8);
  await shot('queue-live-capacity');
  await request('controlQueue', { action: 'pause' });
  // A closed application releases its slot, but Retry cannot exceed the live limit.
  await form('live-4').close();
  await expect.poll(async () => (await state()).items[4].tabId).toBeUndefined();
  await request('controlQueue', { action: 'resume' }); await ready(6);
  expect(await action(4, 'retry')).toMatchObject({ ok: false });
  expect(activeTabs()).toHaveLength(2);
  await request('controlQueue', { action: 'pause' });
  for (const [index, item] of (await state()).items.entries()) if (!['submitted','skipped'].includes(item.state)) await action(index, 'skip');
  await request('controlQueue', { action: 'resume' });
  await expect.poll(async () => (await state()).status).toBe('complete');
});

test('tracked jobs have explicit resume/retry choices while submitted history stays excluded', async () => {
  const history = ['history-submitted','history-unfinished','history-abandoned'];
  const ids = await panel.evaluate(async urls => new Promise<number[]>((resolve, reject) => {
    const r = indexedDB.open('job-autofill'); r.onsuccess = () => {
      const d = r.result, tx = d.transaction('applications','readwrite'), ids: number[] = [];
      urls.forEach((url, i) => { const r = tx.objectStore('applications').add({ url, jobKey: url.replace('https://',''), company: 'Fictional history', role: ['Submitted role','Unfinished role','Abandoned role'][i], platform: 'lever', status: ['Submitted','Ready for review','Abandoned'][i], filledAt: 1, filledCount: 0, missingCount: 0, missingLabels: [], aiAnswers: 0 }); r.onsuccess = () => ids[i] = Number(r.result); });
      tx.oncomplete = () => { d.close(); resolve(ids); }; tx.onabort = () => reject(tx.error);
    };
  }), history.map(url));
  // Raw fixture writes bypass Dexie's live-query notifications; reopen the UI to read the fixture.
  await panel.reload();
  await expect(panel.locator('#sidebar-fill').getByRole('button', { name: 'Fill this page', exact: true })).toBeEnabled();
  await panel.getByLabel('Job links', { exact: true }).fill([...history.map(url),url('history-new')].join('\n'));
  const region = panel.getByRole('region', { name: 'Application queue' });
  await expect(region).toContainText('Previously submitted jobs are excluded');
  await expect(region.getByRole('checkbox', { name: 'Resume in queue (new tab)', exact: true })).not.toBeChecked();
  await region.getByRole('checkbox', { name: 'Resume in queue (new tab)', exact: true }).check();
  await region.getByRole('checkbox', { name: 'Retry in queue (new tab)', exact: true }).check();
  await shot('queue-history-choices');
  await panel.getByLabel('Applications open at once', { exact: true }).selectOption('3');
  await region.getByRole('button', { name: 'Start queue', exact: true }).click(); await ready(0); await ready(1); await ready(2);
  const q = await state(); expect(q.items.map((i:any) => i.url)).not.toContain(url(history[0]!));
  expect(q.items[0].applicationId).toBe(ids[1]); expect(q.items[1].applicationId).toBe(ids[2]);
  expect((await rows('applications')).filter(a => a.jobKey === url(history[1]!).replace('https://',''))).toHaveLength(1);
  expect(await request('addQueueLinks', { token: q.token, urls: [url(history[0]!)], resumeApplicationIds: [ids[0]] })).toMatchObject({ ok: false });
  expect((await rows('applications')).find(a => a.id === ids[0]).status).toBe('Submitted');
  for (const i of [0,1,2]) await action(i, 'skip');
});

test('abandon cancels a stalled writer and advances exactly once without closing unrelated tabs', async () => {
  let release!: () => void, asked = false;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await context.route('https://generativelanguage.googleapis.com/**', async route => {
    const firstRequest = !asked; asked = true; if (firstRequest) await delayed;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: firstRequest ? 'Late fictional answer' : 'Current fictional answer' }] } }] }) }).catch(() => undefined);
  });
  await panel.evaluate(() => chrome.storage.local.set({ geminiApiKey: 'synthetic-key' }));
  const other = await context.newPage(); await other.goto(url('unrelated') + '/apply');
  await panel.getByLabel('Job links', { exact: true }).fill([url('parallel-slow-abandon'),url('abandon-next')].join('\n'));
  await panel.getByLabel('Applications open at once', { exact: true }).selectOption('1');
  await panel.getByRole('button', { name: 'Start queue', exact: true }).click();
  await expect.poll(() => asked).toBe(true);
  const before = await state(), first = form('parallel-slow-abandon');
  expect(before.items[0].state).toBe('filling');
  const card = panel.locator('[data-queue-item]').first(); await card.getByRole('button', { name: 'More', exact: false }).click();
  await card.getByRole('button', { name: 'Abandon — close tab', exact: true }).click();
  await panel.getByRole('dialog').getByRole('button', { name: 'Abandon — close tab', exact: true }).click();
  await expect.poll(async () => ['opening','filling','review'].includes((await state()).items[1].state)).toBe(true);
  await expect.poll(() => !!form('abandon-next')).toBe(true);
  await expect(form('abandon-next').locator('#first')).not.toHaveValue('');
  expect(first.isClosed()).toBe(true); expect(other.isClosed()).toBe(false);
  expect((await rows('applications')).find(a => a.id === before.items[0].applicationId).status).toBe('Abandoned');
  // Known fields in the replacement do not wait for the old optional network response.
  release(); await ready(1);
  expect(await request('queueFinished', { runId: before.items[0].attempt, applicationId: before.items[0].applicationId })).toMatchObject({ ok: false });
  expect((await state()).items[0].state).toBe('skipped'); expect((await state()).items[1].state).toBe('review');
  await action(1, 'skip'); await other.close(); await panel.evaluate(() => chrome.storage.local.set({ geminiApiKey: '' }));
  await context.unroute('https://generativelanguage.googleapis.com/**');
});
