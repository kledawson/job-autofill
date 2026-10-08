import type { ScannedField } from './scan';

export type ProfileKey =
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'preferredName'
  | 'hasPreferredName'
  | 'pronouns'
  | 'email'
  | 'phone'
  | 'phoneCountryCode'
  | 'phoneType'
  | 'textConsent'
  | 'acknowledge'
  | 'essentialFunctions'
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
  | 'previousCompany'
  | 'previousTitle'
  /** "Current or previous employer": the current one, else the previous one. */
  | 'recentCompany'
  | 'recentTitle'
  /** "First / second / third location preference": ranked office choices, never repeated. */
  | 'locationPreference'
  /** "Are you a current or former employee of the U.S. government?" */
  /** "Skills": every saved skill, one chip each on Workday. */
  | 'skills'
  /** "Are you a current or former employee of Ernst & Young?": checked against the work history. */
  | 'employedAt'
  /** "Are you subject to any non-compete or non-solicitation restrictions?" */
  | 'nonCompete'
  | 'govEmployee'
  /** "Are you a citizen of any other country?" */
  | 'otherCitizenship'
  /** Export control: "citizen, national or resident of Iran, Cuba, North Korea, Syria, Crimea...?" */
  | 'sanctionedCountry'
  /** One of the person's links, for a numbered Websites entry. */
  | 'link'
  | 'school'
  | 'degree'
  | 'major'
  | 'gpa'
  | 'eduStartMonth'
  | 'eduStartYear'
  | 'eduEndMonth'
  | 'eduEndYear'
  | 'gradDate'
  /** "Are you graduating ... in 2027?": compared with the saved graduation date. */
  | 'graduatingIn'
  /** "Is your degree in Computer Science?": compared with the saved major. */
  | 'majorIs'
  | 'authorized'
  | 'sponsorship'
  | 'usCitizen'
  | 'citizenshipStatus'
  | 'usPerson'
  | 'clearance'
  | 'clearanceEligible'
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
  | 'transcript'
  // One entry of the work history, chosen by the field's section (Work Experience 1, 2, ...).
  | 'expTitle'
  | 'expCompany'
  | 'expLocation'
  | 'expDescription'
  | 'expCurrent'
  | 'expStartMonth'
  | 'expStartYear'
  | 'expStartDate'
  | 'expEndMonth'
  | 'expEndYear'
  | 'expEndDate';

export type Classification =
  | {
      kind: 'profile';
      key: ProfileKey;
      source: 'adapter' | 'rule' | 'ai' | 'remembered';
      /** Which education or experience entry to read, for fields in a numbered section. */
      index?: number;
    }
  | { kind: 'saved_answer'; answer: string }
  | { kind: 'free_response' }
  /** Terms, privacy, and certification checkboxes: always left to the user. */
  | { kind: 'consent' }
  /** Anti-bot puzzles and "prove you're human" prompts: always left to the user. */
  | { kind: 'challenge' }
  /** `askAi`: no rule recognised the question, so an AI mapping may be tried. */
  | { kind: 'unknown'; askAi?: boolean };

type Rule = [ProfileKey, RegExp];

/** A phone field that wants the dialing code typed into the number itself. */
export const WITH_CODE_RE = /(includ\w*|with|plus|add)\s+(the\s+|your\s+)?(country|international|dial\w*)\s*code|international (format|number)|e\.?164|country code (and|&|\+) (phone )?number|code and (phone )?number/;

// Order matters: specific phrases come before the generic ones they contain.
const RULES: Rule[] = [
  // Export-control screening lists named countries; it is not a work-authorization question.
  ['sanctionedCountry', /(citizen|national|resident).{0,80}\b(iran|cuba|north korea|syria|crimea|donetsk|luhansk|sudan)\b|\b(embargoed|sanctioned) (countr|nation)/],
  // Before the employer rules: "...at your current or most recent employer" is about an agreement, not a name.
  ['nonCompete', /non-?compete|non-?solicit|restrictive covenant|non-?disclosure agreement.*(prevent|restrict)|(agreement|restriction)s? (that|which) (would )?(prevent|restrict|limit)/],
  ['govEmployee', /(current|former|previous|past)[\w\s,/-]{0,30}(employee|employed|official|worker)[\w\s,/-]{0,20}(of|by|with) (the )?(u\.?s\.?|united states|federal|us) (federal )?government|\b(u\.?s\.?|federal) government employee|government official/],
  // "Have you previously worked for Workday?", "Are you a current or former employee of Ernst & Young, LLP?" — the
  // person's own employment there (a relative's or friend's is not), checked against the work history.
  ['employedAt', /^(?!.*\b(relative|family|friend|spouse|partner'?s|referr|know anyone|related to)\b)(are|have|were|is|did|do)\b.{0,120}(\b(employee|employed|worked|partner|principal|contractor|intern|consultant)\b.{0,40}\b(of|for|by|at|with)|\bwork(ing)? for)\s+(?!(your|my|a|an|any|another)\b)\S/],
  ['otherCitizenship', /citizen(ship)? of (any|an)other country|(other|additional|dual|second) citizenships?\b|citizen of more than one country|hold (an)?other citizenship/],
  // One question that covers both: authorized to work without needing sponsorship.
  ['authorizedNoSponsor', /^(?=.*(authori[sz]ed|eligible|legally|permitted|right) .*work)(?=.*(without|not (be )?requir|no (need|requirement)|not need).*sponsor)/],
  // "What is your current visa status?" asks for a status, not whether you need sponsorship.
  ['visaStatus', /^(what (is|are) )?(your )?(current )?(visa|immigration|work authori[sz]ation) status\??$/],
  ['sponsorship', /sponsor|visa (status|support)|require.*visa/],
  ['authorized', /authori[sz]ed to work|legally (able|authori[sz]ed|eligible|permitted)|work authori[sz]ation|eligib(le|ility) to work|right to work|permitted to work/],
  // "Can you confirm you are currently a US Citizen?" often sits inside a long clearance or export-control preamble.
  ['usPerson', /export[- ]controlled|\bu\.?s\.? persons?\b|lawful permanent resident.*asylee/],
  ['usCitizen', /\b(u\.?s\.?|united states|american) citizen/],
  // "Citizenship Status" with a list of statuses ("(a) U.S. citizen or national...", "(b) U.S. lawful permanent resident").
  ['citizenshipStatus', /citizenship status|^(your |u\.?s\.? )?citizenship\b(?!.*country)/],
  // "Clearance Eligibility", "Are you able to obtain a clearance?": a citizenship question, not the level held.
  ['clearanceEligible', /clearance.{0,40}(eligib|qualif|obtain|able to|willing|undergo|sponsor)|(eligib|qualif|obtain|able to|willing|undergo).{0,40}clearance/],
  ['clearance', /security clearance|\bclearances?\b/],
  // "Can you perform the essential functions of this role with or without reasonable accommodation?": always Yes.
  ['essentialFunctions', /essential (job )?(functions|duties|requirements)|with or without (a )?reasonable accommodation/],
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
  ['phoneType', /phone (device )?type|type of phone|device type/],
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
  ['zip', /zip|postal code|postcode|^postal\b/],
  ['address', /street|^address( line)?( 1)?$|mailing address|home address/],
  ['locationPreference', /\b(location|office|site) (preference|choice)\b|\b(preferred|desired) (office|work) location|\b(first|second|third|1st|2nd|3rd|top) (choice|preference)\b.*\b(location|office)/],
  // "Please select the country where you currently reside"
  ['country', /\bcountry (where|in which|that) you (currently )?(live|reside|are based|are located)|which country (do )?you (currently )?(live|reside)|what country (do )?you (currently )?(live|reside)|country of (current )?residen/],
  ['location', /location|where (are you|do you) (currently )?(based|located|live|reside)|where do you plan (on|to) work|current city/],
  ['city', /^city\b/],
  ['state', /^(state|province|state\/province|region)\b/],
  ['country', /^country\b|country of residence/],
  ['recentTitle', /current or (previous|most recent|last|former) (job )?(title|role|position)|(job )?title.*current or (previous|past|most recent)/],
  ['recentCompany', /current or (previous|most recent|last|former) (company|employer|organi[sz]ation)/],
  ['previousTitle', /(previous|former|past|last|prior) (job )?(title|role|position)/],
  ['previousCompany', /(previous|former|past|last|prior) (company|employer|organi[sz]ation)/],
  ['currentTitle', /current (job )?(title|role|position|occupation)|^(job )?title$/],
  ['currentCompany', /current (company|employer|organization)|most recent (company|employer)|^(company|employer|organization)$/],
  ['gpa', /\bgpa\b|grade point/],
  ['skills', /^(type to add )?(your |key |technical |relevant )?skills\b|^(add|list) (your )?skills|skills? \((comma|separated)/],
  ['eduStartMonth', /start (date )?month/],
  ['eduStartYear', /start (date )?year/],
  ['eduEndMonth', /(end|graduation) (date )?month/],
  ['eduEndYear', /(end|graduation|grad) (date )?year|year of graduation|class year/],
  ['graduatingIn', /^(are|will) you\b.*\bgraduat\w*\b.*\b20\d\d\b|^(is|will) your (expected )?graduation\b.*\b20\d\d\b/],
  ['majorIs', /^(is|was) your (\w+'?s? )?(degree|major)\b.* in |^are you (currently )?(studying|majoring|pursuing a degree) in /],
  ['gradDate', /graduation date|expected graduation|when do you graduate/],
  ['degree', /degree/],
  ['major', /major|discipline|field of study|area of study|concentration/],
  ['school', /school|university|college|institution/],
  ['salary', /salary|compensation|pay (range|expectation)|desired pay/],
  ['noticePeriod', /notice period/],
  ['startDate', /start date|available to start|earliest (start|available)|when (can|could|would) you (start|begin)|date available|availability date/],
  ['workMode', /remote|on-?site|hybrid|in[- ]office|work arrangement/],
];

const OTHER_PERSON_RE =
  /\b(employee|referr(er|al)|friend|reference|supervisor|manager|recruiter|relative|emergency contact|spouse|colleague|coworker)'?s?\b.*\bname\b|\bname\b.*\b(of|for) (the|your|a|an) (employee|referr(er|al)|friend|reference|supervisor|manager|recruiter|relative|colleague)/;
const CONSENT_RE = /\b(i )?(agree|acknowledge|consent|certify|attest|confirm that|understand that)\b|privacy (policy|notice)|terms (of|and)|text messages|sms/;
/** Asks about receiving text messages. A checkbox that also bundles terms or certifications stays manual. */
const TEXT_CONSENT_RE = /text message|\bsms\b|text updates|receive texts/;
const BUNDLED_CONSENT_RE = /terms|privacy|certify|attest/;
/** "Acknowledge, confirm, and agree to the following statements": always answered Yes, as the user asked. */
const ACKNOWLEDGE_RE =
  /acknowledge,?\s+confirm,?\s+(and|&)\s+agree|\b(i|we) (hereby )?(acknowledge|certify|attest|affirm)\b|\b(enter|select|type|answer|choose) .{0,3}yes.{0,3} if you (acknowledge|agree|confirm|understand)|^(do you )?acknowledge\b|\backnowledg(e|ement)\b.{0,40}\b(read|understood|reviewed|truthful|accurate)|\byou (hereby )?acknowledge\b|\bby (submitting|applying|clicking)\b[^.]{0,80}\backnowledge/;
const CHALLENGE_RE = /not a (bot|robot)|prove (that )?you('| a)re (human|not)|figure out the (correct )?secret|captcha/;
/** Trap fields for bots ("Please leave this field blank"): filling one can get the application discarded. */
const HONEYPOT_RE = /leave (this|it)( field| box)? (blank|empty)|do not (fill|enter|type)|don.?t (fill|enter|type)|if you are (a )?human/;
const BLOB_RE = /[A-Za-z0-9+/=]{80,}/;
const FREE_TEXT_INPUT_RE = /^(why|describe|tell us|explain|please (describe|explain|share|tell)|what (interests|excites|motivates|draws))|why do you want|why are you interested/;
const SKIP_OPTIONAL_TEXTAREA_RE = /additional information|anything else|cover letter|additional comments|comments/;

// Rules for fields inside a numbered "Work Experience N" / "Education N" block. Order matters.
const EXPERIENCE_RULES: Rule[] = [
  ['expCurrent', /currently work|i work here|current (job|role|position|employer)|present/],
  ['expDescription', /description|responsibilit|duties|summary|accomplishments?|achievements?/],
  ['expTitle', /title|position|\brole\b/],
  ['expCompany', /company|employer|organi[sz]ation/],
  ['expLocation', /location|city/],
  ['expStartMonth', /^(from|start)\b.*\bmonth$/],
  ['expStartYear', /^(from|start)\b.*\byear$/],
  ['expStartDate', /^(from|start)( date)?\b/],
  ['expEndMonth', /^(to|end)\b.*\bmonth$/],
  ['expEndYear', /^(to|end)\b.*\byear$/],
  ['expEndDate', /^(to|end)( date)?\b/],
];
const EDUCATION_RULES: Rule[] = [
  ['school', /school|university|college|institution/],
  ['degree', /degree/],
  ['major', /major|discipline|field of study|area of study|concentration/],
  ['gpa', /\bgpa\b|grade (point )?average|overall result/],
  ['eduStartMonth', /^(from|start)\b.*\bmonth$/],
  ['eduStartYear', /^(from|start|first year)\b.*\byear$|first year attended/],
  ['eduEndMonth', /^(to|end|graduation)\b.*\bmonth$/],
  ['eduEndYear', /^(to|end|graduation|last year)\b.*\byear$|last year attended|graduation year/],
];

export interface AdapterKeys {
  /** Exact element id, name, or Ashby field path → profile key. */
  [idOrName: string]: ProfileKey;
}

export function classifyField(field: ScannedField, adapterKeys: AdapterKeys = {}): Classification {
  // Ashby prefixes names with the form id ("<uuid>__systemfield_eeoc_gender").
  const index = field.section?.index;
  // Workday ids repeat per entry with a number in front ("workExperience-12--jobTitle"); match on the end.
  const suffix = field.id.replace(/^(workExperience|education)-\d+--/, '');
  for (const k of [field.id, suffix, field.name, field.name.split('__').pop(), field.path]) {
    if (k && adapterKeys[k]) return { kind: 'profile', key: adapterKeys[k], source: 'adapter', ...(index !== undefined ? { index } : {}) };
  }

  const label = field.label.toLowerCase();

  // Generic "URL" boxes under a Websites heading; specific ones ("LinkedIn URL" under Lever's "Links") use the rules below.
  if (field.section?.kind === 'website' && field.kind === 'text' && /^(url|website|web ?address|link|website url)\b/.test(label)) return { kind: 'profile', key: 'link', source: 'rule', index: field.section.index };
  if (field.section && field.section.kind !== 'website' && field.kind !== 'file') {
    const rules = field.section.kind === 'experience' ? EXPERIENCE_RULES : EDUCATION_RULES;
    for (const [key, re] of rules) {
      if (re.test(label)) return { kind: 'profile', key, source: 'rule', index: field.section.index };
    }
  }

  if (field.kind === 'file') {
    // Ashby's "Autofill from resume" box runs the site's parser, which rewrites other fields after they are filled.
    if (field.el.closest('.ashby-application-form-autofill-uploader') || /autofill (from|with|using) (your )?(resume|cv|r\u00e9sum\u00e9)/.test(label)) return { kind: 'unknown' };
    if (/transcript/.test(label) || /transcript/i.test(field.id + field.name)) return { kind: 'profile', key: 'transcript', source: 'rule' };
    if (/cover/.test(label) || /cover/.test(field.id + field.name)) return { kind: 'profile', key: 'coverLetter', source: 'rule' };
    if (/resume|\bcv\b|résumé/.test(label) || /resume|cv/i.test(field.id + field.name)) {
      return { kind: 'profile', key: 'resume', source: 'rule' };
    }
    return { kind: 'unknown' };
  }

  // "...provide the employee's first and last name": a name, but not the applicant's.
  if (OTHER_PERSON_RE.test(label)) return { kind: 'unknown' };

  // "Phone Extension" would otherwise take the phone number.
  if (label.length < 40 && /\bextension\b|^ext\.?$/.test(label)) return { kind: 'unknown' };

  // Workday-style "I have a preferred name" checkbox: ticking it reveals the preferred-name boxes.
  if (field.kind === 'checkbox' && /^(i )?(have|use|go by) a (different )?preferred( first)? name\b/.test(label)) {
    return { kind: 'profile', key: 'hasPreferredName', source: 'rule' };
  }

  if (HONEYPOT_RE.test(label) || /honeypot|hpcs|beecatcher/i.test(field.name + field.id + field.path)) return { kind: 'challenge' };

  // Acknowledgments are always answered Yes (as the person asked), however long the statement before them.
  if (ACKNOWLEDGE_RE.test(label) && !CHALLENGE_RE.test(label)) return { kind: 'profile', key: 'acknowledge', source: 'rule' };

  if (CHALLENGE_RE.test(label) || BLOB_RE.test(field.label) || field.label.length > 700) return { kind: 'challenge' };

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
  return field.label ? { kind: 'unknown', askAi: true } : { kind: 'unknown' };
}
