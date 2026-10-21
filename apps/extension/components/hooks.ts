import { browser } from 'wxt/browser';
import { sortProfileEntries } from '@/lib/sort-entries';
import { liveQuery } from 'dexie';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, getProfile, saveProfile } from '@/lib/db';
import { sendToBackground } from '@/lib/messages';
import type { PublicSettings } from '@/lib/settings';
import type { Profile } from '@/lib/types';

/** Subscribes to a Dexie query; re-runs when the tables it reads change in any extension context. */
export function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/** Structural equality for plain JSON-like data, ignoring key order. */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => k in b && sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const live = useLiveQuery(getProfile);
  const [saveError, setSaveError] = useState('');
  /** The profile as last loaded or saved. Unsaved changes are whatever differs from it, so undoing an edit clears them. */
  const [saved, setSaved] = useState<Profile | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const dirty = useMemo(() => !!profile && !!saved && !sameData(profile, saved), [profile, saved]);

  const reload = useCallback(async () => {
    const loaded = sortProfileEntries(await getProfile());
    setProfile(loaded);
    setSaved(loaded);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (live && !dirty) { const next = sortProfileEntries(live); setProfile(next); setSaved(next); setSaveError(''); }
  }, [live, dirty]);
  const update = useCallback((next: Profile) => setProfile(next), []);

  const save = useCallback(async () => {
    if (!profile) return;
    // Entries are re-ordered (most recent first) only when saving, so they never jump while being edited.
    const sorted = sortProfileEntries(profile);
    try {
      await db.transaction('rw', db.profile, async () => {
        if (!sameData(sortProfileEntries(await getProfile()), saved)) throw new Error('Your saved profile changed in another window. Reload the profile before saving this draft.');
        await saveProfile(sorted);
      });
      const loaded = sortProfileEntries(await getProfile());
      setProfile(loaded); setSaved(loaded); setSaveError(''); setSavedAt(Date.now());
    } catch (err) { setSaveError(err instanceof Error ? err.message : 'Could not save your profile.'); }
  }, [profile, saved]);

  /** Replaces and saves in one step (used when merging resume data). */
  const replace = useCallback(async (next: Profile) => {
    setProfile(next);
    await saveProfile(next);
    setSaved(next);
    setSavedAt(Date.now());
  }, []);

  return { profile, update, save, replace, dirty, savedAt, reload, saveError };
}

export function usePublicSettings() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const refresh = useCallback(async () => {
    setSettings(await sendToBackground('getPublicSettings', {}));
  }, []);
  useEffect(() => {
    void refresh();
    const onChange = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && ['geminiApiKey','geminiModel','answerSource','promptTemplate','sheetId','sheetUrl','sheetTabId','sheetTabName','onboardingComplete'].some(key => key in changes)) void refresh();
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [refresh]);
  return { settings, refresh };
}
