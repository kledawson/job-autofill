import { useRef, useState } from 'react';
import { db, getProfile, saveProfile } from '@/lib/db';
import { sendToBackground } from '@/lib/messages';
import { DEFAULT_PROMPT_TEMPLATE, PROMPT_PLACEHOLDERS } from '@/lib/prompt';
import { DEFAULT_GEMINI_MODEL, updateSettings, type PublicSettings } from '@/lib/settings';
import { emptyProfile, type Profile, type StoredFile } from '@/lib/types';
import { useLiveQuery } from './hooks';
import { Button, Card, Field, Input, Notice, Textarea } from './ui';

function formatBytes(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function FileSlot({ kind, label, hint }: { kind: StoredFile['kind']; label: string; hint: string }) {
  const file = useLiveQuery(() => db.files.get(kind), [kind]);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  async function onPick(f: File | undefined) {
    setError('');
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return setError('Files over 10 MB are rejected by most application forms.');
    await db.files.put({ kind, name: f.name, type: f.type || 'application/pdf', blob: f, updatedAt: Date.now() });
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">{label}</p>
          {file ? (
            <p className="truncate text-sm text-slate-600">
              {file.name} · {formatBytes(file.blob.size)} · updated {new Date(file.updatedAt).toLocaleDateString()}
            </p>
          ) : (
            <p className="text-sm text-slate-500">{hint}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {file && (
            <Button variant="ghost" onClick={() => db.files.delete(kind)}>
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
        accept=".pdf,application/pdf,.doc,.docx"
        className="hidden"
        onChange={(e) => {
          void onPick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function DocumentsSection() {
  return (
    <Card title="Documents" description="Attached to the resume and cover letter upload fields. Stored only on this computer.">
      <div className="space-y-3">
        <FileSlot kind="resume" label="Resume (PDF)" hint="Required by almost every application." />
        <FileSlot kind="coverLetter" label="Cover letter" hint="Optional. Attached when a form has a cover letter upload." />
      </div>
    </Card>
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
      title="Gemini (free responses)"
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
        <Field label="API key" hint={hasKey ? 'A key is saved. Enter a new one to replace it.' : 'Stored only in this browser and used only by the extension’s background worker.'}>
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
              variant="ghost"
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
          Gemini receives each question, the job description, and your education, experience, and skills. It never
          receives your contact details or voluntary self-identification answers. Google’s free tier may use prompts to
          improve its models.
        </p>
      </div>
    </Card>
  );
}

export function SheetsSection({ settings }: { settings: PublicSettings | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!settings) return null;

  async function connect() {
    setBusy(true);
    setError('');
    const res = await sendToBackground('connectSheets', {});
    if (!res.ok) setError(res.error);
    setBusy(false);
  }

  return (
    <Card
      title="Google Sheets tracking"
      description="Adds a row to a “Job Applications” sheet in your Drive for each application. The extension can only see the sheet it creates."
    >
      {settings.sheetId ? (
        <div className="flex flex-wrap items-center gap-3">
          <Notice tone="success">Connected.</Notice>
          <a className="text-sm font-medium text-indigo-700 underline" href={settings.sheetUrl} target="_blank" rel="noreferrer">
            Open tracking sheet
          </a>
        </div>
      ) : settings.sheetsAvailable ? (
        <Button onClick={connect} disabled={busy}>
          {busy ? 'Connecting…' : 'Sign in with Google and create sheet'}
        </Button>
      ) : (
        <Notice tone="warn">
          Google sign-in is not configured in this build, so tracking is off. Filling still works. See the README to add
          an OAuth client ID.
        </Notice>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </Card>
  );
}

export function PromptSection({ settings }: { settings: PublicSettings | null }) {
  const [template, setTemplate] = useState(settings?.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE);
  const [saved, setSaved] = useState(false);
  const missing = PROMPT_PLACEHOLDERS.filter((p) => p === '{question}' && !template.includes(p));

  return (
    <Card title="Free-response prompt" description="The instructions Gemini gets for every free-response question.">
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
            variant="ghost"
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
    if (!confirm('Delete your profile, resume, history, and settings from this browser? Your Google Sheet is not touched.')) return;
    await sendToBackground('deleteAllData', {});
    setMessage({ tone: 'success', text: 'All local data deleted.' });
    onImported();
  }

  return (
    <Card title="Your data" description="Everything lives in this browser. There is no server.">
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
