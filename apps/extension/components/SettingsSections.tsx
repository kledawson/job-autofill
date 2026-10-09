import { confirmDelete } from './confirm-delete';
import { useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { db, getProfile, saveProfile } from '@/lib/db';
import type { ResumeDraft } from '@/lib/resume';
import { extractPdfText } from '@/lib/resume-pdf';
import { missingSections, parseResumeText, type ResumeSection } from '@/lib/resume-text';
import { sendToBackground } from '@/lib/messages';
import { DEFAULT_PROMPT_TEMPLATE, PROMPT_PLACEHOLDERS } from '@/lib/prompt';
import { DEFAULT_GEMINI_MODEL, updateSettings, type PublicSettings } from '@/lib/settings';
import { emptyProfile, type Profile, type StoredFile } from '@/lib/types';
import { useLiveQuery } from './hooks';
import { Button, Card, Field, Input, Notice, Textarea, useToast } from './ui';

function formatBytes(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function FileSlot({ kind, label, hint }: { kind: StoredFile['kind']; label: string; hint: string }) {
  const file = useLiveQuery(() => db.files.get(kind), [kind]);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const noun = { resume: 'Resume', coverLetter: 'Cover letter', transcript: 'Transcript' }[kind] ?? 'Document';

  /** Opens the saved PDF in a new browser tab, titled with the file's name. */
  function view() {
    window.open(browser.runtime.getURL(`/viewer.html?kind=${kind}` as never), '_blank');
  }

  async function onPick(f: File | undefined) {
    setError('');
    if (!f) return;
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return setError('Files must be PDFs.');
    if (f.size > 10 * 1024 * 1024) return setError('Files over 10 MB are rejected by most application forms.');
    const replaced = !!file;
    await db.files.put({ kind, name: f.name, type: f.type || 'application/pdf', blob: f, updatedAt: Date.now() });
    showToast(`${noun} ${replaced ? 'replaced' : 'uploaded'}`);
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">{label}</p>
          {file ? (
            <p className="truncate text-sm text-slate-600">
              {file.name} · {formatBytes(file.blob.size)} · Last updated {new Date(file.updatedAt).toLocaleDateString()}
            </p>
          ) : (
            <p className="text-sm text-slate-500">{hint}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {file && (
            <Button variant="secondary" onClick={view}>
              View
            </Button>
          )}
          {file && (
            <Button variant="secondary" onClick={async () => { if (await confirmDelete('Remove ' + noun.toLowerCase() + '?', file.name + ' — Applications will not attach it until you upload another.', 'Remove')) { try { await db.files.delete(kind); showToast(noun + ' removed'); } catch { setError('Could not remove the document. Try again.'); } } }}>
              Remove
            </Button>
          )}
          <Button variant="secondary" onClick={() => input.current?.click()}>
            {file ? 'Replace' : 'Upload'}
          </Button>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          void onPick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {toast}
    </div>
  );
}

export function DocumentsSection({
  onResumeDraft,
  hasGeminiKey,
  onNeedKey,
}: {
  /** Merges parsed resume fields into the profile and returns what was filled. Omit to hide the option. */
  onResumeDraft?: (draft: ResumeDraft) => Promise<string[]>;
  hasGeminiKey?: boolean;
  /** Shows where to add a Gemini key (only needed for sections the local reader misses). */
  onNeedKey?: () => void;
}) {
  return (
    <Card title="Documents" description="Attached to the resume, cover letter, and transcript upload fields. Files must be PDFs. Stored only on this computer.">
      <div className="space-y-3">
        <FileSlot kind="resume" label="Resume" hint="Required by almost every application" />
        {onResumeDraft && <ResumeImport onResumeDraft={onResumeDraft} hasGeminiKey={!!hasGeminiKey} onNeedKey={onNeedKey} />}
        <FileSlot kind="coverLetter" label="Cover letter" hint="Optional. Attached when a form has a cover letter upload." />
        <FileSlot kind="transcript" label="Transcript" hint="Optional. Attached when a form has a transcript upload." />
      </div>
    </Card>
  );
}

const SECTION_NAMES: Record<ResumeSection, string> = { education: 'education', experience: 'work experience', skills: 'skills' };
const listText = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

function ResumeImport({
  onResumeDraft,
  hasGeminiKey,
  onNeedKey,
}: {
  onResumeDraft: (draft: ResumeDraft) => Promise<string[]>;
  hasGeminiKey: boolean;
  onNeedKey?: () => void;
}) {
  const resume = useLiveQuery(() => db.files.get('resume'));
  const [busy, setBusy] = useState<'local' | 'gemini' | null>(null);
  const [status, setStatus] = useState<{ tone: 'success' | 'error' | 'info' | 'warn'; text: string } | null>(null);
  // What the local reader could not find, and the text Gemini can use for it.
  const [leftover, setLeftover] = useState<{ sections: ResumeSection[]; text: string } | null>(null);
  if (!resume) return null;
  const isPdf = /pdf$/i.test(resume.type) || /\.pdf$/i.test(resume.name);

  async function readLocally() {
    setBusy('local');
    setStatus(null);
    setLeftover(null);
    try {
      const { lines, links } = await extractPdfText(await resume!.blob.arrayBuffer());
      const text = lines.join('\n');
      if (text.replace(/\s/g, '').length < 40) {
        setStatus({ tone: 'warn', text: 'This PDF has no selectable text (it may be a scanned image), so it can’t be read on this computer.' });
        setLeftover({ sections: [], text: '' });
        return;
      }
      const draft = parseResumeText(lines, links);
      const filled = await onResumeDraft(draft);
      const missing = missingSections(draft);
      setStatus(
        filled.length
          ? { tone: 'success', text: `Filled from your resume: ${filled.join(', ')}. Check each one as you continue.` }
          : { tone: 'info', text: 'Nothing new to fill. Your profile already has what this resume covers.' },
      );
      if (missing.length) setLeftover({ sections: missing, text });
    } catch (err) {
      setStatus({ tone: 'error', text: `Could not read this PDF: ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  async function readWithGemini() {
    if (!leftover) return;
    setBusy('gemini');
    const res = await sendToBackground('parseResume', {
      text: leftover.text || undefined,
      sections: leftover.sections.length ? leftover.sections : undefined,
    });
    if (!res.ok) {
      setStatus({ tone: 'error', text: res.error });
    } else {
      const filled = await onResumeDraft(res.draft);
      setStatus(
        filled.length
          ? { tone: 'success', text: `Gemini filled: ${filled.join(', ')}. Check each one as you continue.` }
          : { tone: 'info', text: 'Gemini didn’t find anything new either. Add the rest in the next steps.' },
      );
      setLeftover(null);
    }
    setBusy(null);
  }

  const missingText = leftover?.sections.length ? listText(leftover.sections.map((s) => SECTION_NAMES[s])) : 'your details';

  return (
    <div className="rounded-lg bg-indigo-50/60 p-4">
      <p className="text-sm font-medium text-slate-800">Fill your profile from this resume</p>
      <p className="mt-0.5 text-sm text-slate-600">
        Reads your resume on this computer and fills your name, contact details, links, current position, education,
        experience, and skills. Only empty fields are filled.
      </p>
      {!isPdf ? (
        <p className="mt-2 text-sm text-amber-800">This works with PDF resumes. Upload a PDF to use it.</p>
      ) : (
        <Button className="mt-3" onClick={readLocally} disabled={!!busy}>
          {busy === 'local' ? 'Reading resume…' : 'Fill my profile from resume'}
        </Button>
      )}
      {status && (
        <div className="mt-3">
          <Notice tone={status.tone}>{status.text}</Notice>
        </div>
      )}
      {leftover && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-sm text-slate-700">
            {leftover.sections.length
              ? `Couldn’t find your ${missingText} automatically. You can add ${leftover.sections.length > 1 ? 'them' : 'it'} in the next steps, or have Gemini read ${leftover.sections.length > 1 ? 'them' : 'it'}.`
              : 'Gemini can read scanned resumes.'}
          </p>
          {hasGeminiKey ? (
            <>
              <Button variant="secondary" className="mt-2" onClick={readWithGemini} disabled={!!busy}>
                {busy === 'gemini' ? 'Gemini is reading…' : `Read ${missingText} with Gemini`}
              </Button>
              <p className="mt-2 text-xs text-slate-500">
                Sends your resume{leftover.text ? '’s text' : ''}, including contact details, to Google Gemini. Google’s free tier may use it to
                improve its models.
              </p>
            </>
          ) : (
            onNeedKey && (
              <Button variant="ghost" className="mt-1 px-0 text-indigo-700 underline" onClick={onNeedKey}>
                Add a Gemini key to use this
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export function GeminiSection({ settings }: { settings: PublicSettings | null }) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState(settings?.geminiModel ?? DEFAULT_GEMINI_MODEL);
  const [status, setStatus] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const hasKey = settings?.hasGeminiKey;

  async function saveAndTest() {
    setBusy(true);
    setStatus({ tone: 'info', text: 'Testing…' });
    const res = await sendToBackground('testGemini', { apiKey: key || undefined, model });
    if (res.ok) {
      if (key) await sendToBackground('setGeminiKey', { apiKey: key });
      await updateSettings({ geminiModel: model.trim() || DEFAULT_GEMINI_MODEL });
      setKey('');
      setStatus({ tone: 'success', text: 'Connected. Gemini will write your free responses.' });
    } else {
      setStatus({ tone: 'error', text: res.error });
    }
    setBusy(false);
  }

  return (
    <Card
      title="Gemini (Free Responses)"
      description={
        <>
          Create a free key at{' '}
          <a className="text-indigo-700 underline" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
            Google AI Studio
          </a>
          . Don’t enable billing on it; that keeps you on the free tier.
        </>
      }
    >
      <div className="space-y-4">
        <Field label="API key" hint={hasKey ? 'A key is saved. Enter a new one to replace it.' : 'Stored only in this browser and used only by the extension’s background worker'}>
          <Input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? '•••••••••••••••• (saved)' : 'AIza…'}
            autoComplete="off"
          />
        </Field>
        <Field label="Model" hint="Any Gemini model your key can use. The default tracks the latest free Flash model.">
          <Input value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={saveAndTest} disabled={busy || (!key && !hasKey)}>
            {key ? 'Save and test' : 'Test connection'}
          </Button>
          {hasKey && (
            <Button
              variant="secondary"
              onClick={async () => {
                await sendToBackground('setGeminiKey', { apiKey: '' });
                setStatus({ tone: 'info', text: 'Key removed.' });
              }}
            >
              Remove key
            </Button>
          )}
        </div>
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
        <p className="text-xs text-slate-500">
          For free responses, Gemini receives each question, the job description, and your education, experience, and
          skills, never your contact details or self-identification answers. Your resume is read on this computer; it
          goes to Gemini only if you click “Read … with Gemini.” Google’s free tier may use prompts to improve its models.
        </p>
      </div>
    </Card>
  );
}

export function SheetsSection({ settings }: { settings: PublicSettings | null }) {
  const [status, setStatus] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!settings) return null;

  async function connect() {
    setError(''); setStatus('');
    if (!settings?.sheetsAvailable) {
      setShowSetup(true);
      setError('The link is not enough: Google sign-in has not been configured in this extension build. Complete the setup steps, rebuild and reload the extension, then connect your sheet.');
      return;
    }
    setBusy(true);
    try {
      const res = await sendToBackground('connectSheets', { url: link });
      if (!res.ok) throw new Error(res.error);
      setLink(''); setStatus('Connected to the selected tab.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not connect the sheet.'); }
    finally { setBusy(false); }
  }

  return (
    <Card
      title="Google Sheets Tracking"
      description="Mark as submitted adds an application to the selected tab, under the columns it recognizes."
    >
      <div className="space-y-4">
        {!settings.sheetsAvailable && (
          <Notice tone="warn">
            <p className="font-medium">Google sign-in setup required</p>
            <p className="mt-1">This build cannot connect a spreadsheet yet. Your sheet link alone cannot enable Google sign-in.</p>
            <Button variant="ghost" onClick={() => setShowSetup(!showSetup)} aria-expanded={showSetup}>{showSetup ? 'Hide setup steps' : 'Show setup steps'}</Button>
          </Notice>
        )}
        {showSetup && !settings.sheetsAvailable && <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm" aria-label="Google sign-in setup steps">
          <p className="font-semibold">One-time setup for this extension build</p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>In <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-indigo-700 underline">Google Cloud Console</a>, enable the Google Sheets API and create an OAuth client of type <strong>Chrome Extension</strong>.</li>
            <li>Use extension ID <code className="break-all">kjepjmmbimmbpdfinkippakkmhbglccc</code>. Add your Google account as a test user and include the spreadsheets scope.</li>
            <li>Copy <code>apps/extension/.env.example</code> to <code>apps/extension/.env</code> and set <code>WXT_GOOGLE_CLIENT_ID</code> to the public client ID.</li>
            <li>Run <code>npm run build</code>, reload Job Autofill at <code>chrome://extensions</code>, and reopen Settings. Then paste your sheet link and connect.</li>
          </ol>
          <p className="text-xs text-slate-600">You do not need to share a client secret, password or access token. The full instructions are in the extension README.</p>
        </section>}
        {settings.sheetId ? (
          <div className="flex flex-wrap items-center gap-3">
            <Notice tone="success">Connected{settings.sheetTabName ? ` · ${settings.sheetTabName}` : ' · First tab'}</Notice>
            <a className="text-sm font-medium text-indigo-700 underline" href={settings.sheetUrl} target="_blank" rel="noreferrer">
              Open tracking sheet
            </a>
            <Button variant="secondary" disabled={busy} onClick={async () => {
              setBusy(true); setError(''); setStatus('');
              try {
                const res = await sendToBackground('testSheets', {});
                if (!res.ok) throw new Error(res.error);
                setStatus('Connection works — tab: ' + res.tab + '. ' + (res.columns.length ? 'Recognized columns: ' + res.columns.join(', ') + '.' : 'Empty tab: headers will be created on first submission.') + ' No rows were written.');
              } catch (err) { setError(err instanceof Error ? err.message : 'Could not test the sheet.'); }
              finally { setBusy(false); }
            }}>{busy ? 'Testing…' : 'Test connection'}</Button>
            <Button
              variant="secondary" disabled={busy}
              onClick={async () => {
                setBusy(true); setError(''); setStatus('');
                try { await sendToBackground('disconnectSheets', {}); setStatus('Disconnected.'); }
                catch (err) { setError(err instanceof Error ? err.message : 'Could not disconnect the sheet.'); }
                finally { setBusy(false); }
              }}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Field
              label="Google Sheets link"
              hint={settings.sheetsAvailable ? "Paste the link to the tab you want to track applications in. Google will ask you to approve spreadsheet access." : "Paste a sheet link, then click Connect sheet to see the required Google sign-in setup."}
            >
              <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" autoComplete="off" />
            </Field>
            <Button onClick={connect} disabled={busy || !link.trim()}>
              {busy ? 'Connecting…' : 'Connect sheet'}
            </Button>
          </div>
        )}
        <p className="text-xs text-slate-500">
          The extension reads your sheet’s header row and fills the columns it recognizes: company, position, date
          applied (and “Found”), link, location, work model, base pay, and application status (set to “Applied”). Other
          columns are left alone. An empty sheet gets these headers added.
        </p>
        {status && <div role="status"><Notice tone="success">{status}</Notice></div>}
        {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
      </div>
    </Card>
  );
}

export function PromptSection({ settings }: { settings: PublicSettings | null }) {
  const [template, setTemplate] = useState(settings?.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE);
  const [saved, setSaved] = useState(false);
  const missing = PROMPT_PLACEHOLDERS.filter((p) => p === '{question}' && !template.includes(p));

  return (
    <Card title="Free-Response Prompt" description="The instructions Gemini gets for every free-response question">
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Placeholders:{' '}
          {PROMPT_PLACEHOLDERS.map((p) => (
            <code key={p} className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
              {p}
            </code>
          ))}
        </p>
        <Textarea
          rows={16}
          className="font-mono text-xs leading-relaxed"
          value={template}
          onChange={(e) => {
            setTemplate(e.target.value);
            setSaved(false);
          }}
        />
        {missing.length > 0 && <Notice tone="warn">The template needs {'{question}'} so Gemini knows what to answer.</Notice>}
        <div className="flex items-center gap-2">
          <Button
            disabled={missing.length > 0}
            onClick={async () => {
              await updateSettings({ promptTemplate: template });
              setSaved(true);
            }}
          >
            Save prompt
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setTemplate(DEFAULT_PROMPT_TEMPLATE);
              setSaved(false);
            }}
          >
            Reset to default
          </Button>
          {saved && <span className="text-sm text-green-700">Saved</span>}
        </div>
      </div>
    </Card>
  );
}

export function DataSection({ onImported }: { onImported: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function exportProfile() {
    const profile = await getProfile();
    const blob = new Blob([JSON.stringify({ version: 1, profile }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'job-autofill-profile.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importProfile(file: File | undefined) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = (data.profile ?? data) as Partial<Profile>;
      if (typeof incoming !== 'object' || !('firstName' in incoming)) throw new Error('Not a profile export.');
      await saveProfile({ ...emptyProfile(), ...incoming, id: 'me' } as Profile);
      setMessage({ tone: 'success', text: 'Profile imported.' });
      onImported();
    } catch (err) {
      setMessage({ tone: 'error', text: `Could not import: ${(err as Error).message}` });
    }
  }

  async function deleteAll() {
    if (!await confirmDelete('Delete all local data?', 'Your profile, documents, presets, Memories, history and settings will be deleted from this browser. Your Google Sheet is kept.', 'Delete all data')) return;
    try { await sendToBackground('deleteAllData', {}); setMessage({ tone: 'success', text: 'All local data deleted.' }); onImported(); }
    catch { setMessage({ tone: 'error', text: 'Could not delete all local data. Try again.' }); }
  }

  return (
    <Card title="Your Data" description="Everything lives in this browser. There is no server.">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={exportProfile}>
          Export profile (JSON)
        </Button>
        <Button variant="secondary" onClick={() => input.current?.click()}>
          Import profile
        </Button>
        <Button variant="danger" onClick={deleteAll}>
          Delete all data
        </Button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void importProfile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {message && (
        <div className="mt-3">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
    </Card>
  );
}
