import type { ScannedField } from './scan';

export type ProfileKey =
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'preferredName'
  | 'pronouns'
  | 'email'
  | 'phone'
  | 'address'
  | 'city'
  | 'state'
  | 'zip'
  | 'country'
  | 'phoneCountryCode'
  | 'location'
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
  | 'usCitizen'
  | 'citizenshipCountry'
  | 'exportStatus'
  | 'activeClearance'
  | 'clearanceEligible'
  | 'sponsorship'
  | 'inUS'
  | 'relocate'
  | 'salary'
  | 'startDate'
  | 'workMode'
  | 'howHeard'
  | 'gender'
  | 'race'
  | 'hispanic'
  | 'veteran'
  | 'disability'
  | 'declineOnly'
  | 'resume'
  | 'coverLetter';

export type Classification =
  | { kind: 'profile'; key: ProfileKey; source: 'adapter' | 'rule' }
  | { kind: 'free_response' }
  /** Self-identification stays manual unless supported saved-answer filling is enabled. */
  | { kind: 'manual' }
  /** Terms, privacy, and certification checkboxes: always left to the user. */
  | { kind: 'consent' }
  /** Anti-bot puzzles and "prove you're human" prompts: always left to the user. */
  | { kind: 'challenge' }
  | { kind: 'unknown' };

type Rule = [ProfileKey, RegExp];

// Order matters: specific phrases come before the generic ones they contain.
const RULES: Rule[] = [
  ['exportStatus', /export[- ]control|us person status|u\.s\. person/],
  ['citizenshipCountry', /country of citizenship|citizenship country|nationality/],
  ['usCitizen', /\b(us|u\.s\.?|united states|american)\s+citizen(ship)?\b|citizen(ship)?\s+(of|in)\s+(the\s+)?(us|u\.s\.?|united states)/],
  ['clearanceEligible', /clearance eligibility|eligible.*clearance|eligibility.*clearance|able to (obtain|maintain).*clearance/],
  ['activeClearance', /active.*clearance|current.*clearance|clearance.*(hold|held)|hold.*clearance/],
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
  ['firstName', /first name|given name|forename/],
  ['lastName', /last name|surname|family name/],
  ['fullName', /^((your|full|legal|candidate|applicant)\s+)*name$|full (legal )?name|legal name/],
  ['email', /e-?mail/],
  ['phone', /phone|mobile|cell\b/],
  ['linkedin', /linkedin/],
  ['github', /github/],
  ['portfolio', /portfolio/],
  ['website', /website|personal (site|url|page)|other (website|url|link)|^url$|blog/],
  ['inUS', /(currently |presently )?(located|based|live|living|reside|residing) in the (us|u\.s\.?|usa|united states)/],
  ['relocate', /relocat/],
  ['zip', /zip|postal code|postcode/],
  ['address', /street|^address( line)?( 1)?$|mailing address|home address/],
  ['location', /location|where (are you|do you) (currently )?(based|located|live)|where do you plan (on|to) work|current city/],
  ['city', /^city\b/],
  ['state', /^(state|province|state\/province|region)\b/],
  ['country', /^country\b|country of residence/],
  ['currentTitle', /current (job )?(title|role|position)|^(job )?title$/],
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
  ['startDate', /start date|available to start|earliest (start|available)|when (can|could|would) you (start|begin)|notice period/],
  ['workMode', /remote|on-?site|hybrid|in[- ]office|work arrangement/],
  ['howHeard', /how did you (hear|find|learn)|where did you (hear|find|learn)|how you heard|referral source|^source$/],
];

const CONSENT_RE = /\b(i )?(agree|acknowledge|consent|certify|attest|confirm that|understand that)\b|privacy (policy|notice)|terms (of|and)|text messages|sms/;
const CHALLENGE_RE = /not a (bot|robot)|prove (that )?you('| a)re (human|not)|figure out the (correct )?secret|captcha/;
const BLOB_RE = /[A-Za-z0-9+/=]{80,}/;
const FREE_TEXT_INPUT_RE = /^(why|describe|tell us|explain|please (describe|explain|share|tell)|what (interests|excites|motivates|draws))|why do you want|why are you interested/;
const SKIP_OPTIONAL_TEXTAREA_RE = /additional information|anything else|cover letter|additional comments|comments/;

export interface AdapterKeys {
  /** Exact element id, name, or Ashby field path → profile key. */
  [idOrName: string]: ProfileKey;
}

const MANUAL_ONLY_KEYS = new Set<ProfileKey>([
  'gender', 'race', 'hispanic', 'veteran', 'disability', 'declineOnly',
]);
const MANUAL_ONLY_EEO_RE =
  /\b(gender|race|ethnic|hispanic|latino|veteran|disability|sexual orientation|lgbtq?|transgender)\b|equal employment opportunity|self[- ]identification/i;

export const SAVED_SELF_ID_KEYS = new Set<ProfileKey>(['gender', 'hispanic', 'race', 'veteran']);

export function classifyField(field: ScannedField, adapterKeys: AdapterKeys = {}, autofillSavedSelfId = false): Classification {
  const label = field.label.toLowerCase();
  if (MANUAL_ONLY_EEO_RE.test(label)) {
    // Other identity questions and free responses remain manual; only these
    // explicit choice fields use saved answers after the user's opt-in.
    if (autofillSavedSelfId && ['select', 'combobox', 'radio', 'checkboxGroup', 'yesno'].includes(field.kind)) {
      if (/gender identity|transgender|sexual orientation|lgbt|disabilit/.test(label)) return { kind: 'manual' };
      const key = /hispanic|latin[oax]/.test(label) ? 'hispanic'
        : /veteran|military (service|status)/.test(label) ? 'veteran'
        : /\brace\b|ethnicit/.test(label) ? 'race'
        : /^(gender|sex)$|^(what is |please (select|specify) )?(your )?gender\??$/.test(label.trim()) ? 'gender' : null;
      if (key) return { kind: 'profile', key, source: 'rule' };
    }
    return { kind: 'manual' };
  }

  for (const k of [field.id, field.name, field.path]) {
    if (k && adapterKeys[k]) {
      if (MANUAL_ONLY_KEYS.has(adapterKeys[k]) && !(autofillSavedSelfId && SAVED_SELF_ID_KEYS.has(adapterKeys[k])
        && ['select', 'combobox', 'radio', 'checkboxGroup', 'yesno'].includes(field.kind))) return { kind: 'manual' };
      return { kind: 'profile', key: adapterKeys[k], source: 'adapter' };
    }
  }

  if (field.kind === 'file') {
    if (/cover/.test(label) || /cover/.test(field.id + field.name)) return { kind: 'profile', key: 'coverLetter', source: 'rule' };
    if (/resume|\bcv\b|résumé/.test(label) || /resume|cv/i.test(field.id + field.name)) {
      return { kind: 'profile', key: 'resume', source: 'rule' };
    }
    return { kind: 'unknown' };
  }

  if (CHALLENGE_RE.test(label) || BLOB_RE.test(field.label) || field.label.length > 700) return { kind: 'challenge' };

  if (field.kind === 'checkbox' && CONSENT_RE.test(label)) return { kind: 'consent' };

  // A bare "Citizenship" can ask for a country or a yes/no fact. Only classify
  // it when the visible options disambiguate it; do not infer nationality.
  if (/^citizenship\s*\*?$/.test(label.trim())) {
    if (field.options.some(o => /\bus citizen\b|\bunited states citizen\b/i.test(o))) {
      return { kind: 'profile', key: 'usCitizen', source: 'rule' };
    }
    return { kind: 'unknown' };
  }

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
