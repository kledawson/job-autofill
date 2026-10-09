import { applyProfileConfirmation, applyValidatedProfileUpdate, type ProfileConfirmation } from './profile-learning';
import type { CapturedAnswer, MappingDraft, MappingContext } from './remembered-mappings';
import Dexie, { type EntityTable } from 'dexie';
import type { Application, FieldMapping, Profile, SavedAnswer, StoredFile } from './types';
import { emptyProfile } from './types';
import { assertNoMappingConflict, normalizeQuestion, parseMappingDraft, parseStoredMapping, type RememberedMapping } from './remembered-mappings';

// Lives in the extension's own origin. Content scripts never open it; they ask the
// background worker instead.
export const db = new Dexie('job-autofill') as Dexie & {
  presets: EntityTable<import('./presets').ApplicationPreset, 'id'>;
  presetFiles: EntityTable<import('./presets').PresetDocument, 'id'>;
  presetState: EntityTable<{ id: 'selection'; selectedId: string }, 'id'>;
  fillRuns: EntityTable<{ id: string; tabId: number; topUrl: string; createdAt: number; context: import('./messages').FillContext }, 'id'>;
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

db.version(4).stores({ presets: 'id, name', presetFiles: 'id', presetState: 'id', fillRuns: 'id, tabId, createdAt' });

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

/** Profile facts and memories from one confirmed review commit together, or not at all. */
export async function saveConfirmedAnswers(entries: { capture: CapturedAnswer; mapping?: MappingDraft; profile?: ProfileConfirmation }[], context: MappingContext) {
  return db.transaction('rw', db.profile, db.rememberedMappings, async () => {
    const original = await getProfile();
    const records = await getRememberedMappings();
    const links = new Map<number, ProfileConfirmation["expected"]["memoryLink"]>();
    let profile = original;
    const memories: MappingDraft[] = [];
    const updated = new Set<string>();
    for (const entry of entries) {
      if (Boolean(entry.profile) === Boolean(entry.mapping)) throw new Error('Choose one destination per answer.');
      if (entry.profile) {
        applyProfileConfirmation(original, entry.capture, entry.profile, records, context);
        const link = entry.profile.expected.memoryLink;
        if (link) {
          if (links.has(link.id) && links.get(link.id)?.key !== link.key) throw new Error("Two answers change the same Memory. Exclude one before saving.");
          links.set(link.id, link);
        }
        const key = entry.profile.expected.key + ':' + (entry.profile.expected.index ?? '');
        if (updated.has(key)) throw new Error('Two answers update the same profile field. Exclude one before saving.');
        profile = applyValidatedProfileUpdate(profile, entry.profile.expected);
        updated.add(key);
      } else memories.push(entry.mapping!);
    }
    const ids = memories.length ? await saveRememberedMappingBatch(memories) : [];
    for (const [id, link] of links) {
      if (ids.includes(id)) throw new Error("Two answers change the same Memory. Exclude one before saving.");
      const existing = records.find(m => m.id === id)!;
      await db.rememberedMappings.put({ ...existing, schemaVersion: 3, target: { kind: "profile", key: link!.key }, answerAliases: [], updatedAt: Date.now() });
    }
    if (updated.size) await saveProfile(profile);
    return { memoryCount: new Set(ids).size, profileCount: updated.size };
  });
}
