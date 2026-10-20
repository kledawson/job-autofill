import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FillSession } from '../lib/autofill/engine';
import { ADAPTERS } from '../lib/autofill/adapters';
import { timing } from '../lib/autofill/fill';
import { parseFieldFeedback } from '../lib/field-feedback';
import { CHAT_PROVIDERS, composerSelectors, insertPrompt, onProviderSite, parseAnswerSource } from '../lib/chat-providers';
import { sampleProfile } from './helpers';
import { needReviewCount, needReviewFields, showsFillResults } from '../lib/application-workflow';
import { DEFAULT_PROMPT_TEMPLATE, isPreviousDefaultTemplate, PREVIOUS_DEFAULT_PROMPT_TEMPLATE, renderBatchPrompt, renderPrompt, splitBatchReply } from '../lib/prompt';
import { fetchPostingDescription, findPostingLink, readPostingDescription } from '../lib/posting-link';
import type { FieldFeedback } from '../lib/field-feedback';

const priorTiming = { ...timing };
beforeEach(() => { Object.assign(timing, { settle: 0, reveal: 0, menuOpen: 1 }); });
afterEach(() => { document.body.innerHTML = ''; Object.assign(timing, priorTiming); vi.restoreAllMocks(); });

function setup(html: string) {
  document.body.innerHTML = '<form id="application-form">' + html + '</form>';
  const answer = vi.fn(async () => ({ ok: true as const, answer: 'A Gemini draft that must not be used.' }));
  const jobDescription = vi.fn(async () => 'Build fictional tools for a fictional team.');
  const session = new FillSession(document, ADAPTERS.greenhouse, {
    context: { profile: sampleProfile(), resume: null, coverLetter: null, transcript: null, hasGeminiKey: true, chatProvider: 'ChatGPT' },
    answer, jobDescription,
  });
  return { session, answer, jobDescription };
}
const ESSAY = '<label>Why do you want to work here?<textarea id="essay" required></textarea></label>';

describe('free responses drafted on a chat website', () => {
  it('leaves free responses for the person and never calls the Gemini API, even with a key', async () => {
    const { session, answer } = setup('<label>First name<input id="first" required></label>' + ESSAY);
    try {
      const result = await session.run();
      expect(answer).not.toHaveBeenCalled();
      expect(document.querySelector<HTMLTextAreaElement>('#essay')!.value).toBe('');
      const essay = result.fieldFeedback!.find(f => f.label.startsWith('Why do you'));
      expect(essay).toMatchObject({ status: 'missing', draft: true, source: 'none' });
      expect(essay!.reason).toContain('Draft in ChatGPT');
      expect(result.fieldFeedback!.find(f => f.label === 'First name')!.draft).toBeUndefined();
      expect(result.aiNote).toContain('Draft in ChatGPT');
      expect(parseFieldFeedback(result.fieldFeedback)).toEqual(result.fieldFeedback);
    } finally { session.disconnect(); }
  });

  it('builds a draft request from the question and posting, not from page answers', async () => {
    const { session, jobDescription } = setup('<label>First name<input id="first" required></label>' + ESSAY);
    try {
      const result = await session.run();
      const essay = result.fieldFeedback!.find(f => f.draft)!;
      const request = await session.draftRequest(essay.token, essay.label);
      expect(request).toMatchObject({ question: 'Why do you want to work here?', jobDescription: 'Build fictional tools for a fictional team.' });
      expect(request.characterLimit).toBeGreaterThan(0);
      expect(jobDescription).toHaveBeenCalled();
      expect(JSON.stringify(request)).not.toContain(sampleProfile().firstName);
      const first = result.fieldFeedback!.find(f => f.label === 'First name')!;
      await expect(session.draftRequest(first.token, first.label)).rejects.toThrow(/no longer on the page/);
      await expect(session.draftRequest(essay.token, 'A different question entirely')).rejects.toThrow(/no longer on the page/);
    } finally { session.disconnect(); }
  });

  it('writes a pasted reply as an AI draft to review, trimmed to the field limit', async () => {
    const { session } = setup('<label>Why do you want to work here?<textarea id="essay" maxlength="60" required></textarea></label>');
    try {
      const essay = (await session.run()).fieldFeedback!.find(f => f.draft)!;
      const reply = '**Answer:** I enjoy building fictional tools. I also like clear writing. And long sentences that go past the limit.';
      const note = session.applyDraft(essay.token, essay.label, reply);
      const box = document.querySelector<HTMLTextAreaElement>('#essay')!;
      expect(box.value.length).toBeLessThanOrEqual(60);
      expect(box.value).toBe('I enjoy building fictional tools. I also like clear writing.');
      expect(note).toMatch(/shortened/);
      const after = session.summary().fieldFeedback!.find(f => f.token === essay.token)!;
      expect(after).toMatchObject({ status: 'review', source: 'ai' });
      expect(after.draft).toBeUndefined();
      expect(box.getAttribute('data-jaf-state')).toBe('ai');
    } finally { session.disconnect(); }
  });

  it('keeps an answer the person already typed instead of replacing it', async () => {
    const { session } = setup(ESSAY);
    try {
      const essay = (await session.run()).fieldFeedback!.find(f => f.draft)!;
      const box = document.querySelector<HTMLTextAreaElement>('#essay')!;
      box.value = 'My own answer.';
      expect(() => session.applyDraft(essay.token, essay.label, 'A pasted reply.')).toThrow(/already has an answer/);
      await expect(session.draftRequest(essay.token, essay.label)).rejects.toThrow(/already has an answer/);
      expect(box.value).toBe('My own answer.');
      expect(session.summary().fieldFeedback!.find(f => f.token === essay.token)!.draft).toBeUndefined();
    } finally { session.disconnect(); }
  });

  it('still uses the reply after the page redraws the question with a new element', async () => {
    const { session } = setup('<label>First name<input id="first" required></label>' + ESSAY);
    try {
      const essay = (await session.run()).fieldFeedback!.find(f => f.draft)!;
      session.observe(true);
      await session.draftRequest(essay.token, essay.label);
      // React-style rerender while the person is in the chat tab: same question, new textarea.
      const label = document.querySelector('#essay')!.parentElement!;
      label.replaceChild(Object.assign(document.createElement('textarea'), { id: 'essay', required: true }), document.querySelector('#essay')!);
      // A refresh in between drops the old record, so the watcher records the redrawn box as a new field.
      expect(session.summary().fieldFeedback!.some(f => f.token === essay.token)).toBe(false);
      await new Promise(r => setTimeout(r, 900));
      const redrawn = session.summary().fieldFeedback!.find(f => f.label === essay.label)!;
      expect(redrawn.draft).toBe(true);
      expect(redrawn.token).not.toBe(essay.token);
      expect(session.applyDraft(essay.token, essay.label, 'A reply pasted from the chat.')).toMatch(/Added for review/);
      expect(document.querySelector<HTMLTextAreaElement>('#essay')!.value).toBe('A reply pasted from the chat.');
      expect(session.summary().fieldFeedback!.find(f => f.label === essay.label)).toMatchObject({ status: 'review', source: 'ai' });
    } finally { session.disconnect(); }
  });

  it('lowers Need review when the person answers a question or a draft is used', async () => {
    const { session } = setup('<label>Fictional reference<input id="ref" required></label>' + ESSAY);
    try {
      const result = await session.run();
      const app = (summary: typeof result) => ({ fieldFeedback: summary.fieldFeedback, reviewFields: summary.reviewFields, missingCount: summary.missingLabels.length });
      expect(needReviewCount(app(result))).toBe(2);
      document.querySelector<HTMLInputElement>('#ref')!.value = 'Typed by the person';
      expect(needReviewCount(app(session.summary()))).toBe(1);
      const essay = result.fieldFeedback!.find(f => f.draft)!;
      session.applyDraft(essay.token, essay.label, 'A reply pasted from the chat.');
      const after = session.summary();
      expect(needReviewCount(app(after))).toBe(0);
      expect(after.aiAnswers).toBe(1);
    } finally { session.disconnect(); }
  });

  it('with None, writes no free responses but still offers drafting if a chat website is chosen later', async () => {
    document.body.innerHTML = '<form id="application-form"><label>First name<input id="first" required></label>' + ESSAY + '<label>Anything else to share?<textarea id="extra"></textarea></label></form>';
    const answer = vi.fn(async () => ({ ok: true as const, answer: 'Must not be used.' }));
    const session = new FillSession(document, ADAPTERS.greenhouse, {
      context: { profile: sampleProfile(), resume: null, coverLetter: null, transcript: null, hasGeminiKey: true, freeResponses: 'none' },
      answer, jobDescription: async () => '',
    });
    try {
      const result = await session.run();
      expect(answer).not.toHaveBeenCalled();
      expect(document.querySelector<HTMLTextAreaElement>('#essay')!.value).toBe('');
      expect(result.aiNote).toBeUndefined();
      expect(result.fieldFeedback!.find(f => f.label.startsWith('Why do you'))).toMatchObject({ status: 'missing', draft: true });
      // Optional questions are outlined yellow on the page; required gaps stay red.
      expect(document.querySelector('#extra')!.getAttribute('data-jaf-state')).toBe('optional');
      expect(document.querySelector('#essay')!.getAttribute('data-jaf-state')).toBe('missing');
    } finally { session.disconnect(); }
  });

  it('rejects an empty reply', async () => {
    const { session } = setup(ESSAY);
    try {
      const essay = (await session.run()).fieldFeedback!.find(f => f.draft)!;
      expect(() => session.applyDraft(essay.token, essay.label, '   ')).toThrow(/Paste the reply/);
    } finally { session.disconnect(); }
  });
});

describe('putting the prompt in a chat message box', () => {
  const shown = (el: Element) => { el.getBoundingClientRect = () => ({ width: 300, height: 40 }) as DOMRect; return el; };
  const PROMPT = 'Write my answer to one application question.\n\nQuestion: Why here?';

  it('types into an empty textarea with the editing command and never submits', async () => {
    document.body.innerHTML = '<form><textarea name="prompt"></textarea><button type="submit">Send</button></form>';
    const box = shown(document.querySelector('textarea')!) as HTMLTextAreaElement;
    const submit = vi.fn((e: Event) => e.preventDefault());
    document.querySelector('form')!.addEventListener('submit', submit);
    const click = vi.spyOn(HTMLButtonElement.prototype, 'click');
    const exec = vi.fn((_command: string, _ui: boolean, text: string) => { box.value = text; return true; });
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    expect(await insertPrompt(PROMPT, composerSelectors(CHAT_PROVIDERS.chatgpt), 50)).toBe('inserted');
    expect(exec).toHaveBeenCalledWith('insertText', false, PROMPT);
    expect(box.value).toBe(PROMPT);
    expect(submit).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it('uses a rich editor’s paste handling when it accepts the text', async () => {
    document.body.innerHTML = '<div id="ask-input" contenteditable="true" role="textbox"></div>';
    const box = shown(document.querySelector('#ask-input')!) as HTMLElement;
    box.addEventListener('paste', e => { box.textContent = (e as ClipboardEvent).clipboardData!.getData('text/plain'); e.preventDefault(); });
    Object.defineProperty(box, 'innerText', { get: () => box.textContent ?? '', configurable: true });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    expect(await insertPrompt(PROMPT, composerSelectors(CHAT_PROVIDERS.perplexity), 50)).toBe('inserted');
    expect(exec).not.toHaveBeenCalled();
  });

  it('leaves text the person already typed alone', async () => {
    document.body.innerHTML = '<textarea name="prompt">Half-written question</textarea>';
    const box = shown(document.querySelector('textarea')!) as HTMLTextAreaElement;
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    expect(await insertPrompt(PROMPT, composerSelectors(CHAT_PROVIDERS.chatgpt), 50)).toBe('occupied');
    expect(exec).not.toHaveBeenCalled();
    expect(box.value).toBe('Half-written question');
  });

  it('reports a missing message box, such as a sign-in page, and a box that refuses the text', async () => {
    document.body.innerHTML = '<input type="password">';
    expect(await insertPrompt(PROMPT, composerSelectors(CHAT_PROVIDERS.claude), 50)).toBe('missing');
    document.body.innerHTML = '<form><textarea></textarea></form>';
    shown(document.querySelector('textarea')!);
    Object.defineProperty(document, 'execCommand', { value: vi.fn(() => false), configurable: true });
    expect(await insertPrompt(PROMPT, composerSelectors(CHAT_PROVIDERS.claude), 50)).toBe('rejected');
  });
});

describe('chat provider settings', () => {
  it('starts with none for a first-time person, Gemini API for someone who already saved a key, and keeps a choice', () => {
    expect(parseAnswerSource(undefined)).toBe('none');
    expect(parseAnswerSource(undefined, true)).toBe('gemini-api');
    expect(parseAnswerSource('none', true)).toBe('none');
    expect(parseAnswerSource('chatgpt')).toBe('chatgpt');
    expect(parseAnswerSource('gemini-api')).toBe('gemini-api');
    expect(parseAnswerSource('https://evil.example')).toBe('none');
  });

  it('matches only the provider’s own origins', () => {
    expect(onProviderSite(CHAT_PROVIDERS.chatgpt, 'https://chatgpt.com/c/123')).toBe(true);
    expect(onProviderSite(CHAT_PROVIDERS.chatgpt, 'https://auth.openai.com/log-in')).toBe(false);
    expect(onProviderSite(CHAT_PROVIDERS.chatgpt, 'https://chatgpt.com.evil.example/')).toBe(false);
    expect(onProviderSite(CHAT_PROVIDERS.perplexity, 'https://perplexity.ai/')).toBe(true);
    expect(onProviderSite(CHAT_PROVIDERS.claude, undefined)).toBe(false);
  });

  it('rejects a malformed draft flag in stored field feedback', () => {
    expect(() => parseFieldFeedback([{ token: 'a1', label: 'Why here?', required: true, status: 'missing', source: 'none', reason: '', draft: 'yes' }])).toThrow();
  });
});

describe('several free responses in one prompt', () => {
  it('numbers the questions with their limits inside the person’s template and asks for marked answers', () => {
    const prompt = renderBatchPrompt('Q:\n{question}\nJob: {jobDescription}\nLimit {characterLimit}', [
      { question: 'Why Fictional Co?', characterLimit: 1500 }, { question: 'Describe a project.', characterLimit: 600 },
    ], { company: 'Fictional Co', role: 'Engineer', jobDescription: 'Build tools.' }, sampleProfile());
    expect(prompt).toContain('1. Why Fictional Co?\n2. Describe a project.\n');
    expect(prompt).not.toMatch(/\(up to \d+ characters\)/);
    expect(prompt).toContain('Limit 600');
    expect(prompt).toContain('Answer 1\n<your answer to question 1>\n\nAnswer 2\n<your answer to question 2>');
  });

  it('splits a reply by its answer markers, tolerating markdown from a chat copy button', () => {
    const reply = 'Sure! Here you go.\n\n**Answer 1**\nI admire the mission.\n\nIt fits me.\n\n### Answer 2:\nI built a fictional tool.\n';
    expect(splitBatchReply(reply, 2)).toEqual(['I admire the mission.\n\nIt fits me.', 'I built a fictional tool.']);
    expect(splitBatchReply('Answer 2\nOnly the second.', 3)).toEqual(['', 'Only the second.', '']);
    expect(splitBatchReply('No markers at all.', 2)).toEqual(['', '']);
    // A sentence that merely starts with "Answer" is not a marker.
    expect(splitBatchReply('Answer 1\nAnswer 2 people asked me about it.\nAnswer 2\nSecond.', 2)).toEqual(['Answer 2 people asked me about it.', 'Second.']);
  });
});

describe('Need review list and refreshed pages', () => {
  const f = (token: string, status: FieldFeedback['status'], required: boolean, source: FieldFeedback['source'] = 'none'): FieldFeedback => ({ token, label: token, required, status, source, reason: '' });
  it('lists unanswered and unverifiable questions, required gaps first, without answered or AI-drafted ones', () => {
    const fieldFeedback = [f('optional', 'optional', false), f('typed', 'entered', true, 'page'), f('ai', 'review', true, 'ai'),
      f('widget', 'review', false, 'profile'), f('required', 'missing', true), f('done', 'verified', true, 'profile')];
    expect(needReviewFields({ fieldFeedback }).map(x => x.token)).toEqual(['required', 'widget', 'optional']);
    // Only required questions are counted; optional ones stay in the list.
    expect(needReviewCount({ fieldFeedback, missingCount: 1 })).toBe(1);
  });
  it('hides a reloaded fill but keeps a submitted one', () => {
    expect(showsFillResults({ status: 'Ready for review' })).toBe(true);
    expect(showsFillResults({ status: 'Ready for review', pageCleared: true })).toBe(false);
    expect(showsFillResults({ status: 'Submitted', pageCleared: true })).toBe(true);
    expect(showsFillResults(undefined)).toBe(false);
  });
});

describe('the job posting in free-response prompts', () => {
  const page = (html: string) => { document.body.innerHTML = html; return document; };

  it('prefers a same-site link back to the posting, then the posting the form address points to', () => {
    expect(findPostingLink(page('<a href="/jobs/42">View job description</a><a href="https://elsewhere.example/jobs/42">Job description</a>'), 'https://careers.fictional.example/jobs/42/apply?step=application'))
      .toBe('https://careers.fictional.example/jobs/42');
    expect(findPostingLink(page('<a href="https://elsewhere.example/jobs/42">Job description</a>'), 'https://jobs.lever.co/fictional/abc/apply'))
      .toBe('https://jobs.lever.co/fictional/abc');
    expect(findPostingLink(page('<a href="#details">Job details</a>'), 'https://job-boards.greenhouse.io/fictional/jobs/4242#app'))
      .toBe('https://job-boards.greenhouse.io/fictional/jobs/4242');
    expect(findPostingLink(page('<a href="javascript:alert(1)">Job description</a>'), 'about:blank')).toBe('');
  });

  it('names the posting in the default prompt and in templates written before the placeholder existed', () => {
    const ctx = { question: 'Why us?', jobDescription: 'Build tools.', company: 'Fictional Co', role: 'Engineer', characterLimit: 800, jobUrl: 'https://jobs.lever.co/fictional/abc' };
    expect(renderPrompt(DEFAULT_PROMPT_TEMPLATE, ctx, sampleProfile())).toContain('Job posting: https://jobs.lever.co/fictional/abc');
    expect(renderPrompt('Answer {question}', ctx, sampleProfile())).toBe('Answer Why us?\n\nJob posting: https://jobs.lever.co/fictional/abc');
    expect(PREVIOUS_DEFAULT_PROMPT_TEMPLATE).not.toContain('{jobUrl}');
    expect(isPreviousDefaultTemplate(PREVIOUS_DEFAULT_PROMPT_TEMPLATE)).toBe(true);
    expect(isPreviousDefaultTemplate(DEFAULT_PROMPT_TEMPLATE)).toBe(false);
    expect(isPreviousDefaultTemplate(DEFAULT_PROMPT_TEMPLATE.replace("the question's character limit.", "the question's character limit of {characterLimit} characters."))).toBe(true);
    expect(isPreviousDefaultTemplate('Answer {question} briefly.')).toBe(false);
  });

  it('reads a fetched posting’s description from its JobPosting data or description block', () => {
    const fromData = new DOMParser().parseFromString('<script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","description":"<p>Build <b>fictional</b> tools.</p>"}</script><main>Menu</main>', 'text/html');
    expect(readPostingDescription(fromData)).toBe('Build fictional tools.');
    const fromBlock = new DOMParser().parseFromString('<nav>Home</nav><div class="job-description">  Analyse   synthetic data.\n\n  Report weekly. </div>', 'text/html');
    expect(readPostingDescription(fromBlock)).toBe('Analyse synthetic data.\nReport weekly.');
  });

  it('fetches only another page on the same site', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => '<div class="job-description">Fictional duties.</div>' }) as Response);
    expect(await fetchPostingDescription('https://careers.fictional.example/jobs/42', 'https://careers.fictional.example/jobs/42/apply')).toBe('Fictional duties.');
    expect(fetch).toHaveBeenCalledWith('https://careers.fictional.example/jobs/42', expect.objectContaining({ credentials: 'include' }));
    fetch.mockClear();
    expect(await fetchPostingDescription('https://elsewhere.example/jobs/42', 'https://careers.fictional.example/jobs/42/apply')).toBe('');
    expect(await fetchPostingDescription('https://careers.fictional.example/jobs/42#top', 'https://careers.fictional.example/jobs/42')).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });
});

