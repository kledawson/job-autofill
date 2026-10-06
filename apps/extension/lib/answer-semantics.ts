import { bachelorDegreeAliases, standardDegree } from './degree';

/** Closed local vocabulary. Unrecognised wording is a suggestion, never an inferred fact. */
export const INTENTS = ['degree', 'citizen', 'authorization', 'sponsorship', 'clearanceHeld', 'clearanceEligible', 'source', 'gender', 'race', 'hispanic', 'veteran', 'gpa', 'employmentHistory', 'relocation'] as const;
export type Intent = typeof INTENTS[number];
export interface QuestionMeaning { intent: Intent; qualifier: string; negative: boolean }
const text = (s: string) => s.normalize('NFKC').toLowerCase().replace(/u\.?s\.?\b/g, 'us').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function questionMeaning(label: string): QuestionMeaning | null {
  const s = text(label);
  // Compound, conditional, third-party and unfamiliar negative questions require explicit aliases.
  if (/\b(if|unless|except|referrer|reference|referee|spouse|parent|partner|child|childs|children|dependent|mother|father|guardian|manager|supervisor|coworker|previously|formerly|ever|previous|past|prior)\b/.test(s)) return null;
  const negative = /\b(not|never|no|without|unable)\b/.test(s);
  let intent: Intent | undefined;
  if (/\b(clearance eligibility|eligible.*clearance|eligibility.*clearance)\b/.test(s)) intent = 'clearanceEligible';
  else if (/\b(clearance)\b/.test(s) && /\b(active|held|hold|current)\b/.test(s) && !/citizen/.test(s)) intent = 'clearanceHeld';
  else if (/\b(us citizen|citizen.*united states|citizenship status)\b/.test(s) || s === 'citizenship') intent = 'citizen';
  else if (/\b(authorized|authorised|authorization|eligible)\b/.test(s) && /\bwork\b/.test(s)) intent = 'authorization';
  else if (/\b(sponsorship|sponsor)\b/.test(s)) intent = 'sponsorship';
  else if (/\b(degree|qualification held|educational qualification)\b/.test(s) && !/\b(require|requires|requirement|pursuing|pursue|enrolled|enroll|expected)\b/.test(s) && !/^(do|did|have|are|can)\b/.test(s)) intent = 'degree';
  else if (/\b(gpa|grade point average)\b/.test(s)) intent = 'gpa';
  else if (/\b(hispanic|latino)\b/.test(s)) intent = 'hispanic';
  else if (/\b(gender)\b/.test(s)) intent = 'gender';
  else if (/\b(race|ethnicity|ethnic background)\b/.test(s)) intent = 'race';
  else if (/\b(veteran)\b/.test(s)) intent = 'veteran';
  else if (/\b(hear|learn|find|discover|discovery)\b/.test(s) && /\b(job|opening|opportunity|channel|position)\b/.test(s)) intent = 'source';
  else if (/\b(relocat|relocate|relocation)\b/.test(s)) intent = 'relocation';
  else if (/\b(employment history|previously employed|ever worked)\b/.test(s)) intent = 'employmentHistory';
  if (!intent) return null;
  // Recognise only a simple explicit inverse of a boolean question.
  if (negative && !((intent === 'citizen' || intent === 'authorization' || intent === 'sponsorship') && /\bnot\b/.test(s) && !/\b(never|without|unable)\b/.test(s))) return null;
  const countries = s.match(/\b(us|united states|canada|uk|united kingdom|australia|india)\b/g) ?? [];
  const country = countries.map(c => c === 'united states' ? 'us' : c === 'united kingdom' ? 'uk' : c);
  if (new Set(country).size > 1) return null;
  const geography = intent === 'citizen' ? (s.includes('citizenship') ? 'status' : 'us') : country[0] ?? 'unspecified';
  const level = /\b(doctorate|doctoral|phd)\b/.test(s) ? 'doctoral' : /\b(undergraduate|bachelor)\b/.test(s) ? 'undergraduate' : /\b(graduate|master)\b/.test(s) ? 'graduate' : 'unspecified';
  const time = /\bfuture\b/.test(s) && /\b(now|current|present)\b/.test(s) ? 'now-and-future' : /\bfuture\b/.test(s) ? 'future' : /\b(now|currently|present)\b/.test(s) ? 'now' : 'unspecified';
  const employer = /\b(any|every) employer\b/.test(s) ? 'any-employer' : 'unspecified';
  // Never reuse company history across unnamed companies or citizenship across country/status ambiguity.
  if (intent === 'employmentHistory') return null;
  const qualifier = intent === 'citizen' ? geography : intent === 'authorization' ? `${geography}:${employer}` : intent === 'sponsorship' ? `${geography}:${time}` : intent === 'degree' ? `${level}:${/\bhighest\b/.test(s) ? 'highest' : 'unspecified'}` : intent === 'gpa' ? level : intent === 'relocation' ? s : intent === 'clearanceHeld' ? (/\b(active|current|hold)\b/.test(s) ? 'current' : 'history') : intent === 'veteran' ? (/\bprotected\b/.test(s) ? 'protected' : 'general') : '';
  return { intent, qualifier, negative };
}

export function sameMeaning(a: QuestionMeaning, b: QuestionMeaning): boolean {
  return a.intent === b.intent && a.qualifier === b.qualifier;
}
export function booleanAnswer(answer: string): boolean | null {
  const s = text(answer);
  if (/^yes\b/.test(s)) return true;
  if (/^no\b/.test(s)) return false;
  if (/^(us citizen|united states citizen|i am (currently )?a us citizen)$/.test(s)) return true;
  if (/^(i am authorized to work in the united states for any employer)$/.test(s)) return true;
  return null;
}

function degree(answer: string) {
  const raw = answer.toLowerCase().replace(/[.'’]/g, '').replace(/\s+/g, ' ').trim();
  let specific = bachelorDegreeAliases(answer)[0] ?? '';
  if (!specific) {
    if (/^(ms|msc|master of science)\b/.test(raw)) specific = 'Master of Science';
    else if (/^(ma|master of arts)\b/.test(raw)) specific = 'Master of Arts';
    else if (/^(meng|m eng|master of engineering)\b/.test(raw)) specific = 'Master of Engineering';
    else if (/\b(mba|master of business administration)\b/.test(raw)) specific = 'MBA';
    else if (/\b(phd|ph d|doctor of philosophy)\b/.test(raw)) specific = 'PhD';
    else if (/\b(md|m d|doctor of medicine)\b/.test(raw)) specific = 'MD';
    else if (/\b(jd|j d|juris doctor)\b/.test(raw)) specific = 'JD';
    else if (/\b(of|in)\s+\w/.test(raw)) specific = `named:${raw}`;
  }
  return { level: standardDegree(answer), specific };
}
function category(answer: string, intent: Intent): string {
  const s = text(answer);
  if (intent === 'source') {
    if (/^(company |employer |corporate )?(web ?site|careers (page|site)|career (page|site))$/.test(s)) return 'company-website';
    if (s === 'linkedin' || s === 'linked in') return 'linkedin';
  }
  if (intent === 'clearanceHeld' && /^(no (active |security )?clearance|none)$/.test(s)) return 'no-clearance';
  if (intent === 'veteran' && /^(i am not a protected veteran|not a protected veteran)$/.test(s)) return 'not-protected-veteran';
  if (intent === 'veteran' && /^(not a veteran|non veteran)$/.test(s)) return 'not-veteran';
  return s;
}

/** Scores equivalents, not merely similar strings. Ambiguous options are always rejected. */
export function answerOption(answer: string, options: string[], saved: QuestionMeaning | undefined, current: QuestionMeaning | null, aliases: string[] = []): number {
  const inverse = saved && current && sameMeaning(saved, current) && saved.negative !== current.negative;
  const exact = inverse ? [] : options.map((o, i) => text(o) === text(answer) || aliases.some(a => text(a) === text(o)) ? i : -1).filter(i => i >= 0);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return -1;
  const citizenCategory = saved?.intent === 'citizen' && current?.intent === 'citizen' &&
    booleanAnswer(answer) === true && ((saved.qualifier === 'status' && current.qualifier === 'us') ||
      (saved.qualifier === 'us' && current.qualifier === 'status' && options.some(o => /^(us citizen|united states citizen)$/.test(text(o)))));
  if (!saved || !current || (!sameMeaning(saved, current) && !citizenCategory)) return -1;
  let candidates: number[] = [];
  const bool = booleanAnswer(answer);
  if (bool !== null && ['citizen', 'authorization', 'sponsorship', 'clearanceEligible', 'hispanic', 'relocation'].includes(saved.intent)) {
    const desired = saved.negative !== current.negative ? !bool : bool;
    candidates = options.map((o, i) => booleanAnswer(o) === desired ? i : -1).filter(i => i >= 0);
  } else if (saved.intent === 'degree') {
    const d = degree(answer);
    if (!d.level) return -1;
    const scored = options.map((o, i) => {
      const candidate = degree(o);
      if (candidate.level !== d.level || (!d.specific && candidate.specific)) return { i, score: 0 };
      if (candidate.specific && candidate.specific !== d.specific) return { i, score: 0 };
      return { i, score: candidate.specific ? 2 : 1 };
    });
    const max = Math.max(...scored.map(s => s.score));
    candidates = scored.filter(s => max > 0 && s.score === max).map(s => s.i);
  } else {
    candidates = options.map((o, i) => {
      const wanted = category(answer, saved.intent), offered = category(o, saved.intent);
      // A stronger authored fact can render more broadly; the reverse would invent history.
      const broader = (saved.intent === 'clearanceHeld' && text(answer) === 'never held a clearance' && offered === 'no-clearance') ||
        (saved.intent === 'veteran' && wanted === 'not-veteran' && offered === 'not-protected-veteran');
      return offered === wanted || broader ? i : -1;
    }).filter(i => i >= 0);
  }
  return candidates.length === 1 ? candidates[0]! : -1;
}

/** Local similarity is only a review hint. It cannot approve a new wording. */
export function wordingSimilarity(a: string, b: string): number {
  return tokenSimilarity(wordingTokens(a), wordingTokens(b));
}
const STOP_WORDS = new Set(['a', 'an', 'the', 'are', 'is', 'do', 'you', 'your', 'please', 'what', 'which', 'this', 'how']);
export function wordingTokens(s: string): Set<string> { return new Set(text(s).split(' ').filter(w => !STOP_WORDS.has(w))); }
export function tokenSimilarity(x: Set<string>, y: Set<string>): number {
  if (!x.size || !y.size) return 0;
  const intersection = [...x].filter(w => y.has(w)).length;
  return intersection / (x.size + y.size - intersection);
}
