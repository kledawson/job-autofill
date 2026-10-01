import Dexie, { type EntityTable } from 'dexie';
import type { Application, FieldMapping, Profile, SavedAnswer, StoredFile } from './types';
import { emptyProfile } from './types';
import { importProfileData, normalizeProfile, profileEdits, PROFILE_VERSION } from './profile-import';

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
  return normalizeProfile(stored);
}

export async function saveProfile(profile: Profile): Promise<void> {
  await db.profile.put({ ...normalizeProfile(profile), id: 'me', updatedAt: Date.now() });
}

export async function saveProfileEdits(before: Profile, after: Profile): Promise<Profile> {
  return db.transaction('rw', db.profile, async () => {
    const current = await getProfile();
    const edits = profileEdits(before, after);
    // Arrays edited by the user replace that array, so deleting/reordering an
    // education or experience entry still works. Object edits merge by key.
    const next = Object.keys(edits).length
      ? importProfileData({ version: PROFILE_VERSION, kind: 'profile-patch', profile: edits }, current)
      : current;
    if (edits.education) next.education = after.education;
    if (edits.experience) next.experience = after.experience;
    await saveProfile(next);
    return { ...next, updatedAt: Date.now() };
  });
}
