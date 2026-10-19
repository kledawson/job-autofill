import { useState } from 'react';
import { sendToBackground } from '@/lib/messages';
import type { CapturedAnswer } from '@/lib/remembered-mappings';
import type { ProfileUpdate } from '@/lib/profile-learning';
import { Button, Notice } from './ui';

export function ProfileDestination({ update, replace, onReplace, disabled }: { update: ProfileUpdate; replace: boolean; onReplace(value: boolean): void; disabled?: boolean }) {
  const conflict = !!update.previous && update.previous !== update.value;
  return <div className="space-y-2 text-sm">
    <p className="font-semibold text-indigo-800">Destination: Profile</p>
    <p className="break-words text-xs text-slate-600">{update.label}</p>
    <p className="whitespace-pre-wrap break-words">{update.value}</p>
    <p className="text-xs text-slate-600">This is a personal fact already supported by your Profile. Confirm below to use it in future applications.</p>
    {update.memoryLink && <p className="rounded-lg bg-indigo-50 p-2 text-xs text-indigo-800">Your existing Memory for this question will follow the updated profile value. Its wording and reuse limits stay the same.</p>}
    {conflict && <label className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs"><input type="checkbox" disabled={disabled} checked={replace} onChange={e => onReplace(e.target.checked)} /><span>Replace my current value: <strong>{update.previous}</strong></span></label>}
  </div>;
}
export function ProfileAnswer({ capture, applicationId, onSaved, onCancel }: { capture: CapturedAnswer; applicationId: number; onSaved(note: string): void; onCancel(): void }) {
  const [replace, setReplace] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const update = capture.profileUpdate!;
  async function save() {
    setBusy(true); setError('');
    try {
      const result = await sendToBackground('savePageAnswers', { applicationId, entries: [{ token: capture.token, captureId: capture.captureId, profile: { value: update.value, expected: update, replace } }] });
      if (!result.ok) throw new Error(result.error);
      onSaved(result.note);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update your profile.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3" aria-label="Confirm profile update">
    <p className="font-medium">{capture.label}</p>
    <ProfileDestination update={update} replace={replace} onReplace={setReplace} disabled={busy} />
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
    <div className="flex gap-2"><Button disabled={busy || (!!update.previous && update.previous !== update.value && !replace)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save to profile'}</Button><Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button></div>
  </section>;
}
