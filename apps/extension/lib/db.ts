import Dexie, { type EntityTable } from 'dexie';
import type { Application, FieldMapping, Profile, SavedAnswer, StoredFile } from './types';
import { emptyProfile } from './types';
import { assertNoMappingConflict, normalizeQuestion, parseMappingDraft, parseStoredMapping, type RememberedMapping } from './remembered-mappings';

// Lives in the extension's own origin. Content scripts never open it; they ask the
// background worker instead.
export const db = new Dexie('job-autofill') as Dexie & {
  profile: EntityTable<Profile, 'id'>;
  files: EntityTable<StoredFile, 'kind'>;
  savedAnswers: EntityTable<SavedAnswer, 'id'>;
  fieldMappings: EntityTable<FieldMapping, 'id'>;
  applications: EntityTable<Application, 'id'>;
  rememberedMappings: EntityTable<RememberedMapping, 'id'>;
};

db.version(1).stores({
  profile: 'id',
  files: 'kind',
  savedAnswers: '++id, &key, lastUsed',
  fieldMappings: '++id, [platform+label]',
  applications: '++id, jobKey, status, tabId, filledAt',
});

// Additive migration: existing profiles, tracker entries, and legacy placeholder tables stay intact.
db.version(2).stores({ rememberedMappings: '++id, scope, updatedAt' });
// Old records keep their approved exact wording. Meaning is added only by a confirmed edit.
db.version(3).stores({ rememberedMappings: '++id, scope, updatedAt, lastUsed' }).upgrade(async tx => {
  await tx.table('rememberedMappings').toCollection().modify(record => {
    if (record.schemaVersion === 1) record.schemaVersion = 2;
  });
});

export async function getRememberedMappings(): Promise<RememberedMapping[]> {
  return (await db.rememberedMappings.toArray()).map(parseStoredMapping)
    .filter((m): m is RememberedMapping => m !== null);
}

export async function saveRememberedMapping(value: unknown, id?: number): Promise<number> {
  const draft = parseMappingDraft(value);
  if (id !== undefined && (!Number.isSafeInteger(id) || id < 1)) throw new Error('Invalid mapping ID.');
  return db.transaction('rw', db.rememberedMappings, async () => {
    const records = await getRememberedMappings();
    if (id !== undefined && !records.some((m) => m.id === id)) throw new Error('This memory was deleted in another window. Cancel editing to refresh the list.');
    // Re-teaching the same primary question updates it instead of creating duplicate records.
    const existing = id ?? records.find((m) => m.scope === draft.scope &&
      normalizeQuestion(m.question) === normalizeQuestion(draft.question))?.id;
    assertNoMappingConflict(draft, records, existing);
    const lastUsed = existing ? records.find(m => m.id === existing)?.lastUsed : undefined;
    return db.rememberedMappings.put({ ...draft, ...(existing ? { id: existing } : {}),
      ...(lastUsed === undefined ? {} : { lastUsed }), schemaVersion: 3, updatedAt: Date.now() } as RememberedMapping);
  });
}

/** One confirmed batch commits atomically. Existing different answers must be edited explicitly. */
export async function saveRememberedMappingBatch(values: unknown[]): Promise<number[]> {
  if (!Array.isArray(values) || !values.length || values.length > 100) throw new Error('Choose between 1 and 100 answers to save.');
  const drafts = values.map(parseMappingDraft);
  return db.transaction('rw', db.rememberedMappings, async () => {
    const records = await getRememberedMappings();
    const ids: number[] = [];
    for (const draft of drafts) {
      const existing = records.find(m => m.scope === draft.scope && normalizeQuestion(m.question) === normalizeQuestion(draft.question));
      if (existing) {
        if (!equivalentTargets(existing.target, draft.target)) throw new Error(`“${draft.question}” already has a different memory in this scope. Exclude it or edit it in Memories.`);
        ids.push(existing.id); continue;
      }
      assertNoMappingConflict(draft, records);
      const id = await db.rememberedMappings.add({ ...draft, schemaVersion: 3, updatedAt: Date.now() } as RememberedMapping);
      records.push({ ...draft, id, schemaVersion: 3, updatedAt: Date.now() }); ids.push(id);
    }
    return ids;
  });
}

function equivalentTargets(a: RememberedMapping['target'], b: RememberedMapping['target']): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'answer' && b.kind === 'answer') return normalizeQuestion(a.value) === normalizeQuestion(b.value);
  if (a.kind === 'profile' && b.kind === 'profile') return a.key === b.key;
  if (a.kind === 'answers' && b.kind === 'answers') return JSON.stringify(a.selections.map(s => normalizeQuestion(s.value)).sort()) === JSON.stringify(b.selections.map(s => normalizeQuestion(s.value)).sort());
  return false;
}

export async function getProfile(): Promise<Profile> {
  const stored = await db.profile.get('me');
  // Merge onto defaults so profiles saved by older versions pick up new fields.
  const base = emptyProfile();
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    workAuth: { ...base.workAuth, ...stored.workAuth },
    preferences: { ...base.preferences, ...stored.preferences },
    eeo: { ...base.eeo, ...stored.eeo },
  };
}

export async function saveProfile(profile: Profile): Promise<void> {
  await db.profile.put({ ...profile, id: 'me', updatedAt: Date.now() });
}
