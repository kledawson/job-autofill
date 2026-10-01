import { useState } from 'react';
import { getProfile, saveProfile } from '@/lib/db';
import { importProfileData, parseProfileFile } from '@/lib/profile-import';
import { useProfile } from './hooks';
import { EeoSection, WorkAuthSection } from './ProfileSections';
import { Button, Notice } from './ui';

/** An explicit editor, not a source of default applicant facts. */
export function EligibilityRecovery({ retry }: { retry: () => Promise<void> }) {
  const { profile, update, save, reload, dirty } = useProfile();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function importAnswers(file?: File) {
    if (!file) return;
    setError(''); setBusy(true);
    try {
      const data = parseProfileFile(await file.text()) as { kind?: string };
      if (data?.kind !== 'profile-patch') throw new Error('Use a profile-patch answer update; full profile imports belong in Settings.');
      if (dirty) await save();
      await saveProfile(importProfileData(data, await getProfile()));
      await reload();
      setSaved(true);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <Notice tone="info">Review saved citizenship and self-identification answers here. Enable saved self-identification filling to reuse those choices.</Notice>
      <Button variant="secondary" className="w-full" onClick={() => setOpen(v => !v)}>
        {open ? 'Close saved-answer editor' : 'Fix saved eligibility answers'}
      </Button>
      {open && profile && (
        <div className="space-y-3">
          <WorkAuthSection profile={profile} onChange={next => { update(next); setSaved(false); }} />
          <EeoSection profile={profile} onChange={next => { update(next); setSaved(false); }} />
          <label className="block text-xs font-medium">
            Import saved answers (JSON)
            <input className="mt-1 block w-full" type="file" accept=".json,application/json" disabled={busy}
              onChange={e => { void importAnswers(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {saved && <Notice tone="success">Answers saved in this browser. Retry autofill to use them.</Notice>}
          <Button className="w-full" disabled={busy} onClick={async () => {
            setBusy(true); setError('');
            try {
              if (dirty) await save();
              setSaved(true);
              await retry();
              setOpen(false);
            } catch (err) { setError((err as Error).message); }
            finally { setBusy(false); }
          }}>{busy ? 'Saving…' : 'Save answers and retry autofill'}</Button>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
    </div>
  );
}
