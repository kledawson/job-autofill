import type { Profile } from './types';
import { normalizeQuestion } from './remembered-mappings';

export const DEFAULT_PRESET_ID = 'default';
export type DocumentChoice = 'profile' | 'none' | string;
export interface PreparedResponse { question: string; answer: string; aliases: string[] }
export interface ApplicationPreset {
  id: string; schemaVersion: 1; revision: number; updatedAt: number; name: string;
  resume: DocumentChoice; coverLetter: DocumentChoice;
  links: { portfolio: string | null; github: string | null; website: string | null };
  emphasis: string; responses: PreparedResponse[];
}
export interface PresetDocument { id: string; name: string; type: string; blob: Blob; updatedAt: number }
export const defaultPreset = (): ApplicationPreset => ({
  id: DEFAULT_PRESET_ID, schemaVersion: 1, revision: 1, updatedAt: 0, name: 'Default',
  resume: 'profile', coverLetter: 'profile', links: { portfolio: null, github: null, website: null },
  emphasis: '', responses: [],
});
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid application preset.');
  return v as Record<string, unknown>;
};
function text(v: unknown, limit: number, required = false): string {
  if (typeof v !== 'string' || v.length > limit || (required && !v.trim())) throw new Error('Enter a valid preset name, question or answer within its length limit.');
  return v.trim();
}
export function presetId(v: unknown): string {
  if (typeof v !== 'string' || !/^(default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(v)) throw new Error('Choose an available application preset.');
  return v;
}
function documentChoice(v: unknown): DocumentChoice {
  return v === 'profile' || v === 'none' ? v : presetId(v);
}
function link(v: unknown): string | null {
  if (v === null) return null;
  const value = text(v, 2000);
  if (!value) return '';
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Use a full http or https portfolio link.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a full http or https portfolio link without credentials.');
  return url.href;
}
export function parsePreset(value: unknown): ApplicationPreset {
  const v = object(value), links = object(v.links);
  if (v.schemaVersion !== 1 || !Number.isSafeInteger(v.revision) || Number(v.revision) < 1 ||
      !Number.isSafeInteger(v.updatedAt) || Number(v.updatedAt) < 0) throw new Error('Unsupported or invalid application preset.');
  if (!Array.isArray(v.responses) || v.responses.length > 20) throw new Error('Use at most 20 prepared responses in a preset.');
  const seen = new Set<string>();
  const responses = v.responses.map(raw => {
    const r = object(raw);
    if (!Array.isArray(r.aliases) || r.aliases.length > 10) throw new Error('Use at most 10 approved wordings per response.');
    const response = { question: text(r.question, 700, true), answer: text(r.answer, 10000, true), aliases: r.aliases.map(a => text(a, 700, true)) };
    for (const q of [response.question, ...response.aliases]) {
      const key = normalizeQuestion(q);
      if (!key || seen.has(key)) throw new Error('Two response wordings overlap. Give each question one answer.');
      seen.add(key);
    }
    return response;
  });
  return {
    id: presetId(v.id), schemaVersion: 1, revision: Number(v.revision), updatedAt: Number(v.updatedAt),
    name: text(v.name, 80, true), resume: documentChoice(v.resume), coverLetter: documentChoice(v.coverLetter),
    links: { portfolio: link(links.portfolio), github: link(links.github), website: link(links.website) },
    emphasis: text(v.emphasis, 4000), responses,
  };
}
/** Only presentation links change. Applicant facts and qualifications are never overridden. */
export function profileForPreset(profile: Profile, preset: ApplicationPreset): Profile {
  const resolved = structuredClone(profile);
  for (const key of ['portfolio', 'github', 'website'] as const) {
    if (preset.links[key] !== null) resolved[key] = preset.links[key]!;
  }
  return resolved;
}
/** Approved wordings only. Never use similarity to silently approve a new essay question. */
export function preparedResponse(responses: PreparedResponse[], question: string): string | undefined {
  const key = normalizeQuestion(question);
  return responses.find(r => [r.question, ...r.aliases].some(q => normalizeQuestion(q) === key))?.answer;
}
