import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Application } from '@/lib/types';
import type { PublicSettings } from '@/lib/settings';
import { CHAT_PROVIDERS, chatProviderFor } from '@/lib/chat-providers';
import { db, getProfile } from '@/lib/db';
import { extractPdfText } from '@/lib/resume-pdf';
import { COVER_LETTER_FLOW_KEY, sendToBackground } from '@/lib/messages';
import { Button, Notice, Textarea } from './ui';

type CoverLetterFlow = { applicationId: number; draft: string; promptText: string; completed?: 'document' | 'application' };

function referenceSignature(reference: string): string {
  const lines = reference.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const close = lines.findIndex(line => /^(?:sincerely|sincerely yours|respectfully|regards|best regards|kind regards|warm regards|best|yours truly)[,!]?$/i.test(line));
  return close >= 0 ? (lines[close + 1] ?? '') : '';
}

function addSincerelyAndName(text: string, name: string): string {
  const lines = text.replace(/\r/g, '').trim().split('\n');
  const closing = lines.findIndex(line => /^(?:sincerely|sincerely yours|respectfully|respectfully yours|regards|best|best regards|all the best|kind regards|warm regards|warmly|yours truly|yours sincerely|faithfully|yours faithfully|cheers|thank you|with gratitude)[,!]?$/i.test(line.trim()));
  const suppliedName = closing >= 0 ? lines.slice(closing + 1).map(line => line.trim()).find(Boolean) ?? '' : '';
  const body = (closing >= 0 ? lines.slice(0, closing) : lines).join('\n').trimEnd();
  return `${body}\n\nSincerely,\n${name || suppliedName}`.trim();
}

export function CoverLetterDraft({ app, settings, flowActive = false, open = false, onOpen }: { app: Application; settings: PublicSettings | null; flowActive?: boolean; open?: boolean; onOpen?: () => void }) {
  const [source, setSource] = useState<'pdf' | 'text'>(settings?.generalCoverLetter?.trim() ? 'text' : 'pdf');
  const [jobDescription, setJobDescription] = useState(app.jobDescription ?? '');
  const [draft, setDraft] = useState('');
  const [promptText, setPromptText] = useState('');
  const [signatureName, setSignatureName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [completion, setCompletion] = useState<'document' | 'application'>();
  const [pdfAvailable, setPdfAvailable] = useState(false);
  useEffect(() => { void db.files.get('coverLetter').then(file => setPdfAvailable(!!file)).catch(() => setPdfAvailable(false)); }, []);
  useEffect(() => {
    let active = true;
    setDone(false);
    const hydrate = (value: unknown) => {
      const flow = value as CoverLetterFlow | undefined;
      if (flow && flow.applicationId === applicationId && active) { setDraft(flow.draft ?? ''); setPromptText(flow.promptText ?? ''); setDone(!!flow.completed); setCompletion(flow.completed); }
    };
    void browser.storage.session.get(COVER_LETTER_FLOW_KEY).then(values => hydrate(values[COVER_LETTER_FLOW_KEY]));
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'session' && COVER_LETTER_FLOW_KEY in changes) hydrate(changes[COVER_LETTER_FLOW_KEY]?.newValue);
    };
    browser.storage.onChanged.addListener(changed);
    return () => { active = false; browser.storage.onChanged.removeListener(changed); };
  }, [app.id]);
  const provider = chatProviderFor(settings?.answerSource) ?? (settings?.answerSource === 'gemini-api' ? CHAT_PROVIDERS.gemini : undefined);
  const coverLetterField = app.fieldFeedback?.find(f => /cover\s*letter/i.test(f.label));
  const isTextCoverLetter = !!coverLetterField && (
    coverLetterField.kind === 'text' || coverLetterField.kind === 'textarea' ||
    (!coverLetterField.kind && ['review', 'entered'].includes(coverLetterField.status))
  );
  const needsLetter = app.fieldFeedback?.some(f => /cover\s*letter/i.test(f.label) && f.status !== 'verified') || app.missingLabels.some(label => /cover\s*letter/i.test(label));
  const applicationId = app.id ?? -1;
  if (applicationId < 0) return null;
  if (done) return <section id="cover-letter-draft" className="rounded-lg border border-green-200 bg-green-50 p-3" aria-label="Cover letter updated">
    <p className="text-sm font-medium text-green-800">{completion === 'application' ? 'Cover letter added to the application' : 'Cover letter updated'}</p>
    {completion === 'document' && settings?.docsUrl && <a className="mt-1 inline-block text-sm font-medium text-indigo-700 underline" href={settings.docsUrl} target="_blank" rel="noreferrer">Open Google Doc</a>}
  </section>;
  if (!needsLetter && !flowActive) return null;
  if (!open && !flowActive) return <section id="cover-letter-draft" className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3" aria-label="Cover letter drafting">
    <Button variant="secondary" onClick={onOpen}>Open cover-letter drafting</Button>
  </section>;

  async function openPrompt() {
    setError(''); setBusy(true);
    try {
      if (!provider) throw new Error('Choose a chat LLM in Settings → Connections to open a new LLM tab.');
      // Request site access immediately from the click; insertion is optional when the user declines.
      const permitted = await browser.permissions.contains({ origins: provider.origins }).catch(() => false) ||
        await browser.permissions.request({ origins: provider.origins }).catch(() => false);
      let reference = settings?.generalCoverLetter?.trim() ?? '';
      if (source === 'pdf') {
        const file = await db.files.get('coverLetter');
        if (file) reference = (await extractPdfText(await file.blob.arrayBuffer())).lines.join('\n').trim();
        else reference = '';
      }
      if (!reference) throw new Error(source === 'pdf' ? 'No extractable text was found in the saved cover-letter PDF. Choose the editable text reference or add a PDF with selectable text.' : 'Add a general cover letter in Settings, or choose the saved PDF as your reference.');
      if (!jobDescription.trim()) throw new Error('Add the job description to include it in the prompt.');
      const profile = await getProfile();
      const profileName = [profile.preferredName || profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
      const signer = profileName || referenceSignature(reference);
      setSignatureName(signer);
      const writingRequest = isTextCoverLetter
        ? `Write a complete cover letter with a greeting, tailored body paragraphs, and a closing. End with exactly “Sincerely,” on one line and “${signer || 'the applicant name from the reference letter'}” on the next line. Do not include contact details or Markdown formatting. Preserve the facts and tone of the reference letter.`
        : 'Write only the replacement body paragraphs of this cover letter. Do not include a salutation, complimentary closing, signature, contact details, or Markdown formatting. Preserve the facts and tone of the reference letter, and tailor the body to the job.';
      const signatureRequirement = isTextCoverLetter && signer ? `\n\nFinal format requirement: the complete letter must end with “Sincerely,” followed by “${signer}” on the next line.` : '';
      const prompt = `${writingRequest}\n\nAdditional writing instructions:\n${settings?.coverLetterPrompt?.trim() || 'Keep the letter truthful and focus on relevant experience.'}${signatureRequirement}\n\nJob link: ${app.postingUrl || app.url}\n\nJob description:\n${jobDescription.trim().slice(0, 20000)}\n\nGeneral cover letter reference:\n${reference}`;
      setPromptText(prompt);
      await browser.storage.session.set({ [COVER_LETTER_FLOW_KEY]: { applicationId, draft, promptText: prompt } satisfies CoverLetterFlow });
      await navigator.clipboard.writeText(prompt).catch(() => undefined);
      const opened = await sendToBackground('openCoverLetterPrompt', { provider: provider.id, prompt });
      if (!opened.ok) throw new Error(opened.error);
      setError(opened.inserting
        ? `Prompt entered in ${provider.name}. Review it there, then send it. Paste the result below when ready.`
        : `Prompt is ready for ${provider.name}. Site access was not granted, so paste it into the chat. Review and send it, then paste the result below.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not prepare the prompt.'); }
    finally { setBusy(false); }
  }
  async function approve() {
    setError(''); setBusy(true);
    try {
      const textField = isTextCoverLetter ? coverLetterField : undefined;
      const res = textField
        ? await sendToBackground('fillCoverLetterField', { applicationId, text: addSincerelyAndName(draft, signatureName || referenceSignature(settings?.generalCoverLetter ?? '')) })
        : await sendToBackground('approveCoverLetter', { text: draft, signatureName: signatureName || referenceSignature(settings?.generalCoverLetter ?? '') });
      if (!res.ok) throw new Error(res.error);
      const mode = textField ? 'application' : 'document';
      setDone(true);
      setCompletion(mode);
      await browser.storage.session.set({ [COVER_LETTER_FLOW_KEY]: { applicationId, draft, promptText, completed: mode } satisfies CoverLetterFlow });
    }
    catch (err) { setError(err instanceof Error ? err.message : isTextCoverLetter ? 'Could not fill the cover-letter text box.' : 'Could not update the Google Doc.'); }
    finally { setBusy(false); }
  }
  return <section id="cover-letter-draft" tabIndex={-1} className="mt-3 space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3" aria-label="Tailor cover letter">
    <h3 className="font-medium text-slate-800">Cover letter needs your attention</h3>
    {!settings?.generalCoverLetter?.trim() && !pdfAvailable && <Notice tone="error">Add an editable general cover letter in Settings, or upload a cover-letter PDF with selectable text. One reference is required before tailoring.</Notice>}
    <label className="block text-xs font-medium">Reference letter
      <select className="mt-1 block w-full rounded border border-slate-300 bg-white p-2" value={source} onChange={e => setSource(e.target.value as 'pdf' | 'text')}>
        <option value="text">Editable general cover letter</option><option value="pdf">Saved cover-letter PDF</option>
      </select>
    </label>
    <label className="block text-xs font-medium">Job description<Textarea rows={5} value={jobDescription} onChange={e => setJobDescription(e.target.value)} placeholder="Paste the job description" />{app.jobDescription && <span className="font-normal text-slate-500">Loaded from the application page. Edit if needed.</span>}</label>
    <Button variant="secondary" disabled={busy} onClick={() => void openPrompt()}>{busy ? 'Preparing…' : `Open ${provider?.name ?? 'selected LLM'} with prompt`}</Button>
    {promptText && <details className="text-xs"><summary className="cursor-pointer font-medium">Show or copy prompt</summary><Textarea rows={8} className="mt-2" value={promptText} readOnly /><Button className="mt-2" variant="secondary" onClick={() => void navigator.clipboard.writeText(promptText).catch(() => setError('Select and copy the prompt text above.'))}>Copy prompt</Button></details>}
    <label className="block text-xs font-medium">Draft from the LLM<Textarea rows={7} value={draft} onChange={e => { const value = e.target.value; setDraft(value); setDone(false); if (flowActive) void browser.storage.session.set({ [COVER_LETTER_FLOW_KEY]: { applicationId, draft: value, promptText } satisfies CoverLetterFlow }); }} placeholder="Paste the finished cover letter here for review" /></label>
    <Button disabled={busy || !draft.trim() || (!isTextCoverLetter && !settings?.docsUrl)} onClick={() => void approve()}>{busy ? 'Adding…' : isTextCoverLetter ? 'Use cover letter in application' : 'Approve and replace body in Google Doc'}</Button>
    {!isTextCoverLetter && !settings?.docsUrl && <p className="text-xs text-slate-600">Connect a Google Doc in Settings → Connections before approving.</p>}
    {error && <Notice tone={error.startsWith('Prompt copied') ? 'success' : 'error'}>{error}</Notice>}
  </section>;
}
