import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPreset, parsePreset, preparedResponse, profileForPreset } from '../lib/presets';
import { sampleProfile } from './helpers';
import { FillSession } from '../lib/autofill/engine';
import { ADAPTERS } from '../lib/autofill/adapters';
import { timing } from '../lib/autofill/fill';

describe('application preset validation and resolution', () => {
  it('Default inherits documents and presentation without altering applicant facts', () => {
    const profile = sampleProfile(), preset = parsePreset(defaultPreset()), resolved = profileForPreset(profile, preset);
    expect(resolved).toEqual(profile);
    expect(resolved).not.toBe(profile);
    expect(preset.resume).toBe('profile');
  });
  it('overrides only approved presentation links and preserves all qualifications and disclosures', () => {
    const profile = sampleProfile(), original = structuredClone(profile);
    const preset = parsePreset({ ...defaultPreset(), links: { portfolio: 'https://example.com/hardware', github: '', website: null }, education: [], workAuth: {} });
    const resolved = profileForPreset(profile, preset);
    expect(resolved.portfolio).toBe('https://example.com/hardware');
    expect(resolved.github).toBe('');
    expect(resolved.website).toBe(profile.website);
    for (const key of ['firstName', 'email', 'education', 'experience', 'workAuth', 'eeo', 'skills'] as const) expect(resolved[key]).toEqual(profile[key]);
    expect(profile).toEqual(original);
    expect(preset).not.toHaveProperty('workAuth');
  });
  it.each([
    { schemaVersion: 99 }, { revision: 0 }, { id: '../../profile' }, { name: '' },
    { resume: 'not-a-document-id' }, { emphasis: 'x'.repeat(4001) },
    { links: { portfolio: 'javascript:alert(1)', github: null, website: null } },
    { links: { portfolio: 'https://user:password@example.com', github: null, website: null } },
    { responses: [{ question: 'Why this role?', answer: '', aliases: [] }] },
  ])('rejects malformed preset data %j', patch => expect(() => parsePreset({ ...defaultPreset(), ...patch })).toThrow());
  it('rejects overlapping response questions and aliases rather than picking an arbitrary answer', () => {
    expect(() => parsePreset({ ...defaultPreset(), responses: [
      { question: 'Why this role?', answer: 'Software', aliases: ['Why this position?'] },
      { question: 'WHY THIS POSITION *', answer: 'Hardware', aliases: [] },
    ] })).toThrow(/overlap/);
  });
  it('uses only confirmed wordings and preserves negative and different-subject questions', () => {
    const responses = [{ question: 'Why this role?', aliases: ['Why this position?'], answer: 'A verified accomplishment.' }];
    expect(preparedResponse(responses, ' WHY THIS POSITION? * ')).toBe(responses[0]!.answer);
    expect(preparedResponse(responses, 'Why this company?')).toBeUndefined();
    expect(preparedResponse(responses, 'Why not this role?')).toBeUndefined();
  });
});

describe('prepared response engine integration', () => {
  beforeEach(() => { Object.assign(timing, { settle: 0, afterUpload: 0 }); });
  function session(html: string, responses: ReturnType<typeof defaultPreset>['responses']) {
    document.body.innerHTML = '<form id="application-form">' + html + '</form>';
    const answer = vi.fn(async () => ({ ok: true as const, answer: 'AI fallback' }));
    const instance = new FillSession(document, ADAPTERS.greenhouse, {
      context: { profile: sampleProfile(), resume: null, coverLetter: null, transcript: null, hasGeminiKey: true, preset: defaultPresetWith(responses) },
      answer, jobDescription: async () => '',
    });
    return { instance, answer };
  }
  const defaultPresetWith = (responses: ReturnType<typeof defaultPreset>['responses']) => ({ ...defaultPreset(), responses });
  const response = { question: 'Tell us about your proudest accomplishment', aliases: ['Describe your proudest accomplishment'], answer: 'I built the Acme billing dashboard.' };
  it('fills a preset response before AI, including approved alternate wording', async () => {
    const { instance, answer } = session('<label for="essay">Describe your proudest accomplishment</label><textarea id="essay" required></textarea>', [response]);
    const result = await instance.run();
    expect((document.querySelector('#essay') as HTMLTextAreaElement).value).toBe(response.answer);
    expect(answer).not.toHaveBeenCalled();
    expect(result.aiAnswers).toBe(0);
    expect(result.filledCount).toBe(1);
    instance.disconnect();
  });
  it('preserves manual edits and does not truncate an authored response to fit a shorter field', async () => {
    const { instance } = session('<label for="essay">Tell us about your proudest accomplishment</label><textarea id="essay" required>My manual answer</textarea><label for="short">Describe your proudest accomplishment</label><textarea id="short" required maxlength="10"></textarea>', [response]);
    const result = await instance.run();
    expect((document.querySelector('#essay') as HTMLTextAreaElement).value).toBe('My manual answer');
    expect((document.querySelector('#short') as HTMLTextAreaElement).value).toBe('');
    expect(result.missingLabels).toContain('Describe your proudest accomplishment');
    instance.disconnect();
  });
  it('cannot replace first name or authorization with a prepared response', async () => {
    const { instance, answer } = session('<label for="name">First name</label><input id="name" autocomplete="given-name"><label for="auth">Are you legally authorized to work in the United States?</label><select id="auth"><option value="">Select</option><option>Yes</option><option>No</option></select>', [
      { question: 'First name', answer: 'A different person', aliases: [] },
      { question: 'Are you legally authorized to work in the United States?', answer: 'No', aliases: [] },
    ]);
    await instance.run();
    expect((document.querySelector('#name') as HTMLInputElement).value).toBe(sampleProfile().preferredName || sampleProfile().firstName);
    expect((document.querySelector('#auth') as HTMLSelectElement).value).toBe('Yes');
    expect(answer).not.toHaveBeenCalled();
    instance.disconnect();
  });
});
