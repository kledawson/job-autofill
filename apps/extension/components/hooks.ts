import { browser } from 'wxt/browser';
import { liveQuery } from 'dexie';
import { useCallback, useEffect, useState } from 'react';
import { getProfile, saveProfile } from '@/lib/db';
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

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setProfile(await getProfile());
    setDirty(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const update = useCallback((next: Profile) => {
    setProfile(next);
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!profile) return;
    await saveProfile(profile);
    setDirty(false);
    setSavedAt(Date.now());
  }, [profile]);

  /** Replaces and saves in one step (used when merging resume data). */
  const replace = useCallback(async (next: Profile) => {
    setProfile(next);
    await saveProfile(next);
    setDirty(false);
    setSavedAt(Date.now());
  }, []);

  return { profile, update, save, replace, dirty, savedAt, reload };
}

export function usePublicSettings() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const refresh = useCallback(async () => {
    setSettings(await sendToBackground('getPublicSettings', {}));
  }, []);
  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [refresh]);
  return { settings, refresh };
}
