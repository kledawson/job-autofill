import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FillSession } from '../lib/autofill/engine';
import { ADAPTERS } from '../lib/autofill/adapters';
import { timing } from '../lib/autofill/fill';
import { feedbackPriority, parseFieldFeedback, type FieldFeedback } from '../lib/field-feedback';
import { sampleProfile } from './helpers';
import { scanFields } from '../lib/autofill/scan';

const priorTiming = { ...timing };
beforeEach(() => { Object.assign(timing, { settle: 0, reveal: 0, menuOpen: 1 }); });
afterEach(() => { document.body.innerHTML = ''; Object.assign(timing, priorTiming); vi.restoreAllMocks(); });
function setup(html: string, ai = false) {
  document.body.innerHTML = '<form id="application-form">' + html + '</form>';
  return new FillSession(document, ADAPTERS.greenhouse, {
    context: { profile: sampleProfile(), resume: null, coverLetter: null, transcript: null, hasGeminiKey: ai },
    answer: async () => ({ ok: true, answer: 'A fictional draft for review.' }), jobDescription: async () => '',
  });
}
it('reports verified, manual, optional, missing and AI states without applicant values', async () => {
  const session = setup('<label>First name<input id="first" required></label><label>Email<input id="email" value="existing@fictional.example"></label><label>Fictional reference<input id="custom" required></label><label>Optional code<input id="optional"></label><label>Tell us about your proudest accomplishment<textarea id="essay" required></textarea></label>', true);
  try {
    const result = await session.run(), feedback = result.fieldFeedback!;
    expect(feedback.find(f => f.label === 'First name')).toMatchObject({ status: 'verified', source: 'profile', required: true });
    expect(feedback.find(f => f.label === 'Email')).toMatchObject({ status: 'entered', source: 'page' });
    expect(feedback.find(f => f.label === 'Optional code')).toMatchObject({ status: 'optional', source: 'none' });
    expect(feedback.find(f => f.label === 'Fictional reference')).toMatchObject({ status: 'missing', required: true });
    expect(feedback.find(f => f.label.includes('proudest'))).toMatchObject({ status: 'review', source: 'ai' });
    expect(document.querySelector('#essay')?.getAttribute('data-jaf-state')).toBe('ai');
    expect(JSON.stringify(feedback)).not.toMatch(/Jordan|existing@fictional|A fictional draft/);
    expect(parseFieldFeedback(feedback)).toEqual(feedback);
  } finally { session.disconnect(); }
});
it('removes green after a manual edit, preserves the edit, and permits explicit capture', async () => {
  const session = setup('<label>First name<input id="first" required></label>');
  try {
    await session.run(); const input = document.querySelector<HTMLInputElement>('#first')!;
    input.value = 'Manually corrected';
    const result = session.summary();
    expect(result.fieldFeedback![0]).toMatchObject({ status: 'entered', source: 'page' });
    expect(input.getAttribute('data-jaf-state')).toBe('entered');
    expect(result.filledCount).toBe(0); expect(input.value).toBe('Manually corrected');
    expect(session.captureAnswer(result.reviewFields![0]!.token, 'First name').value).toBe('Manually corrected');
    input.value = ''; expect(session.summary().fieldFeedback![0]!.status).toBe('missing');
  } finally { session.disconnect(); }
});
it('shows unsupported uploads with a clear manual action but never offers Memory capture for them', async () => {
  const session = setup('<label>Academic transcript<input id="transcript" type="file" required></label>');
  try {
    const result = await session.run(); expect(result.fieldFeedback![0]).toMatchObject({ status: 'missing', reason: 'Upload this document on the application page.' });
    expect(result.reviewFields).toHaveLength(0);
  } finally { session.disconnect(); }
});
it('Show field scrolls and focuses once without changing the answer or capturing it', async () => {
  const session = setup('<label>Fictional reference<input id="custom" required></label>');
  try {
    const result = await session.run(), field = document.querySelector<HTMLInputElement>('#custom')!;
    const scroll = vi.fn(); field.scrollIntoView = scroll;
    const focus = vi.spyOn(field, 'focus'), capture = vi.spyOn(session, 'captureAnswer');
    session.showField(result.fieldFeedback![0]!.token, 'Fictional reference');
    expect(scroll).toHaveBeenCalledTimes(1); expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(capture).not.toHaveBeenCalled(); expect(field.value).toBe('');
    field.hidden = true; expect(() => session.showField(result.fieldFeedback![0]!.token, 'Fictional reference')).toThrow('hidden');
    expect(scroll).toHaveBeenCalledTimes(1);
  } finally { session.disconnect(); }
});
it('rejects stale field tokens and changed questions instead of locating a different control', async () => {
  const session = setup('<label for="custom">Fictional reference</label><input id="custom" required>');
  try {
    const result = await session.run();
    document.querySelector('label')!.textContent = 'Different question';
    expect(() => session.showField(result.fieldFeedback![0]!.token, 'Fictional reference')).toThrow('changed');
    expect(() => session.showField('unknown-token', 'Different question')).toThrow('changed');
  } finally { session.disconnect(); }
});
it('validates new metadata conservatively and rejects duplicate tokens', () => {
  const item: FieldFeedback = { token: 'example-token', label: 'First name', required: true, source: 'profile', status: 'verified', reason: 'Read back.' };
  expect(parseFieldFeedback([{ ...item, unwantedAnswer: 'discard' }])[0]).not.toHaveProperty('unwantedAnswer');
  for (const mutation of [{ status: 'certain' }, { source: 'remote' }, { required: 'yes' }, { reason: 'x'.repeat(301) }]) expect(() => parseFieldFeedback([{ ...item, ...mutation }])).toThrow();
  expect(() => parseFieldFeedback([item, item])).toThrow(); expect(() => parseFieldFeedback(Array(201).fill(item))).toThrow();
  expect(feedbackPriority({ status: 'missing', required: true })).toBeLessThan(feedbackPriority({ status: 'review', required: true }));
  expect(feedbackPriority({ status: 'review', required: false })).toBeLessThan(feedbackPriority({ status: 'optional', required: false }));
});
it('keeps nested dropdown options and textarea answers out of wrapping question labels', () => {
  setup('<label>Fictional schedule<select><option>Select...</option><option>Morning</option></select></label><label>Fictional note<textarea>A private existing answer</textarea></label>');
  expect(scanFields(document).map(f => f.label)).toEqual(['Fictional schedule', 'Fictional note']);
});
it('uses a wrapping label before unrelated nearby headings and previous questions', () => {
  document.body.innerHTML = '<h1>Fictional Engineer</h1><form><label>First name<input autocomplete="given-name"></label><label>Email<input type="email"></label></form>';
  expect(scanFields(document).map(f => f.label)).toEqual(['First name', 'Email']);
});
