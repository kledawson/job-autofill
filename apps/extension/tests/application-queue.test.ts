import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FillSession } from '../lib/autofill/engine';
import { ADAPTERS } from '../lib/autofill/adapters';
import { timing } from '../lib/autofill/fill';
import { sampleProfile } from './helpers';
import { jobKey } from '../lib/platforms';
import { batchSize, nextQueueItem, parseQueueLinks, queueKey, queueJobMatches, queueSchema, type QueueState } from '../lib/application-queue';
const q = (size = 3): QueueState => ({
  id: 'current', schemaVersion: 1, token: crypto.randomUUID(), status: 'running', batchSize: size, batch: 0, createdAt: Date.now(),
  items: Array.from({ length: 7 }, (_, i) => ({ id: crypto.randomUUID(), url: 'https://jobs.lever.co/example/job' + i, key: 'jobs.lever.co/example/job' + i, state: 'queued', batch: 0 })),
});
describe('application queue', () => {
  it('accepts only an explicitly resolved destination while preserving the original job link', () => {
    const state = q(), item = state.items[0]!;
    const original = item.url;
    item.resolvedUrl = 'https://jobs.lever.co/example/actual-form/apply';
    expect(queueSchema.parse(state)).toBe(state);
    expect(queueJobMatches(item, item.resolvedUrl + '?utm_source=redirect')).toBe(true);
    expect(queueJobMatches(item, original)).toBe(false);
    expect(queueJobMatches(item, 'https://jobs.lever.co/example/another-job/apply')).toBe(false);
    for (const invalid of ['javascript:alert(1)', 'https://user:pass@example.com/apply', 'https://linkedin.com/jobs/1']) {
      item.resolvedUrl = invalid; expect(() => queueSchema.parse(state)).toThrow();
    }
  });
  it('preserves distinct generic job IDs in the tracker and parses comma-separated links', () => {
    expect(jobKey('https://example.com/apply?id=42')).not.toBe(jobKey('https://example.com/apply?id=43'));
    expect(jobKey('https://example.com/apply?id=42&utm_source=test')).toBe(jobKey('https://example.com/apply?id=42'));
    expect(parseQueueLinks('https://example.com/a,https://example.com/b ftp://example.com/c').urls).toHaveLength(2);
    expect(parseQueueLinks('https://example.com/a ftp://example.com/c').rejected).toHaveLength(1);
  });
  it('parses bullets and markdown, deduplicates posting/apply variants', () => {
    const result = parseQueueLinks('- https://jobs.lever.co/example/job1\n[Apply](https://jobs.lever.co/example/job1/apply?utm_source=x)\nhttps://jobs.lever.co/example/job2.');
    expect(result.urls).toHaveLength(2); expect(result.duplicates).toBe(1);
  });
  it('preserves generic query job IDs while removing tracking only', () => {
    expect(queueKey('https://example.com/apply?id=42&utm_source=a')).toBe(queueKey('https://example.com/apply?id=42'));
    expect(queueKey('https://example.com/apply?id=42')).not.toBe(queueKey('https://example.com/apply?id=43'));
  });
  it('excludes LinkedIn and credential-bearing links', () => {
    const p = parseQueueLinks('https://linkedin.com/jobs/42 https://user:password@example.com/apply https://jobs.lever.co/e/one');
    expect(p.rejected).toHaveLength(2); expect(p.urls).toHaveLength(1);
  });
  it('reports missing URLs and rejects over-limit input', () => {
    expect(parseQueueLinks('not a link').noLinks).toBe(true);
    expect(() => parseQueueLinks(Array.from({ length: 101 }, (_, i) => 'https://example.com/' + i).join('\n'))).toThrow(/100/);
  });
  it('claims independent fills only within the configured batch', () => {
    const state = q(), first = nextQueueItem(state)!;
    expect(state.items.filter(i => i.batch === 1)).toHaveLength(3);
    first.state = 'opening'; expect(nextQueueItem(state)).toBe(state.items[1]);
    state.items[1]!.state = 'opening'; state.items[2]!.state = 'filling';
    expect(nextQueueItem(state)).toBeUndefined();
    first.state = 'review'; expect(nextQueueItem(state)).toBeUndefined();
  });
  it('waits for all review items and their tabs before next batch', () => {
    const state = q(); nextQueueItem(state); state.items.slice(0,3).forEach(i=>{i.state='review'});
    state.items[0]!.state='submitted'; expect(nextQueueItem(state)).toBeUndefined();
    state.items[1]!.state='skipped'; state.items[2]!.state='submitted'; state.items[2]!.tabId=9;
    expect(nextQueueItem(state)).toBeUndefined();state.items[2]!.tabId=undefined;expect(nextQueueItem(state)?.batch).toBe(2);
  });
  it('continues other batch items while one needs action', () => {
    const state=q();nextQueueItem(state)!.state='needs-action';expect(nextQueueItem(state)?.batch).toBe(1);
  });
  it('pause and stop prevent claims', () => {
    for(const status of ['paused','stopped'] as const){const state=q();state.status=status;expect(nextQueueItem(state)).toBeUndefined();}
  });
  it('batch changes apply only to next batch', () => {
    const state=q();nextQueueItem(state);state.batchSize=1;
    expect(state.items.filter(i=>i.batch===1)).toHaveLength(3);
    state.items.slice(0,3).forEach(i=>{i.state='skipped'});nextQueueItem(state);expect(state.items.filter(i=>i.batch===2)).toHaveLength(1);
  });
  it('finishes after all items are resolved', () => {
    const state=q();state.items.forEach(i=>{i.state='skipped'});expect(nextQueueItem(state)).toBeUndefined();expect(state.status).toBe('complete');
  });
  it('rejects malformed storage and duplicated attempt/tab ownership', () => {
    const state=q();expect(queueSchema.parse(state)).toBe(state);
    expect(()=>queueSchema.parse({...state,schemaVersion:2})).toThrow();
    expect(()=>queueSchema.parse({...state,items:[{...state.items[0],url:'javascript:alert(1)'}]})).toThrow();
    state.items[0]!.state='opening';expect(()=>queueSchema.parse(state)).toThrow(/active/);
    state.batch=1;
    state.items.slice(0,3).forEach((i,index)=>Object.assign(i,{state:'filling',batch:1,attempt:crypto.randomUUID(),deadline:Date.now()+1000,frameId:0,tabId:index+1}));
    expect(queueSchema.parse(state)).toBe(state);
    state.items[1]!.attempt=state.items[0]!.attempt;expect(()=>queueSchema.parse(state)).toThrow(/Duplicate queue attempt/);
    state.items[1]!.attempt=crypto.randomUUID();state.items[1]!.tabId=state.items[0]!.tabId;expect(()=>queueSchema.parse(state)).toThrow(/Duplicate queue tab/);
  });
  it('bounds sizes strictly', () => {
    for(const v of [0,6,1.5,'3',null])expect(()=>batchSize(v)).toThrow();expect(batchSize(3)).toBe(3);
  });
});

describe('isolated queue review sessions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();timing.settle=1;
    document.body.innerHTML='<form><label for="essay">Why this team?</label><textarea id="essay" required></textarea></form>';
  });
  it('does not write a late AI response after disconnecting', async () => {
    let finish!: (value: {ok:true;answer:string}) => void;
    const answer=vi.fn(()=>new Promise<{ok:true;answer:string}>(r=>{finish=r}));
    const s=new FillSession(document,ADAPTERS.other,{context:{profile:sampleProfile(),resume:null,coverLetter:null,transcript:null,hasGeminiKey:true},answer,jobDescription:async()=>''});
    const run=s.run();await vi.waitFor(()=>expect(answer).toHaveBeenCalled());
    s.disconnect();finish({ok:true,answer:'A late fictional response'});await run;
    expect((document.querySelector('#essay') as HTMLTextAreaElement).value).toBe('');
  });
  it('preserves a user answer entered while AI is waiting', async () => {
    let finish!: (value: {ok:true;answer:string}) => void;
    const answer=vi.fn(()=>new Promise<{ok:true;answer:string}>(r=>{finish=r}));
    const s=new FillSession(document,ADAPTERS.other,{context:{profile:sampleProfile(),resume:null,coverLetter:null,transcript:null,hasGeminiKey:true},answer,jobDescription:async()=>''});
    const run=s.run();await vi.waitFor(()=>expect(answer).toHaveBeenCalled());
    (document.querySelector('#essay') as HTMLTextAreaElement).value='My manual answer';
    finish({ok:true,answer:'A late fictional response'});await run;
    expect((document.querySelector('#essay') as HTMLTextAreaElement).value).toBe('My manual answer');s.disconnect();
  });
  it('keeps new review questions teachable without launching another fill', async () => {
    const progress=vi.fn(),answer=vi.fn(async()=>({ok:true as const,answer:'Original response'}));
    const s=new FillSession(document,ADAPTERS.other,{context:{profile:sampleProfile(),resume:null,coverLetter:null,transcript:null,hasGeminiKey:true},answer,jobDescription:async()=>'',onProgress:progress});
    await s.run();s.observe(false);
    document.querySelector('form')!.insertAdjacentHTML('beforeend','<label for="later">First name</label><input id="later" autocomplete="given-name" required>');
    await vi.waitFor(()=>expect(progress).toHaveBeenCalled(),{timeout:2000});
    expect((document.querySelector('#later') as HTMLInputElement).value).toBe('');
    expect(answer).toHaveBeenCalledTimes(1);s.disconnect();
  });
});

it('fills canonical facts before waiting for AI question matching', async () => {
  document.body.innerHTML='<form><label for="name">First name</label><input id="name" autocomplete="given-name"><label for="custom">Which fictional tool do you prefer?</label><input id="custom" required></form>';
  let resolve!: (v: {ok:true;keys:null[]}) => void;
  const mapping=vi.fn(()=>new Promise<{ok:true;keys:null[]}>(r=>{resolve=r}));
  const profile=sampleProfile(); profile.preferredName='';
  const session=new FillSession(document,ADAPTERS.other,{context:{profile,resume:null,coverLetter:null,transcript:null,hasGeminiKey:true},answer:async()=>({ok:false,error:'No essay'}),mapFields:mapping,jobDescription:async()=>''});
  const run=session.run();await vi.waitFor(()=>expect(mapping).toHaveBeenCalled());
  expect((document.querySelector('#name') as HTMLInputElement).value).toBe(profile.firstName);
  resolve({ok:true,keys:[null]});await run;session.disconnect();
});
