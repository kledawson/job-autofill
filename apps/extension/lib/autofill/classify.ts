import type { ScannedField } from './scan';

export type ProfileKey =
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'preferredName'
  | 'pronouns'
  | 'email'
  | 'phone'
  | 'phoneCountryCode'
  | 'textConsent'
  | 'acknowledge'
  | 'age'
  | 'ageRange'
  | 'ageAtLeast'
  | 'address'
  | 'city'
  | 'state'
  | 'zip'
  | 'country'
  | 'location'
  | 'cityStateZip'
  | 'cityState'
  | 'linkedin'
  | 'github'
  | 'portfolio'
  | 'website'
  | 'currentCompany'
  | 'currentTitle'
  | 'school'
  | 'degree'
  | 'major'
  | 'gpa'
  | 'eduStartMonth'
  | 'eduStartYear'
  | 'eduEndMonth'
  | 'eduEndYear'
  | 'gradDate'
  | 'authorized'
  | 'sponsorship'
  | 'visaStatus'
  | 'inUS'
  | 'livesIn'
  | 'authorizedNoSponsor'
  | 'relocate'
  | 'salary'
  | 'startDate'
  | 'noticePeriod'
  | 'workMode'
  | 'gender'
  | 'race'
  | 'hispanic'
  | 'veteran'
  | 'disability'
  | 'declineOnly'
  | 'resume'
  | 'coverLetter'
  | 'transcript';

export type Classification =
  | { kind: 'profile'; key: ProfileKey; source: 'adapter' | 'rule' }
  | { kind: 'free_response' }
  /** Terms, privacy, and certification checkboxes: always left to the user. */
  | { kind: 'consent' }
  /** Anti-bot puzzles and "prove you're human" prompts: always left to the user. */
  | { kind: 'challenge' }
  | { kind: 'unknown' };

type Rule = [ProfileKey, RegExp];

/** A phone field that wants the dialing code typed into the number itself. */
export const WITH_CODE_RE = /(includ\w*|with|plus|add)\s+(the\s+|your\s+)?(country|international|dial\w*)\s*code|international (format|number)|e\.?164|country code (and|&|\+) (phone )?number|code and (phone )?number/;

// Order matters: specific phrases come before the generic ones they contain.
const RULES: Rule[] = [
  // One question that covers both: authorized to work without needing sponsorship.
  ['authorizedNoSponsor', /^(?=.*(authori[sz]ed|eligible|legally|permitted|right) .*work)(?=.*(without|not (be )?requir|no (need|requirement)|not need).*sponsor)/],
  // "What is your current visa status?" asks for a status, not whether you need sponsorship.
  ['visaStatus', /^(what (is|are) )?(your )?(current )?(visa|immigration|work authori[sz]ation) status\??$/],
  ['sponsorship', /sponsor|visa (status|support)|require.*visa/],
  ['authorized', /authori[sz]ed to work|legally (able|authori[sz]ed|eligible|permitted)|work authori[sz]ation|eligib(le|ility) to work|right to work|permitted to work/],
  ['hispanic', /hispanic|latin[oax]/],
  ['race', /\brace\b|ethnicit/],
  ['declineOnly', /sexual orientation|lgbt|transgender|gender identity.*(trans|same)/],
  ['gender', /gender|\bsex\b/],
  ['veteran', /veteran|military (service|status)|protected veteran/],
  ['disability', /disabilit/],
  ['pronouns', /\bpronouns?\b/],
  ['preferredName', /preferred (first )?name|nickname|what would you like us to call you|name you go by/],
  ['fullName', /first (and|&) last name|first and surname/],
  ['firstName', /first name|given name|forename/],
  ['lastName', /last name|surname|family name/],
  ['fullName', /^((your|full|legal|candidate|applicant)\s+)*name$|full (legal )?name|legal name/],
  ['email', /e-?mail/],
  ['phone', WITH_CODE_RE],
  ['phoneCountryCode', /country code|calling code|dial(l?ing)? code|phone code|(phone|mobile) country|^(country|dial|calling) ?code$|^code$/],
  ['phone', /phone|mobile|cell\b/],
  // "Are you over 18 years of age?" / "at least 21" / "18 or older": answered by comparing your age to the number asked.
  ['ageAtLeast', /^(?=.*\b(1[4-9]|[2-6][0-9])\b)(?=.*\b(age|years old|older)\b)(?=.*\b(over|at least|older|above|minimum)\b)/],
  ['ageRange', /\bage (range|group|bracket)|\bage\b.*\b(range|group|bracket)|\b(range|group|bracket)\b.*\bage\b/],
  ['age', /^(what is |enter )?(your )?age\b(?! range)(?!.*(least|over|older|18|21))|how old are you/],
  ['linkedin', /linkedin/],
  ['github', /github/],
  ['portfolio', /portfolio/],
  ['website', /website|personal (site|url|page)|other (website|url|link)|^url$|blog/],
  ['inUS', /(currently |presently )?(located|based|live|living|reside|residing) in the (us|u\.s\.?|usa|united states)/],
  ['relocate', /relocat/],
  ['livesIn', /(live|living|located|based|reside|residing) (in|within|near|around) /],
  // Combined address lines: "City, State Zip code (e.g. San Francisco, CA 94158)".
  ['cityStateZip', /\bcity\b.*\b(state|province)\b.*\b(zip|postal)/],
  ['cityState', /^city,?\s*(and\s*)?(state|province)\b(?!.*(zip|postal))/],
  ['zip', /zip|postal code|postcode/],
  ['address', /street|^address( line)?( 1)?$|mailing address|home address/],
  ['location', /location|where (are you|do you) (currently )?(based|located|live)|where do you plan (on|to) work|current city/],
  ['city', /^city\b/],
  ['state', /^(state|province|state\/province|region)\b/],
  ['country', /^country\b|country of residence/],
  ['currentTitle', /current (job )?(title|role|position|occupation)|^(job )?title$/],
  ['currentCompany', /current (company|employer|organization)|most recent (company|employer)|^(company|employer|organization)$/],
  ['gpa', /\bgpa\b|grade point/],
  ['eduStartMonth', /start (date )?month/],
  ['eduStartYear', /start (date )?year/],
  ['eduEndMonth', /(end|graduation) (date )?month/],
  ['eduEndYear', /(end|graduation|grad) (date )?year|year of graduation|class year/],
  ['gradDate', /graduation date|expected graduation|when do you graduate/],
  ['degree', /degree/],
  ['major', /major|discipline|field of study|area of study|concentration/],
  ['school', /school|university|college|institution/],
  ['salary', /salary|compensation|pay (range|expectation)|desired pay/],
  ['noticePeriod', /notice period/],
  ['startDate', /start date|available to start|earliest (start|available)|when (can|could|would) you (start|begin)/],
  ['workMode', /remote|on-?site|hybrid|in[- ]office|work arrangement/],
];

const OTHER_PERSON_RE =
  /\b(employee|referr(er|al)|friend|reference|supervisor|manager|recruiter|relative|emergency contact|spouse|colleague|coworker)'?s?\b.*\bname\b|\bname\b.*\b(of|for) (the|your|a|an) (employee|referr(er|al)|friend|reference|supervisor|manager|recruiter|relative|colleague)/;
const CONSENT_RE = /\b(i )?(agree|acknowledge|consent|certify|attest|confirm that|understand that)\b|privacy (policy|notice)|terms (of|and)|text messages|sms/;
/** Asks about receiving text messages. A checkbox that also bundles terms or certifications stays manual. */
const TEXT_CONSENT_RE = /text message|\bsms\b|text updates|receive texts/;
const BUNDLED_CONSENT_RE = /terms|privacy|certify|attest/;
/** "Acknowledge, confirm, and agree to the following statements": always answered Yes, as the user asked. */
const ACKNOWLEDGE_RE = /acknowledge,?\s+confirm,?\s+(and|&)\s+agree/;
const CHALLENGE_RE = /not a (bot|robot)|prove (that )?you('| a)re (human|not)|figure out the (correct )?secret|captcha/;
const BLOB_RE = /[A-Za-z0-9+/=]{80,}/;
const FREE_TEXT_INPUT_RE = /^(why|describe|tell us|explain|please (describe|explain|share|tell)|what (interests|excites|motivates|draws))|why do you want|why are you interested/;
const SKIP_OPTIONAL_TEXTAREA_RE = /additional information|anything else|cover letter|additional comments|comments/;

export interface AdapterKeys {
  /** Exact element id, name, or Ashby field path → profile key. */
  [idOrName: string]: ProfileKey;
}

export function classifyField(field: ScannedField, adapterKeys: AdapterKeys = {}): Classification {
  // Ashby prefixes names with the form id ("<uuid>__systemfield_eeoc_gender").
  for (const k of [field.id, field.name, field.name.split('__').pop(), field.path]) {
    if (k && adapterKeys[k]) return { kind: 'profile', key: adapterKeys[k], source: 'adapter' };
  }

  const label = field.label.toLowerCase();

  if (field.kind === 'file') {
    if (/transcript/.test(label) || /transcript/i.test(field.id + field.name)) return { kind: 'profile', key: 'transcript', source: 'rule' };
    if (/cover/.test(label) || /cover/.test(field.id + field.name)) return { kind: 'profile', key: 'coverLetter', source: 'rule' };
    if (/resume|\bcv\b|résumé/.test(label) || /resume|cv/i.test(field.id + field.name)) {
      return { kind: 'profile', key: 'resume', source: 'rule' };
    }
    return { kind: 'unknown' };
  }

  // "...provide the employee's first and last name": a name, but not the applicant's.
  if (OTHER_PERSON_RE.test(label)) return { kind: 'unknown' };

  if (CHALLENGE_RE.test(label) || BLOB_RE.test(field.label) || field.label.length > 700) return { kind: 'challenge' };

  if (ACKNOWLEDGE_RE.test(label)) return { kind: 'profile', key: 'acknowledge', source: 'rule' };

  if (TEXT_CONSENT_RE.test(label) && !(field.kind === 'checkbox' && BUNDLED_CONSENT_RE.test(label))) {
    return { kind: 'profile', key: 'textConsent', source: 'rule' };
  }

  if (field.kind === 'checkbox' && CONSENT_RE.test(label)) return { kind: 'consent' };

  switch (field.autocomplete) {
    case 'given-name':
      return { kind: 'profile', key: 'firstName', source: 'rule' };
    case 'family-name':
      return { kind: 'profile', key: 'lastName', source: 'rule' };
    case 'name':
      return { kind: 'profile', key: 'fullName', source: 'rule' };
    case 'email':
      return { kind: 'profile', key: 'email', source: 'rule' };
    case 'tel':
      return { kind: 'profile', key: 'phone', source: 'rule' };
    case 'tel-country-code':
      return { kind: 'profile', key: 'phoneCountryCode', source: 'rule' };
    case 'postal-code':
      return { kind: 'profile', key: 'zip', source: 'rule' };
  }

  // Long questions on textareas are free responses even if they mention a keyword
  // ("Describe a project you shipped at your current company").
  const looksLikeEssay = field.kind === 'textarea' && field.label.length > 90;
  if (!looksLikeEssay) {
    for (const [key, re] of RULES) {
      if (re.test(label)) return { kind: 'profile', key, source: 'rule' };
    }
  }

  if (field.kind === 'textarea') {
    if (!field.required && SKIP_OPTIONAL_TEXTAREA_RE.test(label)) return { kind: 'unknown' };
    return field.label ? { kind: 'free_response' } : { kind: 'unknown' };
  }
  if (field.kind === 'text' && FREE_TEXT_INPUT_RE.test(label)) return { kind: 'free_response' };
  return { kind: 'unknown' };
}
