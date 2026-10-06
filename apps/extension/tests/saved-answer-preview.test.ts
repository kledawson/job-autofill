import { describe, expect, it } from 'vitest';
import { meaningDescription, previewContextFor, previewSavedAnswer } from '../lib/saved-answer-preview';
import { questionMeaning } from '../lib/answer-semantics';
import type { MappingDraft, RememberedMapping } from '../lib/remembered-mappings';
import { sampleProfile } from './helpers';

const context = { platform: 'greenhouse' as const, company: 'Contoso', url: 'https://job-boards.greenhouse.io/contoso/jobs/123' };
const draft: MappingDraft = { question: 'Degree', aliases: [], target: { kind: 'answer', value: 'BS' }, scope: 'all', meaning: questionMeaning('Degree')! };
const record = (m: MappingDraft, id = 1): RememberedMapping => ({ ...m, id, schemaVersion: 2, updatedAt: 1 });
const preview = (m = draft, q = 'Educational qualification', choices: string[] | null = ['Bachelor of Science', 'Bachelor of Arts'], records: RememberedMapping[] = []) => previewSavedAnswer(m, q, choices, context, sampleProfile(), records);

describe('saved-answer local preview', () => {
  it('uses production question meanings and degree choices without conflating BS and BA', () => {
    expect(preview()).toMatchObject({ outcome: 'fill', answer: 'Bachelor of Science' });
    expect(preview(draft, 'Educational qualification', ['Bachelor of Arts'])).toMatchObject({ outcome: 'skip' });
    expect(preview({ ...draft, target: { kind: 'answer', value: "Bachelor's Degree" } })).toMatchObject({ outcome: 'skip' });
  });
  it('distinguishes new suggestions from approved wordings', () => {
    const m: MappingDraft = { question: 'Which channel led you to this opening?', aliases: [], target: { kind: 'answer', value: 'Referral' }, scope: 'all' };
    const q = 'Which channel brought you to this opening?';
    expect(preview(m, q, null)).toMatchObject({ outcome: 'confirm' });
    expect(preview({ ...m, aliases: [q] }, q, null)).toMatchObject({ outcome: 'fill', answer: 'Referral' });
    expect(preview(m, 'What is your current clearance?', null).outcome).toBe('skip');
  });
  it('checks scope and competing answers, and does not expose a different stored answer', () => {
    expect(preview({ ...draft, scope: 'company:other' }).outcome).toBe('skip');
    expect(preview({ ...draft, scope: 'site:https://example.com' }).outcome).toBe('skip');
    expect(preview({ ...draft, scope: `application:${context.url}?other=1` }).outcome).toBe('skip');
    expect(preview({ ...draft, scope: `site:${new URL(context.url).origin}` }).outcome).toBe('fill');
    const narrow = record({ ...draft, scope: 'company:contoso', target: { kind: 'answer', value: 'Private other answer' } });
    const result = preview(draft, 'Degree', null, [narrow]);
    expect(result.outcome).toBe('skip');
    expect(result.answer).toBeUndefined();
    expect(result.reason).not.toContain('Private');
  });
  it('detects save conflicts but allows editing/updating the original record', () => {
    const stored = record(draft);
    expect(preview(draft, 'Degree', null, [stored]).outcome).toBe('fill');
    expect(preview({ ...draft, question: 'Educational qualification' }, 'Degree', null, [stored]).outcome).toBe('skip');
    expect(previewSavedAnswer({ ...draft, question: 'Educational qualification' }, 'Degree', null, context, sampleProfile(), [stored], 1).outcome).toBe('fill');
  });
  it('matches authored option labels, rejects duplicates, and reflects removal', () => {
    const m: MappingDraft = { question: 'Which exam result applies?', aliases: [], target: { kind: 'answer', value: 'Not taken' }, scope: 'all', answerAliases: ['Did not take'] };
    expect(preview(m, m.question, ['Did not take', '1200'])).toMatchObject({ outcome: 'fill', answer: 'Did not take' });
    expect(preview(m, m.question, ['Did not take', 'Did not take']).outcome).toBe('skip');
    expect(preview({ ...m, answerAliases: [] }, m.question, ['Did not take']).outcome).toBe('skip');
  });
  it('uses latest profile facts and ignores stale custom labels on profile links', () => {
    const m: MappingDraft = { ...draft, question: 'Are you a US citizen?', meaning: questionMeaning('Are you a US citizen?')!, target: { kind: 'profile', key: 'usCitizen' }, answerAliases: ['Yes, I am a citizen'] };
    const p = sampleProfile();
    expect(previewSavedAnswer(m, m.question, ['Yes, I am a citizen', 'No'], context, p, []).answer).toBe('Yes, I am a citizen');
    p.workAuth.status = 'H-1B';
    expect(previewSavedAnswer(m, m.question, ['Yes, I am a citizen', 'No'], context, p, []).answer).toBe('No');
    expect(previewSavedAnswer(m, m.question, ['Yes, I am a citizen'], context, p, []).outcome).toBe('skip');
    expect(previewSavedAnswer(m, 'Are you not a US citizen?', null, context, p, []).answer).toBe('Yes');
    p.phone = '';
    expect(previewSavedAnswer({ ...draft, target: { kind: 'profile', key: 'phone' } }, 'Degree', null, context, p, []).outcome).toBe('skip');
  });
  it('reports missing inputs, bad scopes and contradictory approved variations', () => {
    expect(preview(draft, '', null).outcome).toBe('skip');
    expect(preview(draft, 'Degree', []).outcome).toBe('skip');
    expect(previewSavedAnswer(draft, 'Degree', null, { ...context, url: 'javascript:alert(1)' }, sampleProfile(), []).outcome).toBe('skip');
    expect(preview({ ...draft, aliases: ['Highest degree'] }).outcome).toBe('skip');
  });
  it('explains recognized qualifiers without showing internal identifiers', () => {
    expect(meaningDescription(questionMeaning('Do you need sponsorship in the US now or in the future?')!)).toBe('the US visa sponsorship now or in the future');
    expect(meaningDescription(questionMeaning('GPA (Undergraduate)')!)).toBe('your undergraduate GPA');
    expect(meaningDescription(questionMeaning('Are you authorized to work in the US for any employer?')!)).toBe('permission to work in the US for any employer');
    expect(previewContextFor('company:contoso')).toMatchObject({ company: 'contoso', platform: 'other' });
    expect(previewContextFor(`application:${context.url}`)).toEqual(contextWithCompany('Example company'));
  });
});
function contextWithCompany(company: string) { return { ...context, company }; }
