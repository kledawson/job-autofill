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
    if (id !== undefined && !records.some((m) => m.id === id)) throw new Error('This mapping was removed. Refresh Settings.');
    // Re-teaching the same primary question updates it instead of creating duplicate records.
    const existing = id ?? records.find((m) => m.scope === draft.scope &&
      normalizeQuestion(m.question) === normalizeQuestion(draft.question))?.id;
    assertNoMappingConflict(draft, records, existing);
    return db.rememberedMappings.put({ ...draft, ...(existing ? { id: existing } : {}), schemaVersion: 2, updatedAt: Date.now() } as RememberedMapping);
  });
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
