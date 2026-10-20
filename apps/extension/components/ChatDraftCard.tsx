import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { CHAT_PROVIDERS, type ChatProvider } from '@/lib/chat-providers';
import { splitBatchReply } from '@/lib/prompt';
import { CHAT_DRAFT_KEY, sendToBackground, type ChatDraft } from '@/lib/messages';
import { Button, Notice, Textarea } from './ui';

function useChatDraft(): ChatDraft | null {
  const [draft, setDraft] = useState<ChatDraft | null>(null);
  useEffect(() => {
    let mounted = true, revision = 0;
    void browser.storage.session.get(CHAT_DRAFT_KEY).then(r => {
      if (mounted && revision === 0) setDraft((r[CHAT_DRAFT_KEY] as ChatDraft | undefined) ?? null);
    }).catch(() => undefined);
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'session' && CHAT_DRAFT_KEY in changes) { revision++; setDraft((changes[CHAT_DRAFT_KEY]!.newValue as ChatDraft | undefined) ?? null); }
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => { mounted = false; browser.storage.onChanged.removeListener(onChanged); };
  }, []);
  return draft;
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/**
 * Starts drafting `tokens` (one question, or several in one prompt) on the chat website. Must be called straight
 * from a click: Chrome shows the site permission prompt only then. Declining still works; the prompt is then only
 * copied for the person to paste.
 */
export async function startChatDraft(applicationId: number, tokens: string[], chat: ChatProvider): Promise<void> {
  await browser.permissions.request({ origins: chat.origins }).catch(() => false);
  const res = await sendToBackground('startChatDraft', { applicationId, tokens });
  if (!res.ok) throw new Error(res.error);
  // Copy while this panel still has focus; opening the chat tab moves focus away.
  await copyText(res.draft.prompt);
  const opened = await sendToBackground('openChatDraft', { draftId: res.draft.id });
  if (!opened.ok) throw new Error(opened.error);
}

const PASTE = '⌘V (Mac) or Ctrl+V';

function chatStatus(draft: ChatDraft, name: string): string {
  if (!draft.inserting) return `Paste the prompt in ${name} with ${PASTE}, read it, then press Send. Use Copy prompt if it is not on your clipboard.`;
  switch (draft.insertResult) {
    case undefined: return `Opening ${name} and putting your prompt in its message box…`;
    case 'inserted': return `Your prompt is in ${name}’s message box. Read it, then press Send.`;
    case 'occupied': return `${name}’s message box already had text, so it was left alone. Clear it, then paste the prompt with ${PASTE}.`;
    case 'missing': return `${name}’s message box has not appeared yet. Sign in if asked and the prompt goes in when the chat opens, or paste it with ${PASTE}.`;
    default: return `${name} did not accept the text. Paste the prompt with ${PASTE}.`;
  }
}

/** The free responses being drafted on a chat website. Shown on every tab, since replies are copied from the chat tab. */
export function ChatDraftCard() {
  const draft = useChatDraft();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [whole, setWhole] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { setAnswers({}); setWhole(''); setError(''); setFailures({}); setCopied(false); }, [draft?.id]);
  if (!draft) return note ? <div role="status"><Notice tone="success" onDismiss={() => setNote('')}>{note}</Notice></div> : null;
  const name = CHAT_PROVIDERS[draft.provider]?.name ?? 'the chat';
  const total = draft.questions.length;
  const ready = draft.questions.filter(q => answers[q.token]?.trim());

  async function run(task: () => Promise<void>) {
    setBusy(true); setError('');
    try { await task(); } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong. Try again.'); } finally { setBusy(false); }
  }
  const use = () => run(async () => {
    const res = await sendToBackground('useChatAnswer', { draftId: draft.id, answers: ready.map(q => ({ token: q.token, answer: answers[q.token]! })) });
    if (!res.ok) throw new Error(res.error);
    const used = res.results.filter(r => r.ok), failed = res.results.filter(r => !r.ok);
    setFailures(Object.fromEntries(failed.map(r => [r.token, r.note])));
    if (used.length) setNote(used.length === 1 ? used[0]!.note : `Added ${used.length} answers for review. Check them on the page before submitting.`);
  });
  const reopen = () => run(async () => {
    const res = await sendToBackground('openChatDraft', { draftId: draft.id });
    if (!res.ok) throw new Error(res.error);
  });
  const cancel = () => run(async () => { await sendToBackground('cancelChatDraft', { draftId: draft.id }); setNote(''); });
  /** A whole pasted reply fills the answer boxes it has markers for; each box stays editable. */
  function pasteWhole(text: string) {
    setWhole(text);
    const parts = splitBatchReply(text, Math.max(...draft!.questions.map(q => q.number)));
    setAnswers(current => {
      const next = { ...current };
      for (const q of draft!.questions) if (parts[q.number - 1]) next[q.token] = parts[q.number - 1]!;
      return next;
    });
  }

  return (
    <section aria-label={`Draft in ${name}`} className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-xs text-slate-700 shadow-sm">
      <div>
        <p className="text-sm font-semibold text-slate-900">{total > 1 ? `Drafting ${total} answers in ${name}` : `Drafting in ${name}`}</p>
        {total === 1 && <p className="mt-0.5 break-words font-medium">{draft.questions[0]!.question}</p>}
        <p className="truncate text-slate-500">{[draft.role, draft.company].filter(Boolean).join(' · ')}</p>
      </div>
      <ol className="list-decimal space-y-1 pl-4">
        <li role="status">{chatStatus(draft, name)}</li>
        <li>{draft.batch ? `Copy ${name}’s whole reply with its copy button and paste it below. It is split into the answer boxes.` : `Copy ${name}’s reply with its copy button and paste it below.`}</li>
        <li>{total > 1 ? 'Check each answer, then Use answers adds them to the application for your review.' : 'Use answer adds it to the application for your review.'}</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button className="px-2 py-1 text-xs" variant="secondary" disabled={busy} onClick={async () => setCopied(await copyText(draft.prompt))}>{copied ? 'Prompt copied' : 'Copy prompt'}</Button>
        <Button className="px-2 py-1 text-xs" variant="secondary" disabled={busy} onClick={() => void reopen()}>Open {name} again</Button>
      </div>
      <details>
        <summary className="cursor-pointer font-medium text-slate-600">Show prompt</summary>
        <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-600">{draft.prompt}</p>
      </details>
      {draft.batch && <>
        <label className="block font-medium text-slate-700" htmlFor="chat-draft-whole">Whole reply from {name}</label>
        <Textarea id="chat-draft-whole" className="min-h-16 bg-white text-xs" value={whole} maxLength={60000} placeholder={`Paste ${name}’s whole reply here`} onChange={e => pasteWhole(e.target.value)} />
        {whole.trim() && !ready.length && <p className="text-amber-800">No “Answer 1”, “Answer 2”… markers were found. Paste each answer into its box below.</p>}
      </>}
      {draft.questions.map(q => {
        const id = `chat-draft-${q.token}`;
        return <div key={q.token} className="space-y-1">
          <label className="block font-medium text-slate-700" htmlFor={id}>{total === 1 && !draft.batch ? `Reply from ${name}` : `Answer ${q.number}: ${q.question}`}</label>
          <Textarea id={id} className="bg-white text-xs" value={answers[q.token] ?? ''} maxLength={20000}
            placeholder={draft.batch ? `Filled from the whole reply, or paste answer ${q.number} here` : `Paste ${name}’s reply here`}
            onChange={e => setAnswers(current => ({ ...current, [q.token]: e.target.value }))} />
          {failures[q.token] && <Notice tone="error">{failures[q.token]}</Notice>}
        </div>;
      })}
      <div className="flex flex-wrap gap-2">
        <Button className="px-2 py-1 text-xs" disabled={busy || !ready.length} onClick={() => void use()}>
          {busy ? 'Working…' : total === 1 ? 'Use answer' : ready.length === total ? 'Use answers' : `Use ${ready.length} of ${total} answers`}
        </Button>
        <Button className="px-2 py-1 text-xs" variant="secondary" disabled={busy} onClick={() => void cancel()}>Cancel draft</Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}
