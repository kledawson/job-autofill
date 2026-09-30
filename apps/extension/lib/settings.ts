import { browser } from 'wxt/browser';
import type { Settings } from './types';
import { DEFAULT_PROMPT_TEMPLATE } from './prompt';

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

const DEFAULTS: Settings = {
  geminiApiKey: '',
  geminiModel: DEFAULT_GEMINI_MODEL,
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  sheetId: '',
  sheetUrl: '',
  onboardingComplete: false,
};

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...(stored as Partial<Settings>) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await browser.storage.local.set(patch);
}

/** What UI pages may see. The API key itself stays with the background worker. */
export interface PublicSettings extends Omit<Settings, 'geminiApiKey'> {
  hasGeminiKey: boolean;
  sheetsAvailable: boolean;
}
