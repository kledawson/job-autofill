import { browser } from 'wxt/browser';
import type { Settings } from './types';
import { DEFAULT_PROMPT_TEMPLATE, isPreviousDefaultTemplate } from './prompt';
import { parseAnswerSource } from './chat-providers';

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

const DEFAULTS: Settings = {
  geminiApiKey: '',
  geminiModel: DEFAULT_GEMINI_MODEL,
  answerSource: 'none',
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  sheetId: '',
  sheetUrl: '',
  sheetTabId: null,
  sheetTabName: '',
  onboardingComplete: false,
};

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(Object.keys(DEFAULTS));
  const settings = { ...DEFAULTS, ...(stored as Partial<Settings>) };
  return {
    ...settings,
    answerSource: parseAnswerSource((stored as Partial<Settings>).answerSource, !!settings.geminiApiKey),
    // An unedited copy of the earlier default follows the current default; edited templates are kept.
    promptTemplate: isPreviousDefaultTemplate(settings.promptTemplate) ? DEFAULT_PROMPT_TEMPLATE : settings.promptTemplate,
  };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await browser.storage.local.set(patch);
}

/** What UI pages may see. The API key itself stays with the background worker. */
export interface PublicSettings extends Omit<Settings, 'geminiApiKey'> {
  hasGeminiKey: boolean;
  sheetsAvailable: boolean;
}
