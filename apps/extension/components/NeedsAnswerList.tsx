import { useState } from 'react';
import type { ChatProvider } from '@/lib/chat-providers';
import { needReviewFields } from '@/lib/application-workflow';
import { sendToBackground } from '@/lib/messages';
import type { Application } from '@/lib/types';
import { startChatDraft } from './ChatDraftCard';
import { Button, Notice } from './ui';

/**
 * The questions counted as Need review. Clicking one shows it on the application; answering it removes it here.
 * Free responses can be drafted on the chosen chat website, one at a time or all in one prompt.
 */
export function NeedsAnswerList({ app, chat, disabled }: { app: Application; chat?: ChatProvider; disabled: boolean }) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  const fields = needReviewFields(app);
  if (!fields.length) return null;
  const drafts = chat ? fields.filter(f => f.draft) : [];
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
  const draft = (key: string, tokens: string[]) => { setError(''); setBusy(key); void startChatDraft(app.id!, tokens, chat!).catch(err => setError(err instanceof Error ? err.message : `Could not open ${chat!.name}.`)).finally(() => setBusy(undefined)); };

  return (
    <section aria-label="Unanswered questions" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-700">Needs your answer <span className="font-normal text-slate-500">· {[required && `${required} required`, optional && `${optional} optional`].filter(Boolean).join(', ')}</span></p>
        {drafts.length > 1 && <Button className="px-2 py-1 text-xs" disabled={disabled || !!busy} onClick={() => draft('all', drafts.map(f => f.token))}>
          {busy === 'all' ? 'Preparing…' : `Draft all ${drafts.length} in ${chat!.name}`}
        </Button>}
      </div>
      <ul className="max-h-72 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
        {fields.map(f => (
          <li key={f.token} className={`flex items-start justify-between gap-2 rounded-lg border p-2 text-xs ${!f.required || f.status === 'optional' ? 'border-yellow-300 bg-yellow-50' : f.status === 'review' ? 'border-amber-200 bg-amber-50/60' : 'border-red-200 bg-red-50/40'}`}>
            <button type="button" className="min-w-0 text-left text-slate-800 hover:underline focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:no-underline" disabled={disabled || !!busy}
              title="Show this question on the application" onClick={() => void show(f.token)}>
              <span className="block break-words font-medium">{f.label}</span>
              <span className="block text-[11px] text-slate-500">{f.status === 'review' ? 'Check this answer on the page' : f.required ? 'Required' : 'Optional'} · Show on page</span>
            </button>
            {f.draft && chat && <Button className="shrink-0 px-2 py-1 text-xs" variant="secondary" disabled={disabled || !!busy} onClick={() => draft(f.token, [f.token])}>
              {busy === f.token ? 'Preparing…' : `Draft in ${chat.name}`}
            </Button>}
          </li>
        ))}
      </ul>
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}
