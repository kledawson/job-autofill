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
const request = (type: string, data: object = {}) => panel.evaluate(payload => chrome.runtime.sendMessage(payload), { type, ...data });
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
  mkdirSync(process.env.SCREENSHOTS, { recursive: true });
  await panel.screenshot({ path: join(process.env.SCREENSHOTS, name + '.png'), fullPage: true });
}
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaf-queue-e2e-'));
  const openssl = process.platform === 'win32' ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(p => join(p!, 'Git','usr','bin','openssl.exe')).find(existsSync) ?? 'openssl.exe' : 'openssl';
  execFileSync(openssl, ['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=jobs.lever.co','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem')], { stdio: 'ignore' });
  server = createServer({ key: readFileSync(join(dir,'key.pem')), cert: readFileSync(join(dir,'cert.pem')) }, (req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(req.url?.includes('login') ? '<!doctype html><h1>Sign in to continue</h1>' :
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

test('bounded review batches pin role/documents, preserve edits and survive worker restarts', async () => {
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
  await shot('queue-batch-review');await form(2).locator('#custom').fill('My later manual answer');
  await action(1,'open');
  const remembered=panel.getByRole('list',{name:'Questions to review',exact:true}).getByRole('listitem').filter({hasText:'Fictional project reference'});
  await expect(remembered.getByRole('button',{name:'Save this answer',exact:true})).toBeVisible();
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
  await expect.poll(async()=> (await state()).items[1].state,{timeout:30000}).toBe('needs-action');await ready(2);
  const before=context.pages().filter(p=>p.url().includes('/queue-')).length;
  await action(0,'retry');await ready(0);expect(context.pages().filter(p=>p.url().includes('/queue-')).length).toBe(before+1);
  await shot('queue-needs-action');await request('controlQueue',{action:'stop'});
  expect((await state()).status).toBe('stopped');expect(context.pages().filter(p=>p.url().includes('/queue-')).length).toBe(before+1);
  expect((await rows('applications')).filter(a=>a.url.includes('login')&&a.status==='Submitted')).toHaveLength(0);
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
