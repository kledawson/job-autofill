import type { Platform } from './types';
import type { ProfileKey } from './autofill/classify';
import { INTENTS, booleanAnswer, questionMeaning, sameMeaning, wordingTokens, tokenSimilarity, type QuestionMeaning } from './answer-semantics';

/** Explicitly selectable facts; computed acknowledgements and file uploads are excluded. */
export const REMEMBERABLE_PROFILE_FIELDS = {
  fullName: 'Full name', firstName: 'First name', lastName: 'Last name', preferredName: 'Preferred name',
  pronouns: 'Pronouns', email: 'Email', phone: 'Phone', phoneCountryCode: 'Phone country code',
  address: 'Street address', city: 'City', state: 'State', zip: 'Postal code', country: 'Country', location: 'Location',
  linkedin: 'LinkedIn', github: 'GitHub', portfolio: 'Portfolio', website: 'Website',
  currentCompany: 'Current employer', currentTitle: 'Current title', school: 'School', degree: 'Degree',
  major: 'Major / discipline', gpa: 'GPA', eduStartMonth: 'Education start month', eduStartYear: 'Education start year',
  eduEndMonth: 'Education end month', eduEndYear: 'Education end year', gradDate: 'Graduation date',
  authorized: 'Authorized to work in the US', sponsorship: 'Needs sponsorship', usCitizen: 'US citizen',
  citizenshipStatus: 'Citizenship status', usPerson: 'Export-control status', clearance: 'Security clearance',
  clearanceEligible: 'Clearance eligibility', visaStatus: 'Visa status', relocate: 'Willing to relocate',
  salary: 'Desired salary', startDate: 'Earliest start date', workMode: 'Work arrangement',
  gender: 'Gender', race: 'Race', hispanic: 'Hispanic / Latino', veteran: 'Veteran status', disability: 'Disability status',
} as const satisfies Partial<Record<ProfileKey, string>>;

export type RememberableProfileKey = keyof typeof REMEMBERABLE_PROFILE_FIELDS;
export type MappingScope = Platform | 'all' | `company:${string}` | `application:${string}` | `site:${string}`;
export interface MappingContext { platform: Platform; company: string; url: string }
export interface SavedField { label: string; kind: string; options: string[] }
export interface ReviewField { token: string; label: string; answered: boolean; suggestionId?: number }
export interface CapturedAnswer extends SavedField { token: string; captureId: string; value: string }
export type MappingTarget = { kind: 'answer'; value: string } | { kind: 'profile'; key: RememberableProfileKey };
export interface MappingDraft {
  question: string;
  aliases: string[];
  scope: MappingScope;
  target: MappingTarget;
  /** Meaning is explicitly approved when saving. Legacy records remain exact-only. */
  meaning?: QuestionMeaning;
  answerAliases?: string[];
}
export interface RememberedMapping extends MappingDraft {
  id: number;
  schemaVersion: 1 | 2;
  updatedAt: number;
  lastUsed?: number;
}

/** Only presentation differences are folded. Negations and all words remain significant. */
export function normalizeQuestion(question: string): string {
  return question.normalize('NFKC').trim().toLocaleLowerCase('en-US')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐‑–—]/g, '-')
    .replace(/\s*\*\s*$/, '').replace(/[?!.:]+$/, '').replace(/\s+/g, ' ').trim();
}

export function isRememberableProfileKey(key: unknown): key is RememberableProfileKey {
  return typeof key === 'string' && Object.hasOwn(REMEMBERABLE_PROFILE_FIELDS, key);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid remembered mapping.');
  return value as Record<string, unknown>;
}
function question(value: unknown): string {
  if (typeof value !== 'string' || !normalizeQuestion(value) || value.length > 700) {
    throw new Error('Enter a question of at most 700 characters.');
  }
  return value.trim();
}

export function parseMappingDraft(value: unknown): MappingDraft {
  const v = object(value);
  const q = question(v.question);
  if (typeof v.scope !== 'string' || !validScope(v.scope)) throw new Error('Choose where this answer applies and enter a company name or valid website/application URL.');
  if (!Array.isArray(v.aliases) || v.aliases.length > 20) throw new Error('Use at most 20 alternate wordings.');
  const seen = new Set([normalizeQuestion(q)]);
  const aliases = v.aliases.map(question).filter((alias) => {
    const key = normalizeQuestion(alias);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const t = object(v.target);
  let target: MappingTarget;
  if (t.kind === 'profile' && isRememberableProfileKey(t.key)) target = { kind: 'profile', key: t.key };
  else if (t.kind === 'answer' && typeof t.value === 'string' && t.value.trim() && t.value.length <= 10000) {
    target = { kind: 'answer', value: t.value.trim() };
  } else throw new Error('Enter a reusable answer or choose a supported profile field.');
  let meaning: QuestionMeaning | undefined;
  if (v.meaning !== undefined) {
    const m = object(v.meaning);
    const recognised = questionMeaning(q);
    if (!INTENTS.includes(m.intent as QuestionMeaning['intent']) || typeof m.qualifier !== 'string' ||
      typeof m.negative !== 'boolean' || !recognised || m.intent !== recognised.intent || m.qualifier !== recognised.qualifier || m.negative !== recognised.negative) {
      throw new Error('Question meaning changed. Review the question before saving.');
    }
    meaning = recognised;
    if (aliases.some(a => { const other = questionMeaning(a); return other && (!sameMeaning(meaning!, other) || meaning!.negative !== other.negative); })) {
      throw new Error('An added question asks something different or reverses the answer. Save it separately.');
    }
  }
  const answerAliases = v.answerAliases === undefined ? undefined : parseQuestionList(v.answerAliases);
  if (answerAliases && answerAliases.length > 20) throw new Error('Use at most 20 equivalent answers.');
  const scope = v.scope.startsWith('company:') ? `company:${companyKey(v.scope.slice(8))}` :
    v.scope.startsWith('site:') ? `site:${new URL(v.scope.slice(5)).origin}` :
    v.scope.startsWith('application:') ? `application:${applicationKey(v.scope.slice(12))}` : v.scope;
  return { question: q, aliases, scope: scope as MappingScope, target,
    ...(meaning ? { meaning } : {}), ...(answerAliases ? { answerAliases } : {}) };
}

/** Invalid/unsupported stored versions are ignored rather than used to fill a form. */
export function parseStoredMapping(value: unknown): RememberedMapping | null {
  try {
    const v = object(value);
    if ((v.schemaVersion !== 1 && v.schemaVersion !== 2) || !Number.isSafeInteger(v.id) || Number(v.id) < 1 ||
      typeof v.updatedAt !== 'number' || !Number.isFinite(v.updatedAt) || v.updatedAt < 0) return null;
    if (v.schemaVersion === 1 && (v.meaning !== undefined || v.answerAliases !== undefined)) return null;
    if (v.lastUsed !== undefined && (typeof v.lastUsed !== 'number' || !Number.isFinite(v.lastUsed) || v.lastUsed < 0)) return null;
    return { ...parseMappingDraft(v), id: v.id as number, schemaVersion: v.schemaVersion as 1 | 2, updatedAt: v.updatedAt,
      ...(typeof v.lastUsed === 'number' ? { lastUsed: v.lastUsed } : {}) };
  } catch { return null; }
}

export function mappingQuestions(mapping: MappingDraft): string[] {
  return [mapping.question, ...mapping.aliases].map(normalizeQuestion);
}

export function selectRememberedMappings(records: unknown[], platform: Platform, questions: string[]): RememberedMapping[] {
  const keys = new Set(questions.map(normalizeQuestion));
  return records.map(parseStoredMapping).filter((m): m is RememberedMapping => !!m &&
    (m.scope === 'all' || m.scope === platform) && mappingQuestions(m).some((q) => keys.has(q)));
}

/** Platform-specific entries win over global entries; conflicting entries at the same scope are skipped. */
export function resolveRememberedMapping(records: unknown[], platform: Platform, question: string): RememberedMapping | null {
  const matches = selectRememberedMappings(records, platform, [question]);
  const specific = matches.filter((m) => m.scope === platform);
  const candidates = specific.length ? specific : matches;
  return candidates.length === 1 ? candidates[0]! : null;
}

export function assertNoMappingConflict(draft: MappingDraft, records: RememberedMapping[], id?: number): void {
  const keys = new Set(mappingQuestions(draft));
  if (records.some((m) => m.id !== id && m.scope === draft.scope && (mappingQuestions(m).some((q) => keys.has(q)) ||
    (draft.meaning && m.meaning && sameMeaning(draft.meaning, m.meaning))))) {
    throw new Error('This wording already belongs to an answer in this scope. Edit that answer in Settings → Saved answers.');
  }
}

function validScope(scope: string): boolean {
  if (['all', 'greenhouse', 'lever', 'ashby', 'workday', 'other'].includes(scope)) return true;
  if (/^company:.{1,200}$/.test(scope)) return !!normalizeQuestion(scope.slice(8));
  if (/^(site|application):/.test(scope)) {
    try { const u = new URL(scope.slice(scope.indexOf(':') + 1)); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && scope.length <= 2000; } catch { return false; }
  }
  return false;
}
export const companyKey = (company: string) => normalizeQuestion(company);
export function applicationKey(url: string): string { const u = new URL(url); u.hash = ''; return u.href; }
export function scopeRank(scope: MappingScope, context: MappingContext): number {
  if (scope === `application:${applicationKey(context.url)}`) return 4;
  if (context.company && scope === `company:${companyKey(context.company)}`) return 3;
  if (scope === `site:${new URL(context.url).origin}`) return 2;
  if (scope === context.platform) return 1;
  return scope === 'all' ? 0 : -1;
}
export function scopeLabel(scope: MappingScope): string {
  if (scope === 'all') return 'All applications';
  if (scope.startsWith('company:')) return `Company: ${scope.slice(8)}`;
  if (scope.startsWith('application:')) return 'This application only';
  if (scope.startsWith('site:')) return `Site: ${scope.slice(5)}`;
  return `Legacy scope: ${scope}`;
}

export interface SavedMatch { mapping: RememberedMapping | null; suggestionId?: number; reason: string }
/** Rebuilt from persisted records per batch, so worker restarts cannot lose the knowledge base. */
export class SavedAnswerIndex {
  private exact = new Map<string, RememberedMapping[]>();
  private intents = new Map<string, RememberedMapping[]>();
  private records: RememberedMapping[];
  private suggestionData = new Map<number, { words: Set<string>[]; meaning: QuestionMeaning | null; negative: boolean }>();
  constructor(records: RememberedMapping[], private context: MappingContext) {
    this.records = records.filter(m => scopeRank(m.scope, context) >= 0);
    for (const m of this.records) {
      this.suggestionData.set(m.id, { words: [m.question, ...m.aliases].map(wordingTokens), meaning: m.meaning ?? questionMeaning(m.question), negative: /\b(not|never|without|unable|no)\b/i.test(m.question) });
      for (const q of mappingQuestions(m)) this.exact.set(q, [...(this.exact.get(q) ?? []), m]);
      if (m.meaning) {
        const keys = [`${m.meaning.intent}:${m.meaning.qualifier}`];
        // A specifically saved US-citizen category is a positive US-citizenship fact.
        if (m.meaning.intent === 'citizen' && m.meaning.qualifier === 'status' && m.target.kind === 'answer' && /^(u\.?s\.?|united states) citizen$/i.test(m.target.value.trim())) keys.push('citizen:us');
        for (const key of keys) this.intents.set(key, [...(this.intents.get(key) ?? []), m]);
      }
    }
  }
  match(field: SavedField): SavedMatch {
    const meaning = questionMeaning(field.label);
    const exact = this.exact.get(normalizeQuestion(field.label)) ?? [];
    let semantic = meaning ? this.intents.get(`${meaning.intent}:${meaning.qualifier}`) ?? [] : [];
    if (meaning?.intent === 'citizen' && meaning.qualifier === 'status' && field.options.some(o => /^(u\.?s\.?|united states) citizen$/i.test(o.trim()))) {
      semantic = [...semantic, ...(this.intents.get('citizen:us') ?? []).filter(m => m.target.kind === 'profile' ? m.target.key === 'usCitizen' : booleanAnswer(m.target.value) === true)];
    }
    const candidates = [...new Map([...exact, ...semantic].map(m => [m.id, m])).values()];
    const rank = Math.max(-1, ...candidates.map(m => scopeRank(m.scope, this.context)));
    const winners = candidates.filter(m => scopeRank(m.scope, this.context) === rank);
    if (winners.length > 1) return { mapping: null, reason: 'Conflicting saved answers in this scope.' };
    if (winners[0]) return { mapping: winners[0], reason: exact.includes(winners[0]) ? 'Approved wording' : 'Approved question meaning' };
    const words = wordingTokens(field.label);
    const negative = /\b(not|never|without|unable|no)\b/i.test(field.label);
    const scored = this.records.filter(m => {
      // Similarity must not cross known meaning, qualifier or negation boundaries.
      const { meaning: known, negative: savedNegative } = this.suggestionData.get(m.id)!;
      return !(known && meaning && !sameMeaning(known, meaning)) &&
        negative === savedNegative;
    }).map(m => ({ m, score: Math.max(...this.suggestionData.get(m.id)!.words.map(w => tokenSimilarity(w, words))) }))
      .filter(s => s.score >= 0.45).sort((a, b) => b.score - a.score);
    if (scored[0] && (!scored[1] || scored[0].score - scored[1].score >= 0.15)) return { mapping: null, suggestionId: scored[0].m.id, reason: 'Similar wording — confirm before reuse' };
    return { mapping: null, reason: 'No approved answer' };
  }
}

export function parseSavedFields(value: unknown): SavedField[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('Invalid fields.');
  return value.map(raw => {
    const v = object(raw);
    if (!['text', 'textarea', 'select', 'combobox', 'radio', 'yesno', 'listbox', 'prompt'].includes(String(v.kind)) ||
      !Array.isArray(v.options) || v.options.length > 200 || v.options.some(o => typeof o !== 'string' || o.length > 1000)) throw new Error('Unsupported field.');
    return { label: question(v.label), kind: v.kind as string, options: v.options as string[] };
  });
}
export function parseReviewFields(value: unknown): ReviewField[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('Invalid review fields.');
  return value.map(raw => {
    const v = object(raw);
    if (typeof v.token !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(v.token) || typeof v.answered !== 'boolean' ||
      (v.suggestionId !== undefined && (!Number.isSafeInteger(v.suggestionId) || Number(v.suggestionId) < 1))) throw new Error('Invalid field identity.');
    return { token: v.token, label: question(v.label), answered: v.answered, ...(v.suggestionId ? { suggestionId: Number(v.suggestionId) } : {}) };
  });
}

export function parseQuestionList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('Invalid question list.');
  return value.map(question);
}
