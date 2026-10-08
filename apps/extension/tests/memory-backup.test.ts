import { describe, expect, it } from 'vitest';
import { makeMemoryBackup, parseMemoryBackup, planMemoryRestore, parseRestoreChoices, memorySnapshot, memoryRestoreToken, MEMORY_BACKUP_MAX_BYTES } from '../lib/memory-backup';
import { questionMeaning } from '../lib/answer-semantics';
import type { RememberedMapping } from '../lib/remembered-mappings';

const memory = (patch: Partial<RememberedMapping> = {}): RememberedMapping => ({
  id: 500, schemaVersion: 3, updatedAt: 123, lastUsed: 456, question: 'Can you commute to Cupertino?',
  aliases: ['Can you travel to the Cupertino office?'], scope: 'all',
  target: { kind: 'answer', value: 'Yes' }, answerAliases: ['Yes, I can commute'], ...patch,
});
const contents = (records: RememberedMapping[]) => JSON.stringify(makeMemoryBackup(records, 789));

describe('Memories backup format', () => {
  it('round trips all approved matching fields and metadata without portable database IDs', () => {
    const records = [
      memory(),
      memory({ id: 2, question: 'Fictional tools', aliases: [], scope: 'company:contoso', answerAliases: [],
        target: { kind: 'answers', selections: [{ value: 'SQL', aliases: ['Structured Query Language'] }, { value: 'TS', aliases: ['TypeScript'] }] } }),
      memory({ id: 3, question: 'GPA', aliases: ['Grade point average'], scope: 'application:https://jobs.example.test/123', target: { kind: 'profile', key: 'gpa' }, answerAliases: [] }),
      memory({ id: 4, question: 'Need sponsorship?', aliases: [], scope: 'site:https://jobs.example.test', meaning: questionMeaning('Need sponsorship?')!, target: { kind: 'answer', value: 'No' } }),
    ];
    const decoded = parseMemoryBackup(contents(records)).backup;
    expect(decoded.createdAt).toBe(789);
    expect(decoded.memories).toEqual(records.map(({ id, ...rest }) => rest));
    expect(decoded.memories.every(m => !Object.hasOwn(m, 'id'))).toBe(true);
    expect(JSON.stringify(decoded)).not.toContain('profile":{');
  });
  it.each([1, 2] as const)('preserves version %s exact-only rules without inferring a meaning', schemaVersion => {
    const row = memory({ schemaVersion, question: 'Are you a US citizen?', aliases: [], answerAliases: undefined });
    const decoded = parseMemoryBackup(contents([row])).backup.memories[0]!;
    expect(decoded.schemaVersion).toBe(schemaVersion);
    expect(decoded.meaning).toBeUndefined();
  });
  it('deduplicates identical rules in a file but rejects ambiguous internal rules', () => {
    const single = makeMemoryBackup([memory()]);
    const same = JSON.stringify({ ...single, memories: [...single.memories, { ...single.memories[0], updatedAt: 999 }] });
    expect(parseMemoryBackup(same).duplicatesInFile).toBe(1);
    expect(() => contents([memory(), memory({ id: 2, target: { kind: 'answer', value: 'No' } })])).toThrow('overlapping');
    expect(() => contents([memory(), memory({ id: 2, question: memory().aliases[0]!, aliases: [] })])).toThrow('overlapping');
  });
  it.each([
    'not json', 'null', '[]', '{}',
    JSON.stringify({ format: 'job-autofill-memories', version: 99 }),
    JSON.stringify({ format: 'job-autofill-memories', version: 1, createdAt: -1, memories: [] }),
    JSON.stringify({ format: 'job-autofill-memories', version: 1, createdAt: 9e20, memories: [] }),
  ])('rejects malformed envelopes %s', input => expect(() => parseMemoryBackup(input)).toThrow());
  it.each([
    { schemaVersion: 99 }, { target: { kind: 'profile', key: '__proto__' } },
    { target: { kind: 'answers', selections: [] } }, { scope: 'application:javascript:alert(1)' },
    { aliases: [42] }, { target: { kind: 'answer', value: '' } }, { meaning: { intent: 'made-up' } },
  ])('rejects the whole file for an invalid record %j', patch => {
    const backup = makeMemoryBackup([memory()]);
    expect(() => parseMemoryBackup(JSON.stringify({ ...backup, memories: [{ ...backup.memories[0], ...patch }] }))).toThrow('Memory 1');
  });
  it('checks UTF-8 byte and record limits before validating records', () => {
    expect(() => parseMemoryBackup('é'.repeat(MEMORY_BACKUP_MAX_BYTES / 2 + 1))).toThrow('5 MB');
    const backup = makeMemoryBackup([]);
    expect(() => parseMemoryBackup(JSON.stringify({ ...backup, memories: Array(1001).fill({}) }))).toThrow('1,000');
  });
  it('accepts an empty backup and strips unexpected data rather than importing it', () => {
    expect(planMemoryRestore(makeMemoryBackup([]), [])).toEqual([]);
    const backup = makeMemoryBackup([memory()]);
    const parsed = parseMemoryBackup(JSON.stringify({ ...backup, profile: { email: 'fictional@example.test' }, memories: [{ ...backup.memories[0], apiKey: 'fictional-key', id: 900 }] }));
    expect(JSON.stringify(parsed.backup)).not.toContain('fictional-key');
    expect(JSON.stringify(parsed.backup)).not.toContain('fictional@example.test');
  });
});

describe('Memories restore planning and confirmation', () => {
  it('distinguishes new, full-rule duplicates, and matching-rule conflicts', () => {
    expect(planMemoryRestore(makeMemoryBackup([memory()]), [])[0]?.kind).toBe('new');
    expect(planMemoryRestore(makeMemoryBackup([memory()]), [memory({ id: 2, updatedAt: 999 })])[0]?.kind).toBe('duplicate');
    for (const patch of [{ aliases: [] }, { answerAliases: ['Yes indeed'] }, { target: { kind: 'answer' as const, value: 'No' } }]) {
      expect(planMemoryRestore(makeMemoryBackup([memory()]), [memory(patch)])[0]?.kind).toBe('conflict');
    }
  });
  it('keeps different reuse scopes distinct instead of broadening an imported rule', () => {
    const backup = makeMemoryBackup([memory({ scope: 'company:contoso' })]);
    const rows = planMemoryRestore(backup, [memory({ scope: 'all' })]);
    expect(rows[0]?.kind).toBe('new');
    expect(rows[0]?.incoming[0]?.scope).toBe('company:contoso');
  });
  it('preserves negation rather than treating opposite questions as conflicts', () => {
    const backup = makeMemoryBackup([memory({ question: 'Do you need sponsorship?', aliases: [] })]);
    const rows = planMemoryRestore(backup, [memory({ question: 'Do you NOT need sponsorship?', aliases: [] })]);
    expect(rows[0]?.kind).toBe('new');
  });
  it('groups connected overlaps so keeping one record cannot delete it through another choice', () => {
    const a = memory({ id: 1, question: 'Fictional Alpha', aliases: [] });
    const b = memory({ id: 2, question: 'Fictional Beta', aliases: [] });
    const c = memory({ id: 3, question: 'Fictional Gamma', aliases: [] });
    const current = [memory({ id: 10, question: a.question, aliases: [b.question] }), memory({ id: 11, question: c.question, aliases: [b.question] })];
    const rows = planMemoryRestore(makeMemoryBackup([a, c, b]), current);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.incoming).toHaveLength(3);
    expect(rows[0]?.current.map(m => m.id).sort()).toEqual([10, 11]);
    expect(parseRestoreChoices({ 0: 'keep' }, rows)).toEqual({ 0: 'keep' });
    expect(parseRestoreChoices({ 0: 'backup' }, rows)).toEqual({ 0: 'backup' });
  });
  it('requires explicit valid choices for every eligible row and rejects coercible values', () => {
    const rows = planMemoryRestore(makeMemoryBackup([memory()]), []);
    for (const choices of [null, [], {}, { 0: ['keep'] }, { 0: true }, { 0: 'anything' }, { 0: 'backup', 1: 'keep' }]) {
      expect(() => parseRestoreChoices(choices, rows)).toThrow();
    }
    expect(parseRestoreChoices({ 0: 'backup' }, rows)).toEqual({ 0: 'backup' });
    const duplicate = planMemoryRestore(makeMemoryBackup([memory()]), [memory()]);
    expect(parseRestoreChoices({}, duplicate)).toEqual({});
  });
  it('ignores usage changes while invalidating edits, additions, deletions and file changes', async () => {
    const snapshot = memorySnapshot([memory()]);
    expect(memorySnapshot([memory({ lastUsed: 999 })])).toBe(snapshot);
    expect(memorySnapshot([memory({ updatedAt: 999 })])).not.toBe(snapshot);
    expect(memorySnapshot([memory({ aliases: [] })])).not.toBe(snapshot);
    expect(memorySnapshot([])).not.toBe(snapshot);
    const file = contents([memory()]);
    const token = await memoryRestoreToken(file, snapshot);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(await memoryRestoreToken(file, snapshot)).toBe(token);
    expect(await memoryRestoreToken(file + ' ', snapshot)).not.toBe(token);
    expect(await memoryRestoreToken(file, memorySnapshot([]))).not.toBe(token);
  });
});
