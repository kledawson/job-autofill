import { useState } from 'react';
import { browser } from 'wxt/browser';
import { ANSWER_SOURCES, answerSourceHint, chatProviderFor, parseAnswerSource, type AnswerSource } from '@/lib/chat-providers';
import { updateSettings, type PublicSettings } from '@/lib/settings';
import { Select } from './ui';

/** Who writes free responses: the same choice as Settings → Connections → Free Responses. */
export function FreeResponsePicker({ settings }: { settings: PublicSettings | null }) {
  const [denied, setDenied] = useState('');
  if (!settings) return null;

  async function choose(value: AnswerSource) {
    setDenied('');
    const chat = chatProviderFor(value);
    // Chrome shows the site permission prompt only during the change event, so ask before anything else.
    const allowed = chat ? await browser.permissions.request({ origins: chat.origins }).catch(() => false) : true;
    await updateSettings({ answerSource: value });
    if (chat && !allowed) setDenied(`Without access to ${chat.name}, Draft copies the prompt for you to paste.`);
  }

  return (
    <div>
      <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
        <span className="shrink-0">Free responses</span>
        <Select className="py-1.5 text-sm" aria-describedby="free-response-hint" value={settings.answerSource} options={ANSWER_SOURCES}
          onChange={e => void choose(parseAnswerSource(e.target.value))} />
      </label>
      <p id="free-response-hint" className="mt-1 text-xs text-slate-500">
        {denied || answerSourceHint(settings.answerSource, settings.hasGeminiKey)}
        {settings.answerSource === 'gemini-api' && !settings.hasGeminiKey && <> <a className="text-indigo-700 underline" href={browser.runtime.getURL('/options.html#connections' as never)} target="_blank" rel="noreferrer">Open Settings</a></>}
      </p>
    </div>
  );
}
