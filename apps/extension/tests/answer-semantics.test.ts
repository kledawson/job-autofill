import { describe, expect, it } from 'vitest';
import { answerOption, questionMeaning } from '../lib/answer-semantics';
import { SavedAnswerIndex, parseMappingDraft, parseStoredMapping, scopeRank, type RememberedMapping } from '../lib/remembered-mappings';

const context = { platform: 'greenhouse' as const, company: 'Contoso', url: 'https://job-boards.greenhouse.io/contoso/jobs/123' };
function saved(question: string, answer: string, patch: Partial<RememberedMapping> = {}): RememberedMapping {
  return { id: 1, schemaVersion: 2, updatedAt: 1, question, aliases: [], scope: 'all', target: { kind: 'answer', value: answer },
    ...(questionMeaning(question) ? { meaning: questionMeaning(question)! } : {}), ...patch };
}
const field = (label: string) => ({ label, kind: 'select', options: ['Yes', 'No'] });
describe('approved meaning and scope', () => {
  it('benchmarks a local batch of 100 unfamiliar fields against 500 synthetic answers', () => {
    const records = Array.from({ length: 500 }, (_, i) => saved(`Which channel led you through program ${i}?`, 'Referral', { id: i + 1 }));
    const times = Array.from({ length: 10 }, () => {
      const start = performance.now();
      const index = new SavedAnswerIndex(records, context);
      for (let i = 0; i < 100; i++) expect(index.match(field(`Which channel brought you through program ${i}?`)).mapping).toBeNull();
      return performance.now() - start;
    }).sort((a, b) => a - b);
    console.info(`Saved-answer batch: 100 fields / 500 records, p95 ${times[9]!.toFixed(1)} ms (index + lookup; synthetic local benchmark).`);
    // Loose regression guard for shared CI; the documented 50 ms development target is measured separately.
    expect(times[9]).toBeLessThan(1000);
  });
  it('matches equivalent wording without approving unknown questions', () => {
    const index = new SavedAnswerIndex([saved('Are you a U.S. citizen?', 'Yes')], context);
    expect(index.match(field('Can you confirm you are a US citizen?')).mapping?.id).toBe(1);
    expect(index.match(field('Are you authorized to work in the US?')).mapping).toBeNull();
  });
  it.each([
    ['Active security clearance', 'Clearance eligibility'],
    ['GPA (Undergraduate)', 'GPA (Graduate)'],
    ['Do you require sponsorship now?', 'Do you require sponsorship in the future?'],
    ['Are you authorized to work in the US?', 'Are you authorized to work in Canada?'],
    ['Are you authorized to work in the US?', 'Are you authorized to work in the US for any employer?'],
    ['Degree', 'Highest degree'],
  ])('keeps %s separate from %s', (a, b) => {
    expect(new SavedAnswerIndex([saved(a, 'Yes')], context).match(field(b))).toMatchObject({ mapping: null });
  });
  it.each(['Is your spouse a US citizen?', 'What is your child\'s race?', 'What is your manager gender?', 'What is your reference degree?', 'Were you previously a US citizen?', 'Are you a US citizen unless exempt?', 'Can you work without sponsorship?', 'Do you have a degree?', 'Expected degree'])('requires explicit approval for %s', q => expect(questionMeaning(q)).toBeNull());
  it('keeps legacy records exact-only after version upgrade', () => {
    const m = saved('Are you a US citizen?', 'Yes'); delete m.meaning;
    expect(parseStoredMapping(m)).toEqual(m);
    expect(new SavedAnswerIndex([m], context).match(field('Can you confirm you are a US citizen?')).mapping).toBeNull();
  });
  it('uses narrow scope first, rejects ties, and does not leak employers', () => {
    const global = saved('Degree', 'BS');
    const company = saved('Degree', 'BA', { id: 2, scope: 'company:contoso' });
    const app = saved('Degree', 'BE', { id: 3, scope: `application:${context.url}` });
    expect(new SavedAnswerIndex([global, company, app], context).match(field('Educational qualification')).mapping?.id).toBe(3);
    expect(new SavedAnswerIndex([company], { ...context, company: 'Other' }).match(field('Degree')).mapping).toBeNull();
    expect(new SavedAnswerIndex([company, { ...company, id: 4 }], context).match(field('Degree')).mapping).toBeNull();
    expect(scopeRank('site:https://job-boards.greenhouse.io', context)).toBe(2);
  });
  it('suggests unknown wording for explicit confirmation, then learns an approved alias', () => {
    const m = saved('Which channel led you to this opening?', 'Company website');
    const index = new SavedAnswerIndex([m], context);
    expect(index.match(field('Which channel brought you to this opening?'))).toMatchObject({ mapping: null, suggestionId: 1 });
    const approved = parseMappingDraft({ ...m, aliases: ['Which channel brought you to this opening?'] });
    expect(new SavedAnswerIndex([{ ...m, ...approved }], context).match(field(approved.aliases[0]!)).mapping?.id).toBe(1);
  });
  it('rejects contradictory aliases and tampered meaning', () => {
    const m = saved('Are you a US citizen?', 'Yes');
    expect(() => parseMappingDraft({ ...m, aliases: ['Are you not a US citizen?'] })).toThrow('reverses');
    expect(() => parseMappingDraft({ ...m, meaning: { ...m.meaning, intent: 'authorization' } })).toThrow('meaning');
    expect(parseMappingDraft({ ...m, scope: 'workday' }).scope).toBe('workday');
    expect(parseMappingDraft({ ...m, scope: 'other' }).scope).toBe('other');
    expect(() => parseMappingDraft({ ...m, scope: 'site:javascript:alert(1)' })).toThrow('applies');
  });
});
describe('equivalent option rendering', () => {
  function pick(answer: string, options: string[], question = 'Degree', current = question) {
    return answerOption(answer, options, questionMeaning(question) ?? undefined, questionMeaning(current));
  }
  it.each(['BS', 'B.S.', 'BSc', 'B.Sc.', 'Bachelor of Science'])('maps %s to equivalent degree options', answer => {
    expect(pick(answer, ["Master's Degree", "Bachelor's Degree"])).toBe(1);
    expect(pick(answer, ['BA', 'Bachelor of Science'])).toBe(1);
  });
  it('refuses invented qualifications, duplicate equivalents and broad yes expansions', () => {
    expect(pick("Bachelor's Degree", ['BS', 'BA'])).toBe(-1);
    expect(pick('BS', ['BA'])).toBe(-1);
    expect(pick('BS', ['B.S.', 'Bachelor of Science'])).toBe(-1);
    expect(pick('Yes', ['Yes, active', 'Yes, expired', 'No'], 'Are you a US citizen?')).toBe(-1);
    expect(pick('Master\'s Degree', ['Master of Science'])).toBe(-1);
    expect(pick('MS', ['Master of Arts'])).toBe(-1);
    expect(pick('MS', ['Master of Science'])).toBe(0);
    expect(pick('PhD', ['Doctor of Medicine (M.D.)'])).toBe(-1);
    expect(pick('BS', ['Bachelor of Business Management'])).toBe(-1);
  });
  it('renders boolean inverses and citizenship categories without inferring a visa', () => {
    expect(pick('Yes', ['Yes', 'No'], 'Are you a US citizen?', 'Are you not a US citizen?')).toBe(1);
    expect(pick('Yes', ['US Citizen', 'Permanent resident'], 'Are you a US citizen?')).toBe(0);
    expect(pick('No', ['US Citizen', 'Permanent resident'], 'Are you a US citizen?')).toBe(-1);
  });
  it('bridges a specifically saved US Citizen category to a boolean citizenship question', () => {
    const index = new SavedAnswerIndex([saved('Citizenship status', 'US Citizen')], context);
    expect(index.match(field('Are you a US citizen?')).mapping?.id).toBe(1);
    expect(pick('US Citizen', ['Yes', 'No'], 'Citizenship status', 'Are you a US citizen?')).toBe(0);
    const positive = new SavedAnswerIndex([saved('Are you a US citizen?', 'Yes')], context);
    expect(positive.match({ ...field('Citizenship status'), options: ['US Citizen', 'Permanent resident'] }).mapping?.id).toBe(1);
    expect(positive.match({ ...field('Citizenship'), options: ['United States', 'Canada'] }).mapping).toBeNull();
    expect(pick('Yes', ['US Citizen', 'Permanent resident'], 'Are you a US citizen?', 'Citizenship status')).toBe(0);
  });
  it('handles approved categorical synonyms and manually authored answer aliases', () => {
    expect(pick('Company website', ['Referral', 'Careers page'], 'How did you hear about this job?')).toBe(1);
    expect(answerOption('Employee referral', ['Referred by employee'], undefined, null, ['Referred by employee'])).toBe(0);
  });
  it('never invents clearance or military service history from a broader answer', () => {
    expect(pick('No active clearance', ['Never held a clearance'], 'Active security clearance')).toBe(-1);
    expect(pick('Never held a clearance', ['No active clearance'], 'Active security clearance')).toBe(0);
    expect(pick('I am not a protected veteran', ['Not a veteran'], 'Veteran status')).toBe(-1);
    expect(pick('Not a veteran', ['I am not a protected veteran'], 'Veteran status')).toBe(0);
  });
});
