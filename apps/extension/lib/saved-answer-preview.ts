import type { Profile } from './types';
import { answerOption, booleanAnswer, questionMeaning, type QuestionMeaning } from './answer-semantics';
import { assertNoMappingConflict, normalizeQuestion, parseMappingDraft, SavedAnswerIndex, scopeRank,
  type MappingContext, type MappingDraft, type MappingScope, type RememberedMapping } from './remembered-mappings';
import { bestDegreeOption, bestOption, bestRememberedOption, isPlaceholderOption } from './autofill/match';
import { valueFor } from './autofill/values';
import { platformFor } from './platforms';

/** Shared by the actual writer and local preview. Profile facts are positive, literal responses are not. */
export function rememberedChoice(mapping: MappingDraft, candidates: string[], label: string) {
  const values = [...candidates];
  const answer = values[0];
  if (!answer) return { values, pick: undefined };
  const aliases = mapping.target.kind === 'answer' ? mapping.answerAliases : undefined;
  if (mapping.meaning) {
    const current = questionMeaning(label);
    const reference = mapping.target.kind === 'answer' ? mapping.meaning : { ...mapping.meaning, negative: false };
    const bool = booleanAnswer(answer);
    if (bool !== null && current && reference.negative !== current.negative) values[0] = bool ? 'No' : 'Yes';
    return { values, pick: (options: string[]) => answerOption(answer, options, reference, current, aliases) };
  }
  if (aliases?.length) return { values, pick: (options: string[]) => answerOption(answer, options, undefined, null, aliases) };
  return { values, pick: undefined };
}

const COUNTRIES: Record<string, string> = { us: 'the US', canada: 'Canada', uk: 'the UK', australia: 'Australia', india: 'India' };
const LEVELS: Record<string, string> = { undergraduate: 'undergraduate', graduate: 'graduate', doctoral: 'doctoral' };
export function meaningDescription(m: QuestionMeaning): string {
  const [place, condition] = m.qualifier.split(':');
  const country = COUNTRIES[place ?? ''];
  switch (m.intent) {
    case 'citizen': return m.qualifier === 'status' ? 'citizenship status' : 'US citizenship';
    case 'authorization': return `permission to work${country ? ` in ${country}` : ''}${condition === 'any-employer' ? ' for any employer' : ''}`;
    case 'sponsorship': return `${country ? `${country} visa` : 'visa'} sponsorship${condition === 'now-and-future' ? ' now or in the future' : condition === 'now' ? ' now' : condition === 'future' ? ' in the future' : ''}`;
    case 'degree': return `${condition === 'highest' ? 'your highest' : 'your'}${LEVELS[place ?? ''] ? ` ${LEVELS[place!]}` : ''} degree`;
    case 'gpa': return `your${LEVELS[m.qualifier] ? ` ${LEVELS[m.qualifier]}` : ''} GPA`;
    case 'clearanceHeld': return m.qualifier === 'current' ? 'your current security clearance' : 'your security clearance history';
    case 'clearanceEligible': return 'eligibility to obtain a security clearance';
    case 'source': return 'how you found a job';
    case 'gender': return 'gender';
    case 'race': return 'race or ethnicity';
    case 'hispanic': return 'Hispanic or Latino identity';
    case 'veteran': return m.qualifier === 'protected' ? 'protected veteran status' : 'veteran status';
    case 'relocation': return 'relocation with the same conditions';
    case 'employmentHistory': return 'employment history';
  }
}

export function scopeDescription(scope: MappingScope): string {
  if (scope === 'all') return 'Reuse this answer across companies and application websites.';
  if (scope.startsWith('company:')) return scope.slice(8).trim() ? `Reuse this answer only for ${scope.slice(8)} applications.` : 'Enter the company where this answer applies.';
  if (scope.startsWith('application:')) return 'Reuse this answer only for this exact application URL.';
  if (scope.startsWith('site:')) return 'Reuse on this website. A shared job website can include several companies.';
  return `Reuse on ${scope} forms. This is an older website-based setting.`;
}

/** An explicit sample, never inferred to be a real application. */
export function previewContextFor(scope: MappingScope, current?: MappingContext): MappingContext {
  if (current) return current;
  const url = scope.startsWith('application:') ? scope.slice(12) : scope.startsWith('site:') ? scope.slice(5) : 'https://example.com/application';
  return { company: scope.startsWith('company:') ? scope.slice(8) : 'Example company', url, platform: platformFor(url) };
}

export interface AnswerPreview { outcome: 'fill' | 'confirm' | 'skip'; reason: string; answer?: string }
/** Uses the production index and option rules; does not save, read a page or contact AI. */
export function previewSavedAnswer(raw: MappingDraft, label: string, options: string[] | null, context: MappingContext,
  profile: Profile | undefined, records: RememberedMapping[], editingId?: number): AnswerPreview {
  try {
    const url = new URL(context.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an application URL starting with https:// or http://.');
    if (!label.trim() || label.length > 700) throw new Error('Enter a question to try (up to 700 characters).');
    if (options && (!options.length || options.length > 200 || options.some(o => !o.trim() || o.length > 1000))) throw new Error('Add the dropdown choices, or turn off the dropdown example.');
    const draft = parseMappingDraft(raw);
    // Saving an existing primary question updates that record, as in the database transaction.
    const existingId = editingId ?? records.find(m => normalizeQuestion(m.question) === normalizeQuestion(draft.question) && m.scope === draft.scope)?.id;
    assertNoMappingConflict(draft, records, existingId);
    const record: RememberedMapping = { ...draft, schemaVersion: 2, id: existingId ?? Math.max(0, ...records.map(m => m.id)) + 1, updatedAt: 0 };
    if (scopeRank(record.scope, context) < 0) return { outcome: 'skip', reason: 'This example is outside where you chose to reuse the answer.' };
    const match = new SavedAnswerIndex([...records.filter(m => m.id !== record.id), record], context)
      .match({ label, kind: options ? 'select' : 'text', options: options ?? [] });
    if (match.suggestionId === record.id) return { outcome: 'confirm', reason: 'The question is similar, but this wording has not been approved. Confirm it on the application or add it as another wording.' };
    if (!match.mapping) return { outcome: 'skip', reason: match.reason.startsWith('Conflicting') ? 'More than one saved answer matches. Edit the conflicting answers before reusing this one.' : 'This question does not match the original question, approved variations, or a recognized equivalent meaning.' };
    if (match.mapping.id !== record.id) return { outcome: 'skip', reason: 'Another saved answer has priority for this example. Check your other saved answers and where they apply.' };
    if (draft.target.kind === 'profile' && !profile) return { outcome: 'skip', reason: 'Your profile is still loading. Try again in a moment.' };
    const candidates = draft.target.kind === 'answer' ? [draft.target.value] : valueFor(draft.target.key, profile!, { label, options: options ?? [], company: context.company });
    if (!candidates?.[0]) return { outcome: 'skip', reason: 'This profile detail has no reusable value. Add it in Settings → Profile.' };
    const choice = rememberedChoice(draft, candidates, label);
    if (options) {
      const offered = options.filter(o => !isPlaceholderOption(o));
      const pick = choice.pick ? choice.pick(offered) : draft.target.kind === 'answer' ? bestRememberedOption(choice.values, offered) : draft.target.key === 'degree' ? bestDegreeOption(choice.values, offered) : bestOption(choice.values, offered, { strict: ['school', 'major'].includes(draft.target.key) });
      if (pick < 0) return { outcome: 'skip', reason: 'There is no single matching dropdown choice. Add a label only if it means the same answer, or choose on the application.' };
      return { outcome: 'fill', answer: offered[pick], reason: match.reason === 'Approved wording' ? 'The question uses approved wording, and one dropdown choice matches.' : 'The question has a recognized equivalent meaning, and one dropdown choice matches.' };
    }
    return { outcome: 'fill', answer: choice.values[0], reason: match.reason === 'Approved wording' ? 'The question uses approved wording.' : 'The question has a recognized equivalent meaning.' };
  } catch (err) { return { outcome: 'skip', reason: err instanceof Error ? err.message : 'Check the answer and example before trying again.' }; }
}
