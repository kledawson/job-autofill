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
  await panel.setViewportSize({width:400,height:960});
  mkdirSync(process.env.SCREENSHOTS, { recursive: true });
  await panel.screenshot({ path: join(process.env.SCREENSHOTS, name + '.png'), fullPage: true });
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
  const card=region.locator('[data-queue-item]').first();
  await expect(card.getByRole('button',{name:'Review',exact:true})).toBeVisible();
  await expect(card.getByRole('button',{name:'Fill this step',exact:true})).toBeHidden();
  await card.getByRole('button',{name:'More',exact:false}).click();
  await expect(card.getByRole('button',{name:'Fill this step',exact:true})).toBeVisible();
  await expect(card.getByRole('button',{name:'Skip — close tab',exact:true})).toBeVisible();
  await card.getByRole('button',{name:'Less',exact:false}).click();
  await shot('queue-batch-review');
  await form(2).evaluate(()=>{for(let i=0;i<30;i++)document.querySelector('form')!.insertAdjacentHTML('beforeend','<label for="extra-'+i+'">Fictional extra review field '+i+'</label><input id="extra-'+i+'" required>');});
  await form(2).locator('#custom').fill('My later manual answer');
  await action(1,'open');
  await panel.getByRole('button',{name:/^Review & remember \(/}).click();
  const remembered=panel.getByRole('list',{name:'Questions to review',exact:true}).getByRole('listitem').filter({hasText:'Fictional project reference'});
  await expect(remembered.getByRole('button',{name:'Save this answer',exact:true})).toBeVisible();
  await expect(panel.locator('#sidebar-fill-body').getByRole('list',{name:'Questions to review',exact:true})).toHaveCount(0);
  await expect.poll(()=>panel.getByRole('list',{name:'Questions to review',exact:true}).getByRole('listitem').count()).toBeGreaterThan(25);
  const reviewList=panel.getByRole('list',{name:'Questions to review',exact:true});
  expect((await panel.locator('#sidebar-fill-body').boundingBox())!.height).toBeLessThan(400);
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
  await panel.getByRole('region',{name:'Current page review'}).getByRole('button',{name:'Fill this page',exact:true}).click();
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
  await form('parallel-slow').locator('#first').fill('Keep my correction');
  await shot('compact-queue-background');
  await request('controlQueue',{action:'pause'});
  await action(0,'open');
  await panel.getByRole('region',{name:'Current page review'}).getByRole('button',{name:'Restart autofill',exact:true}).click();
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
  await expect(toggle('fill')).toHaveAttribute('aria-expanded','true');
  await expect(toggle('queue')).toHaveAttribute('aria-expanded','true');
  await expect(panel.locator('#sidebar-setup')).toBeHidden();
  await expect(panel.locator('#sidebar-track')).toBeHidden();
  for(const name of ['review','history','presets'])await expect(toggle(name)).toHaveAttribute('aria-expanded','false');
  const order=await panel.locator('[id^="sidebar-"][id$="-toggle"]:visible').evaluateAll(nodes=>nodes.map(n=>n.id));
  expect(order[0]).toBe('sidebar-fill-toggle');expect(order[1]).toBe('sidebar-queue-toggle');expect(order.at(-1)).toBe('sidebar-history-toggle');
  await panel.getByLabel('Job links',{exact:true}).fill(url('draft-test'));
  await panel.getByLabel('Applications per batch',{exact:true}).selectOption('2');
  await toggle('queue').click();await toggle('presets').click();
  await expect.poll(()=>panel.evaluate(async()=> (await chrome.storage.local.get('sidebarSection:queue'))['sidebarSection:queue'])).toBe(false);
  await panel.reload();
  await expect(toggle('queue')).toHaveAttribute('aria-expanded','false');await expect(toggle('presets')).toHaveAttribute('aria-expanded','true');
  await toggle('queue').click();await expect(panel.getByLabel('Job links',{exact:true})).toHaveValue(url('draft-test'));
  await expect(panel.getByLabel('Applications per batch',{exact:true})).toHaveValue('2');
  expect(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await shot('compact-sidebar-preferences');
});


test('drag and keyboard section ordering preserve live drafts, open sections and the saved layout', async () => {
  const order=()=>panel.locator('[id^="sidebar-"][id$="-toggle"]:visible').evaluateAll(nodes=>nodes.map(n=>n.id.replace('sidebar-','').replace('-toggle','')));
  const handle=(id:string)=>panel.locator('#sidebar-'+id+'-move');
  await panel.getByLabel('Job links',{exact:true}).evaluate((input:HTMLTextAreaElement)=>input.dataset.layoutProof='stays-mounted');
  await panel.locator('#sidebar-queue-toggle').click(); // Collapse without discarding the link draft.
  await handle('presets').dragTo(panel.locator('#sidebar-fill-toggle'),{targetPosition:{x:90,y:8}});
  await expect.poll(order).toEqual(['presets','fill','queue','review','history']);
  await expect(panel.locator('#sidebar-presets-toggle')).toHaveAttribute('aria-expanded','true');
  await expect(panel.locator('#sidebar-queue-toggle')).toHaveAttribute('aria-expanded','false');
  await expect(panel.getByLabel('Job links',{exact:true})).toHaveAttribute('data-layout-proof','stays-mounted');
  await handle('presets').focus();await handle('presets').press('ArrowDown');
  await expect.poll(order).toEqual(['fill','presets','queue','review','history']);
  await expect(handle('presets')).toBeFocused();
  await handle('presets').click();
  await panel.locator('#sidebar-presets-arrange').getByRole('button',{name:'Move down'}).click();
  await expect.poll(order).toEqual(['fill','queue','presets','review','history']);
  await panel.locator('#sidebar-presets-arrange').getByRole('button',{name:'Done',exact:true}).click();
  await expect.poll(()=>panel.evaluate(async()=> (await chrome.storage.local.get('sidebarOrder')).sidebarOrder.order.filter((id:string)=>!['setup','track'].includes(id)))).toEqual(['fill','queue','presets','review','history']);
  await panel.reload();await expect.poll(order).toEqual(['fill','queue','presets','review','history']);
  await expect(panel.locator('#sidebar-presets-toggle')).toHaveAttribute('aria-expanded','true');
  await panel.locator('#sidebar-queue-toggle').click();
  await expect(panel.getByLabel('Job links',{exact:true})).toHaveValue(url('draft-test'));
  await expect(panel.getByLabel('Applications per batch',{exact:true})).toHaveValue('2');
  await shot('sidebar-reordered');
  await panel.getByRole('button',{name:'Reset order',exact:true}).click();
  await expect.poll(order).toEqual(['fill','queue','review','presets','history']);
  await panel.evaluate(()=>chrome.storage.local.set({sidebarOrder:{version:1,order:['fill',42]}}));
  await panel.reload();await expect.poll(order).toEqual(['fill','queue','review','presets','history']);
  // Older/removed IDs cannot hide sections or mount the same form twice.
  await panel.evaluate(()=>chrome.storage.local.set({sidebarOrder:{version:1,order:['queue','retired-section','queue','fill']}}));
  await expect.poll(order).toEqual(['queue','fill','review','presets','history']);
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
  await checkbox('Application preset').uncheck();await expect(settings.getByRole('status')).toContainText('Application preset hidden');
  await expect(panel.locator('#sidebar-presets')).toBeHidden();
  await checkbox('Application queue').uncheck();await expect(settings.getByRole('status')).toContainText('Application queue hidden');
  await expect(panel.locator('#sidebar-queue')).toBeHidden();
  await checkbox('Setup & connections').check();await expect(settings.getByRole('status')).toContainText('Setup & connections shown');
  await panel.locator('#sidebar-setup-toggle').click();await expect(panel.getByRole('link',{name:'Manage connections',exact:true})).toBeVisible();
  await settings.reload();await expect(checkbox('Application preset')).not.toBeChecked();await expect(checkbox('Application queue')).not.toBeChecked();
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
