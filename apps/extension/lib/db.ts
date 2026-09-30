import Dexie, { type EntityTable } from 'dexie';
import type { Application, FieldMapping, Profile, SavedAnswer, StoredFile } from './types';
import { emptyProfile } from './types';

// Lives in the extension's own origin. Content scripts never open it; they ask the
// background worker instead.
export const db = new Dexie('job-autofill') as Dexie & {
  profile: EntityTable<Profile, 'id'>;
  files: EntityTable<StoredFile, 'kind'>;
  savedAnswers: EntityTable<SavedAnswer, 'id'>;
  fieldMappings: EntityTable<FieldMapping, 'id'>;
  applications: EntityTable<Application, 'id'>;
};

db.version(1).stores({
  profile: 'id',
  files: 'kind',
  savedAnswers: '++id, &key, lastUsed',
  fieldMappings: '++id, [platform+label]',
  applications: '++id, jobKey, status, tabId, filledAt',
});

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
