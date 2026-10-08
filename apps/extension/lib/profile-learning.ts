import { booleanAnswer, questionMeaning } from './answer-semantics';
import { educationFactIndex, parseExactGpa } from './education-facts';
import { CLEARANCE_LEVELS, WORK_STATUSES, type Profile } from './types';
import { SavedAnswerIndex, type CapturedAnswer, type MappingContext, type RememberedMapping, type RememberableProfileKey } from './remembered-mappings';

const DIRECT = {
  firstName: ['first name', 'given name'], lastName: ['last name', 'surname', 'family name'],
  preferredName: ['preferred name'], pronouns: ['pronouns'], email: ['email', 'email address'],
  phone: ['phone', 'phone number', 'telephone number'], address: ['street address', 'address line 1'],
  city: ['city'], state: ['state', 'state province'], zip: ['zip', 'zip code', 'postal code'], country: ['country'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile'], github: ['github', 'github url'],
  portfolio: ['portfolio', 'portfolio url'], website: ['personal website', 'website url'],
} as const;
type DirectKey = keyof typeof DIRECT;
export type LearnedProfileKey = DirectKey | 'school' | 'degree' | 'major' | 'gpa' | 'authorizedUS' | 'needsSponsorship' | 'status' | 'clearance';
export interface ProfileUpdate {
  key: LearnedProfileKey; index?: number; label: string; value: string; previous: string;
  /** Protects a repeatable record against reordering/replacement while confirmation is open. */
  entrySignature?: string;
  /** Only the winning fixed Memory is relinked after explicit confirmation. */
  memoryLink?: { id: number; signature: string; key: RememberableProfileKey };
}
export interface ProfileConfirmation { value: string; expected: ProfileUpdate; replace: boolean }
const clean = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();


/** Conservative, local reverse mapping. No fuzzy matching, AI classification or arbitrary profile paths. */
export function proposeProfileUpdate(capture: CapturedAnswer, profile: Profile, answer = capture.value): ProfileUpdate | null {
  const s = clean(capture.label), meaning = questionMeaning(capture.label);
  if (capture.selectionMode === 'multiple') {
    if (capture.values?.length !== 1 || meaning?.intent !== 'clearanceHeld') return null;
    answer = capture.values[0]!;
  }
  if (!answer.trim() || answer.length > 10000) return null;
  let key: LearnedProfileKey | undefined, value = answer.trim(), index: number | undefined;
  if (capture.selectionMode !== 'multiple') {
    key = (Object.keys(DIRECT) as DirectKey[]).find(k => (DIRECT[k] as readonly string[]).includes(s));
    if (key === 'country' && (capture.kind === 'combobox' || /\+\d/.test(value) || /^\d+$/.test(value) || capture.options.some(option => /\+\d/.test(option)))) return null; // Phone-country widgets are ambiguous.
    if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
    if (key && ['linkedin', 'github', 'portfolio', 'website'].includes(key) && !/^https?:\/\/[^\s]+$/i.test(value)) return null;
    if (!key && /^(school|university|college|school university|school name)$/.test(s)) key = 'school';
    if (!key && /^(major|discipline|field of study|academic discipline)$/.test(s)) key = 'major';
    if (!key && meaning?.intent === 'degree' && !/highest/.test(meaning.qualifier)) key = 'degree';
    if (!key && meaning?.intent === 'gpa' && /^(?:(?:undergraduate|graduate|doctoral|doctorate|bachelor|master)s? )?(gpa|grade point average)(?: (undergraduate|graduate|doctoral|doctorate))?$/.test(s)) {
      key = 'gpa';
      // A range, unknown scale or missing exact score must remain a memory.
      const score = parseExactGpa(value);
      if (score === null) return null;
      value = score;
    }
  }
  if (!key && meaning && !meaning.negative) {
    const bool = booleanAnswer(value);
    if (meaning.intent === 'authorization' && meaning.qualifier === 'us:unspecified' && /^(yes|no)$/i.test(value)) { key = 'authorizedUS'; value = bool ? 'yes' : 'no'; }
    if (meaning.intent === 'sponsorship' && /^(us|unspecified):(unspecified|now-and-future)$/.test(meaning.qualifier) && /^(yes|no)$/i.test(value)) { key = 'needsSponsorship'; value = bool ? 'yes' : 'no'; }
    if (meaning.intent === 'citizen' && meaning.qualifier === 'status' && WORK_STATUSES.includes(value)) key = 'status';
    if (meaning.intent === 'citizen' && meaning.qualifier === 'us' && bool === true && /^(are you|can you confirm|us citizen)/.test(s)) { key = 'status'; value = 'US Citizen'; }
    if (meaning.intent === 'clearanceHeld') {
      const aliases: Record<string, string> = { 'never held a clearance': 'None / never held', 'none never held': 'None / never held' };
      value = aliases[clean(value)] ?? value;
      if (meaning.qualifier === 'current' && CLEARANCE_LEVELS.includes(value)) key = 'clearance';
    }
  }
  if (!key) return null;
  if (['school', 'degree', 'major', 'gpa'].includes(key)) {
    const selected = educationFactIndex(profile, capture.label, capture.section?.kind === 'education' ? capture.section.index : undefined);
    if (selected === null) return null;
    index = selected;
    const entry = profile.education[index]!;
    return { key, index, value, previous: entry[key as 'school' | 'degree' | 'major' | 'gpa'], entrySignature: JSON.stringify(entry), label: 'Profile → Education → ' + (entry.school || 'Entry ' + (index! + 1)) + ' → ' + ({ school: 'School', degree: 'Degree', major: 'Major / discipline', gpa: 'GPA' } as Record<string, string>)[key] };
  }
  const previous = ['authorizedUS', 'needsSponsorship', 'status', 'clearance'].includes(key) ? profile.workAuth[key as 'authorizedUS' | 'needsSponsorship' | 'status' | 'clearance'] : profile[key as DirectKey];
  return { key, value, previous, label: 'Profile → ' + (DIRECT[key as DirectKey]?.[0] ?? ({ authorizedUS: 'Authorized to work in the US', needsSponsorship: 'Needs sponsorship', status: 'Current status', clearance: 'Security clearance' } as Record<string, string>)[key]) };
}

export function applyProfileConfirmation(profile: Profile, capture: CapturedAnswer, confirmation: ProfileConfirmation, records: RememberedMapping[] = [], context?: MappingContext): Profile {
  if (!confirmation || typeof confirmation.value !== 'string' || typeof confirmation.replace !== 'boolean') throw new Error('Invalid profile update.');
  const proposed = proposeConfirmedProfileUpdate(capture, profile, records, context);
  if (!proposed || confirmation.value !== proposed.value || JSON.stringify(proposed) !== JSON.stringify(confirmation.expected)) throw new Error('Your profile changed, a matching Memory changed, or this answer does not identify a profile field. Capture it again.');
  if (proposed.previous && proposed.previous !== proposed.value && !confirmation.replace) throw new Error('Confirm replacing the existing profile value.');
  return applyValidatedProfileUpdate(profile, proposed);
}
/** Only called after all confirmations have been checked against the original transaction snapshot. */
export function applyValidatedProfileUpdate(profile: Profile, proposed: ProfileUpdate): Profile {
  const next = structuredClone(profile);
  if (proposed.index !== undefined) (next.education[proposed.index]! as unknown as Record<string, string>)[proposed.key] = proposed.value;
  else if (['authorizedUS', 'needsSponsorship', 'status', 'clearance'].includes(proposed.key)) (next.workAuth as unknown as Record<string, string>)[proposed.key] = proposed.value;
  else (next as unknown as Record<string, unknown>)[proposed.key] = proposed.value;
  return next;
}

/** Reuse only an approved matching rule; never migrate unrelated memories or infer facts from them. */
export function proposeConfirmedProfileUpdate(capture: CapturedAnswer, profile: Profile, records: RememberedMapping[], context?: MappingContext, answer = capture.value): ProfileUpdate | null {
  const update = proposeProfileUpdate(capture, profile, answer);
  if (!update || !context) return update;
  const existing = new SavedAnswerIndex(records, context).match(capture).mapping;
  if (!existing || existing.target.kind !== 'answer') return update;
  const key: RememberableProfileKey = update.key === 'authorizedUS' ? 'authorized' :
    update.key === 'needsSponsorship' ? 'sponsorship' :
    update.key === 'status' ? (questionMeaning(capture.label)?.qualifier === 'us' ? 'usCitizen' : 'citizenshipStatus') : update.key;
  const { lastUsed: _usage, ...content } = existing;
  return { ...update, memoryLink: { id: existing.id, signature: JSON.stringify(content), key } };
}
