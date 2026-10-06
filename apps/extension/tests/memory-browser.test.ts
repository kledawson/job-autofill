import { describe, expect, it } from 'vitest';
import { browseMemories, memoriesForPage } from '../lib/memory-browser';
import { questionMeaning } from '../lib/answer-semantics';
import type { RememberedMapping } from '../lib/remembered-mappings';

const memory = (patch: Partial<RememberedMapping> = {}): RememberedMapping => ({
  schemaVersion: 3, id: 1, updatedAt: 5, question: 'Preferred office location', aliases: ['Where would you like to work?'],
  scope: 'company:contoso', target: { kind: 'answer', value: 'Montréal' }, answerAliases: ['Montreal, QC'], ...patch,
});
const context = { platform: 'greenhouse' as const, company: 'Contoso', url: 'https://example.com/jobs/123' };

describe('local memory browsing', () => {
  it('searches multiple words across question, answer aliases and scope without case or accent friction', () => {
    const m = memory();
    expect(browseMemories([m], 'CONTOSO montreal office', 'all', 'updated')).toEqual([m]);
    expect(browseMemories([m], 'work QC', 'all', 'updated')).toEqual([m]);
    expect(browseMemories([m], 'office London', 'all', 'updated')).toEqual([]);
  });
  it('searches individual selection aliases and linked profile labels', () => {
    const multi = memory({ target: { kind: 'answers', selections: [{ value: 'Secret', aliases: ['Secret clearance'] }] } });
    expect(browseMemories([multi], 'clearance', 'answers', 'updated')).toEqual([multi]);
    expect(browseMemories([multi], '', 'answer', 'updated')).toEqual([]);
    const linked = memory({ target: { kind: 'profile', key: 'phone' } });
    expect(browseMemories([linked], 'phone', 'profile', 'updated')).toEqual([linked]);
  });
  it('sorts predictably without mutating persisted records', () => {
    const first = memory({ id: 2, question: 'A question', updatedAt: 3, lastUsed: 9 });
    const second = memory({ question: 'Z question', updatedAt: 8 });
    const records = [first, second];
    expect(browseMemories(records, '', 'all', 'updated')).toEqual([second, first]);
    expect(browseMemories(records, '', 'all', 'used')).toEqual([first, second]);
    expect(browseMemories(records, '', 'all', 'question')).toEqual([first, second]);
    expect(records).toEqual([first, second]);
  });
  it('shows approved aliases and meanings for current questions, including lists', () => {
    const citizen = memory({ id: 2, question: 'Are you a US citizen?', scope: 'all', meaning: questionMeaning('Are you a US citizen?')! });
    const multi = memory({ id: 3, question: 'Clearances held', target: { kind: 'answers', selections: [{ value: 'Secret', aliases: [] }] } });
    expect(memoriesForPage([memory(), citizen, multi], ['Where would you like to work?', 'Can you confirm you are a US citizen?', 'Clearances held'], context)).toHaveLength(3);
  });
  it('does not treat suggestions, other countries or out-of-scope records as page memories', () => {
    expect(memoriesForPage([memory()], ['Which office would you consider working in?'], context)).toEqual([]);
    expect(memoriesForPage([memory({ scope: 'company:another company' }), memory({ scope: 'application:https://example.com/jobs/other' })], ['Preferred office location'], context)).toEqual([]);
    const citizen = memory({ question: 'Are you a US citizen?', scope: 'all', meaning: questionMeaning('Are you a US citizen?')! });
    expect(memoriesForPage([citizen], ['Are you a Canadian citizen?'], context)).toEqual([]);
  });
  it('keeps overlapping applicable memories visible so conflicts can be repaired', () => {
    expect(memoriesForPage([memory(), memory({ id: 2, scope: 'all' })], ['Preferred office location'], context)).toHaveLength(2);
  });
});
