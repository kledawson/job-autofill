import { describe, expect, it } from 'vitest';
import {
  assertNoMappingConflict, normalizeQuestion, parseMappingDraft, parseQuestionList, parseStoredMapping,
  resolveRememberedMapping, selectRememberedMappings, type MappingDraft, type RememberedMapping,
} from '../lib/remembered-mappings';
import { bestRememberedOption } from '../lib/autofill/match';

const draft: MappingDraft = {
  question: 'How did you hear about this job?', aliases: ['Where did you find this opportunity?'],
  scope: 'greenhouse', target: { kind: 'answer', value: 'Company website' },
};
const mapping = (patch: Partial<RememberedMapping> = {}): RememberedMapping =>
  ({ ...draft, id: 1, schemaVersion: 1, updatedAt: 1, ...patch });

describe('remembered question matching', () => {
  it('folds case, whitespace, required markers and terminal punctuation without deleting words', () => {
    expect(normalizeQuestion('  HOW did you\nhear about this job? * ')).toBe(normalizeQuestion(draft.question));
    expect(normalizeQuestion('Do you need sponsorship?')).not.toBe(normalizeQuestion('Do you NOT need sponsorship?'));
    expect(normalizeQuestion('Are you a U.S. citizen?')).not.toBe(normalizeQuestion('Are you authorized to work?'));
  });
  it('matches explicitly added alternate wordings, not arbitrary similar questions', () => {
    expect(resolveRememberedMapping([mapping()], 'greenhouse', draft.aliases[0]!)).toEqual(mapping());
    expect(resolveRememberedMapping([mapping()], 'greenhouse', 'Who referred you to this job?')).toBeNull();
  });
  it('limits scope and prefers the platform-specific answer over a global one', () => {
    const global = mapping({ id: 2, scope: 'all', target: { kind: 'answer', value: 'Other' } });
    expect(resolveRememberedMapping([mapping()], 'lever', draft.question)).toBeNull();
    expect(resolveRememberedMapping([global, mapping()], 'greenhouse', draft.question)?.id).toBe(1);
    expect(resolveRememberedMapping([global, mapping()], 'lever', draft.question)?.id).toBe(2);
  });
  it('skips conflicts rather than guessing from corrupt or imported records', () => {
    expect(resolveRememberedMapping([mapping(), mapping({ id: 2 })], 'greenhouse', draft.question)).toBeNull();
    expect(() => assertNoMappingConflict(draft, [mapping()])).toThrow('already belongs');
    expect(() => assertNoMappingConflict(draft, [mapping()], 1)).not.toThrow();
    expect(() => assertNoMappingConflict({ ...draft, question: draft.aliases[0]!, aliases: [] }, [mapping()])).toThrow();
  });
  it('returns only answers needed for the current page and platform', () => {
    const unrelated = mapping({ id: 3, question: 'Unrelated private answer', aliases: [] });
    expect(selectRememberedMappings([mapping(), unrelated], 'greenhouse', [draft.question])).toEqual([mapping()]);
  });
});

describe('mapping runtime validation', () => {
  it('deduplicates wordings and removes extraneous properties', () => {
    expect(parseMappingDraft({ ...draft, aliases: [draft.question, 'WHERE DID YOU FIND THIS OPPORTUNITY?', draft.aliases[0]], secret: 'discard' }))
      .toEqual({ ...draft, aliases: ['WHERE DID YOU FIND THIS OPPORTUNITY?'] });
  });
  it.each([
    null, {}, { ...draft, scope: 'unknown' }, { ...draft, scope: ['all'] }, { ...draft, question: '' }, { ...draft, question: 'x'.repeat(701) },
    { ...draft, target: { kind: 'answer', value: ' ' } }, { ...draft, aliases: [42] },
    { ...draft, target: { kind: 'profile', key: 'constructor' } },
    { ...draft, target: { kind: 'profile', key: 'resume' } },
    { ...draft, target: { kind: 'profile', key: 'acknowledge' } },
  ])('rejects invalid input %j', (value) => expect(() => parseMappingDraft(value)).toThrow());
  it('ignores invalid persisted versions and IDs', () => {
    expect(parseStoredMapping(mapping())).toEqual(mapping());
    for (const patch of [{ schemaVersion: 4 }, { schemaVersion: '3' }, { id: -1 }, { id: NaN }, { updatedAt: Infinity }]) {
      expect(parseStoredMapping({ ...mapping(), ...patch })).toBeNull();
    }
    expect(parseStoredMapping({ ...mapping(), target: { kind: 'profile', key: '__proto__' } })).toBeNull();
  });
  it('validates question messages and allows only supported profile links', () => {
    expect(parseQuestionList([draft.question])).toEqual([draft.question]);
    expect(() => parseQuestionList([null])).toThrow();
    expect(() => parseQuestionList(Array(201).fill('Question'))).toThrow();
    expect(parseMappingDraft({ ...draft, target: { kind: 'profile', key: 'usCitizen' } }).target)
      .toEqual({ kind: 'profile', key: 'usCitizen' });
  });
});

describe('remembered dropdown answers', () => {
  it('uses exact matches or unambiguous yes/no expansions', () => {
    expect(bestRememberedOption(['Company website'], ['Select…', 'Company Website', 'Referral'])).toBe(1);
    expect(bestRememberedOption(['Yes'], ['Select…', 'Yes, I hold this certification', 'No'])).toBe(1);
    expect(bestRememberedOption(['Yes'], ['Yes, active', 'Yes, expired', 'No'])).toBe(-1);
    expect(bestRememberedOption(['Active certification'], ['I have no active certification', 'Expired'])).toBe(-1);
    expect(bestRememberedOption(['Referral'], ['Referral', 'Referral'])).toBe(-1);
  });
});
