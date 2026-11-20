import { useState } from 'react';
import type { ChatProvider } from '@/lib/chat-providers';
import { needReviewFields } from '@/lib/application-workflow';
import { sendToBackground } from '@/lib/messages';
import type { Application } from '@/lib/types';
import { startChatDraft } from './ChatDraftCard';
import { Button, Notice } from './ui';

/**
 * The questions counted as Need review. Clicking one shows it on the application; answering it removes it here.
 * Free responses can be drafted on the chosen chat website, individually or as a selected group.
 */
export function NeedsAnswerList({ app, chat, disabled, onOpenCoverLetter }: { app: Application; chat?: ChatProvider; disabled: boolean; onOpenCoverLetter?: () => void }) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [characterLimits, setCharacterLimits] = useState<Record<string, string>>({});
  const [wordLimits, setWordLimits] = useState<Record<string, string>>({});
  const fields = needReviewFields(app);
  if (!fields.length) return null;
  const drafts = chat ? fields.filter(f => f.draft) : [];
  const selectedDrafts = drafts.filter(f => selected.includes(f.token));
  const required = fields.filter(f => f.required && f.status !== 'optional').length, optional = fields.length - required;

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key); setError('');
    try { await task(); } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong. Try again.'); } finally { setBusy(undefined); }
  }
  const show = (token: string) => run('show:' + token, async () => {
    const res = await sendToBackground('showApplicationField', { applicationId: app.id!, token });
    if (!res.ok) throw new Error(res.error);
  });
  // No await before startChatDraft: it must run inside the click for Chrome's permission prompt.
  const draft = (key: string, tokens: string[]) => {
    setError('');
    const limits: Record<string, number> = {};
    const words: Record<string, number> = {};
    for (const token of tokens) {
      const value = characterLimits[token]?.trim();
      if (!value) continue;
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20000) { setError('Enter a whole number from 1 to 20,000, or leave the character limit blank.'); return; }
      limits[token] = limit;
    }
    for (const token of tokens) {
      const value = (wordLimits[token] ?? String(fields.find(f => f.token === token)?.wordLimit ?? '')).trim();
      if (!value) continue;
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit < 1 || limit > 5000) { setError('Enter a whole number from 1 to 5,000, or leave the word limit blank.'); return; }
      words[token] = limit;
    }
    setBusy(key); void startChatDraft(app.id!, tokens, chat!, limits, words).catch(err => setError(err instanceof Error ? err.message : `Could not open ${chat!.name}.`)).finally(() => setBusy(undefined));
  };

  return (
    <section aria-label="Unanswered questions" className="space-y-2">
      <div className="space-y-1.5">
        <p className="whitespace-nowrap text-xs font-medium text-slate-700">Needs your answer <span className="font-normal text-slate-500">· {[required && `${required} required`, optional && `${optional} optional`].filter(Boolean).join(', ')}</span></p>
        {drafts.length > 0 && <div className="flex w-full min-w-0 items-stretch gap-1">
          {selectedDrafts.length > 0 && <Button className="min-w-0 flex-1 whitespace-normal break-words px-1.5 py-1 text-center text-xs leading-tight" disabled={disabled || !!busy} onClick={() => draft('selected', selectedDrafts.map(f => f.token))}>
            {busy === 'selected' ? 'Preparing…' : `Draft ${selectedDrafts.length} ${selectedDrafts.length === 1 ? 'response' : 'responses'} in ${chat!.name}`}
          </Button>}
          {drafts.length > 1 && <Button className="min-w-0 flex-1 whitespace-normal break-words px-1.5 py-1 text-center text-xs leading-tight" variant="secondary" disabled={disabled || !!busy} onClick={() => draft('all', drafts.map(f => f.token))}>
            {busy === 'all' ? 'Preparing…' : `Draft all ${drafts.length} in ${chat!.name}`}
          </Button>}
        </div>}
      </div>
      {drafts.length > 0 && <p className="text-[11px] text-slate-500">Max characters can use the form’s detected limit; leave Max words blank for no word cap.</p>}
      <ul className="max-h-72 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
        {fields.map(f => (
          <li key={f.token} className={`space-y-2 rounded-lg border p-3 text-xs ${!f.required || f.status === 'optional' ? 'border-yellow-300 bg-yellow-50' : f.status === 'review' ? 'border-amber-200 bg-amber-50/60' : 'border-red-200 bg-red-50/40'}`}>
            <button type="button" className="block w-full min-w-0 text-left text-slate-800 hover:underline focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:no-underline" disabled={disabled || !!busy}
              title={/cover\s*letter/i.test(f.label) ? 'Open cover-letter drafting' : 'Show this question on the application'}
              onClick={() => /cover\s*letter/i.test(f.label) && onOpenCoverLetter ? onOpenCoverLetter() : void show(f.token)}>
              <span className="block break-words font-medium">{f.label}</span>
              <span className="block text-[11px] text-slate-500">{/cover\s*letter/i.test(f.label) ? 'Open cover-letter drafting' : `${f.status === 'review' ? 'Check this answer on the page' : f.required ? 'Required' : 'Optional'} · Show on page`}</span>
            </button>
            {f.draft && chat && <div className="space-y-2 border-t border-slate-200/80 pt-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-700" title="Include this response in the draft">
                <input type="checkbox" aria-label={`Select ${f.label} for drafting`} checked={selected.includes(f.token)} disabled={disabled || !!busy}
                  onChange={e => setSelected(current => e.target.checked ? [...current, f.token] : current.filter(token => token !== f.token))} />
                Select
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="min-w-0 space-y-1 text-[11px] text-slate-600" title={f.characterLimit ? `Detected maximum: ${f.characterLimit} characters. Edit to override.` : 'Enter a maximum, or leave blank to use the default response instructions.'}>
                  <span className="block">Max characters</span>
                  <input type="number" min={1} max={20000} step={1} inputMode="numeric" aria-label={`Character limit for ${f.label}`} placeholder="Default"
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400"
                    value={characterLimits[f.token] ?? (f.characterLimit ? String(f.characterLimit) : '')} disabled={disabled || !!busy}
                    onChange={e => setCharacterLimits(current => ({ ...current, [f.token]: e.target.value }))} />
                </label>
                <label className="min-w-0 space-y-1 text-[11px] text-slate-600" title={f.wordLimit ? `Detected maximum: ${f.wordLimit} words. Edit to override.` : 'Optional maximum number of words for this response.'}>
                  <span className="block">Max words</span>
                  <input type="number" min={1} max={5000} step={1} inputMode="numeric" aria-label={`Word limit for ${f.label}`} placeholder="None"
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400"
                    value={wordLimits[f.token] ?? (f.wordLimit ? String(f.wordLimit) : '')} disabled={disabled || !!busy}
                    onChange={e => setWordLimits(current => ({ ...current, [f.token]: e.target.value }))} />
                </label>
              </div>
            </div>}
          </li>
        ))}
      </ul>
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}
