import { educationFactIndex } from '../education-facts';
import { DECLINE, racesOf, type Profile, type YesNo } from '../types';
import type { ProfileKey } from './classify';
import { isPlaceholderOption, normalize } from './match';
import { bachelorDegreeAliases, splitDegree, standardDegree } from '../degree';
import { salaryAnswer } from './salary';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const DECLINE_VARIANTS = [
  DECLINE,
  "I don't wish to answer",
  'Prefer not to say',
  'Decline to self-identify',
  'I do not want to answer',
  'Choose not to disclose',
];

function yesNo(v: YesNo): string[] | null {
  if (v === 'yes') return ['Yes'];
  if (v === 'no') return ['No'];
  return null;
}

function month(yyyyMm: string): string[] | null {
  const mm = /^\d{4}-(\d{2})/.exec(yyyyMm)?.[1];
  if (!mm) return null;
  const n = parseInt(mm, 10);
  const name = MONTHS[n - 1];
  return name ? [name, name.slice(0, 3), mm, String(n)] : null;
}

function year(yyyyMm: string): string[] | null {
  const yyyy = /^(\d{4})/.exec(yyyyMm)?.[1];
  return yyyy ? [yyyy] : null;
}

function degreeVariants(degree: string, raw = degree): string[] {
  const d = degree.toLowerCase();
  const out = Array.from(new Set([degree, raw, ...bachelorDegreeAliases(raw)]));
  if (/bachelor|\bb\.?s\.?\b|\bb\.?a\.?\b|\bbsc\b|undergrad/.test(d)) out.push("Bachelor's Degree", 'Bachelor', "Bachelor's");
  else if (/master|\bm\.?s\.?\b|\bm\.?a\.?\b|\bmsc\b|mba/.test(d)) out.push("Master's Degree", 'Master', "Master's");
  else if (/ph\.?d|doctor/.test(d)) out.push('Doctor of Philosophy (Ph.D.)', 'Ph.D.', 'Doctorate');
  else if (/associate/.test(d)) out.push("Associate's Degree", 'Associate');
  else if (/high school|ged/.test(d)) out.push('High School', 'High School Diploma');
  return out;
}

/** Other wordings forms use for the same self-identification answer. */
const EEO_ALIASES: Record<string, string[]> = {
  male: ['Man', 'Cisgender man'],
  female: ['Woman', 'Cisgender woman'],
  'non-binary': ['Nonbinary', 'Non binary', 'Genderqueer', 'Non-binary / third gender'],
  'black or african american': ['Black', 'African American', 'Black or African American (Not Hispanic or Latino)'],
  'middle eastern or north african': ['Middle Eastern', 'North African', 'MENA', 'Middle Eastern or North African (Not Hispanic or Latino)'],
  white: ['Caucasian', 'White (Not Hispanic or Latino)'],
  asian: ['Asian (Not Hispanic or Latino)'],
  'american indian or alaska native': ['Native American', 'American Indian', 'American Indian or Alaska Native (Not Hispanic or Latino)'],
  'native hawaiian or other pacific islander': ['Native Hawaiian or Pacific Islander', 'Pacific Islander', 'Native Hawaiian', 'Native Hawaiian or Pacific Islander (Not Hispanic or Latino)'],
  'two or more races': ['Two or more', 'Multiracial', 'Mixed', 'Multiracial and/or Multiethnic (Not Hispanic or Latino)'],
  'i am not a protected veteran': ['I am not a veteran', 'Not a protected veteran', 'No'],
  'no, i do not have a disability': ['No, I do not have a disability and have not had one in the past', 'No, I don’t have a disability', 'No disability', 'No'],
  'yes, i have a disability (or previously had a disability)': ['Yes, I have a disability', 'Yes'],
};

function eeo(value: string): string[] {
  const v = value.trim() || DECLINE;
  if (v === DECLINE) return DECLINE_VARIANTS;
  return [v, ...(EEO_ALIASES[v.toLowerCase()] ?? [])];
}

const MONTH_NAMES = MONTHS;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Candidate spellings of the date two weeks from `now`, in the order forms most often want them. */
export function twoWeeksOut(now: Date): string[] {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14);
  return [...dateVariants(d.getFullYear(), d.getMonth() + 1, d.getDate()), '2 weeks', 'Two weeks', 'Immediately'];
}

function dateVariants(y: number, m: number, day: number): string[] {
  return [`${pad2(m)}/${pad2(day)}/${y}`, `${MONTH_NAMES[m - 1]} ${day}, ${y}`, `${y}-${pad2(m)}-${pad2(day)}`];
}

/** A picked calendar date (YYYY-MM-DD) in the spellings forms use; older free-text answers pass through. */
function chosenStartDate(value: string): string[] | null {
  const v = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? dateVariants(+m[1]!, +m[2]!, +m[3]!) : nonEmpty(v);
}

/** Relative choices resolve in local calendar time on each application, including DST/month boundaries. */
export function startDateValues(value: string, now = new Date()): string[] | null {
  const choice = value.trim().toLowerCase();
  if (!choice) return twoWeeksOut(now);
  if (choice === 'today' || choice === 'tomorrow') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (choice === 'tomorrow' ? 1 : 0));
    return [...dateVariants(d.getFullYear(), d.getMonth() + 1, d.getDate()), ...(choice === 'today' ? ['Immediately', 'Today'] : ['Tomorrow'])];
  }
  return chosenStartDate(value);
}

function normalizeCode(code: string): string {
  const digits = code.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

/** The phone number without a leading dialing code ("+1 (415) 555-0100" → "(415) 555-0100"). */
function nationalNumber(phone: string, countryCode: string): string {
  const t = phone.trim();
  const digits = normalizeCode(countryCode).slice(1);
  if (!t || !digits) return t;
  const m = new RegExp(`^(?:\\+\\s*${digits}|${digits}(?=[\\s.-]?\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}$))[\\s.-]*`).exec(t);
  return m ? t.slice(m[0].length) : t;
}

const ARRANGEMENT_RE = {
  remote: /remote|work from home|wfh/,
  hybrid: /hybrid/,
  onsite: /on-?site|in[- ]office|in[- ]person|\boffice\b/,
};

const BAY_AREA_CITIES = new Set(
  `san francisco|san jose|oakland|berkeley|palo alto|mountain view|sunnyvale|santa clara|fremont|redwood city|san mateo|menlo park|cupertino|milpitas|hayward|los altos|foster city|south san francisco|daly city|walnut creek|emeryville|san rafael|pleasanton|livermore|campbell|los gatos|saratoga|san carlos|belmont|burlingame|union city|newark|dublin|concord|richmond|alameda|san leandro|sausalito|mill valley|atherton|east palo alto|millbrae|san bruno|pacifica|brisbane|san ramon|danville|novato|petaluma|santa rosa|napa|vallejo|half moon bay`.split('|'),
);

/** "Are you living in the Bay Area / in Austin?": Yes when the profile city fits, No only for a clear Bay Area miss. */
function livesIn(label: string, p: Profile): string[] | null {
  const city = normalize(p.city);
  if (!city) return null;
  const l = ` ${normalize(label)} `;
  if (/\bbay area\b/.test(l)) return [BAY_AREA_CITIES.has(city) ? 'Yes' : 'No'];
  return l.includes(` ${city} `) ? ['Yes'] : null;
}

type Citizenship = 'citizen' | 'resident' | 'other';

/** US citizen, permanent resident / asylee (also a "US person"), or anyone else; null when no status is saved. */
function citizenship(p: Profile): Citizenship | null {
  const s = p.workAuth.status.trim();
  if (!s) return null;
  if (/citizen/i.test(s)) return 'citizen';
  if (/permanent resident|green card|asylee|refugee/i.test(s)) return 'resident';
  return 'other';
}

/**
 * "Are you authorized to work in the US?" Yes/No lists take Yes; longer lists ("I am authorized to work for any
 * employer", "...for my present employer only", "I require sponsorship") get the wording that fits the profile.
 * Citizens and residents who need no sponsorship can work for any employer.
 */
function authorizedAnswers(p: Profile): string[] | null {
  const { authorizedUS, needsSponsorship } = p.workAuth;
  if (authorizedUS === 'no') return ['No', 'I am not authorized to work in the United States'];
  if (authorizedUS !== 'yes') return null;
  if (needsSponsorship === 'yes') return ['Yes', 'I require sponsorship to work in the United States'];
  if (needsSponsorship === 'no') {
    return [
      'Yes',
      'I am authorized to work in the United States for any employer',
      'Authorized to work for any employer',
      'I am legally authorized to work in the United States',
      'I am authorized to work in the United States',
    ];
  }
  return ['Yes'];
}

/** Rank used to answer "Do you hold a Top Secret clearance?" from the highest level held. */
const CLEARANCE_RANK: Record<string, number> = { secret: 1, 'top secret': 2, 'doe q': 2, 'top secret sci': 3, 'top secret sci with polygraph': 4 };

function clearanceAnswers(level: string, label: string, options: string[], yesNoQuestion: boolean): string[] | null {
  const l = level.trim().toLowerCase();
  if (!l) return null;
  if (/^prefer not/.test(l)) return DECLINE_VARIANTS;
  const held = l in CLEARANCE_RANK;
  const real = options.filter((o) => !isPlaceholderOption(o));
  if (yesNoQuestion || (real.length > 0 && real.length <= 3 && real.every((o) => /^(yes|no)\b/i.test(o.trim())))) {
    if (!held) return ['No'];
    const q = label.toLowerCase();
    const asked = /\bpoly/.test(q) ? 4 : /\bsci\b|ts\/sci/.test(q) ? 3 : /top secret|\bts\b/.test(q) ? 2 : /\bdoe\b|\bq\b/.test(q) ? 2 : /\bsecret\b/.test(q) ? 1 : 0;
    return [CLEARANCE_RANK[l]! >= asked ? 'Yes' : 'No'];
  }
  switch (l) {
    case 'none / never held':
      return ['Never held a clearance', 'None', 'No clearance', 'No active clearance', 'N/A', 'Not applicable'];
    case 'expired':
      return ['Expired Clearance', 'Expired', 'Inactive'];
    case 'secret':
      return ['Secret'];
    case 'top secret':
      return ['Top Secret', 'TS'];
    case 'top secret sci':
      return ['Top Secret SCI', 'Top Secret/SCI', 'TS/SCI', 'Top Secret'];
    case 'top secret sci with polygraph':
      return ['Top Secret SCI with Polygraph', 'TS/SCI with Polygraph', 'TS/SCI with Poly', 'Top Secret SCI', 'Top Secret'];
    case 'doe q':
      return ['DOE Level Q', 'DOE Q', 'Q Clearance', 'Q'];
    default:
      return [level.trim()];
  }
}

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/** "CA" and "California": text boxes take what was saved, dropdowns usually list the full name. */
function stateVariants(state: string): string[] | null {
  const s = state.trim();
  const full = US_STATES[s.toUpperCase()];
  if (full) return [s, full];
  const abbr = Object.keys(US_STATES).find((k) => US_STATES[k]!.toLowerCase() === s.toLowerCase());
  return nonEmpty(s, abbr);
}

function nonEmpty(...values: (string | undefined)[]): string[] | null {
  const out = values.map((v) => v?.trim() ?? '').filter(Boolean);
  return out.length ? Array.from(new Set(out)) : null;
}

function isUS(country: string): boolean | null {
  if (!country.trim()) return null;
  return /^(us|usa|u\.s\.a?\.?|united states( of america)?)$/i.test(country.trim());
}

const SCHOOL_DATE_KEYS: ReadonlySet<ProfileKey> = new Set(['eduStartMonth', 'eduStartYear', 'eduEndMonth', 'eduEndYear', 'gradDate']);

/** The user asked for this item to be filled only when the application requires it. */
function skipUnlessRequired(key: ProfileKey, p: Profile): boolean {
  const only = p.fillOnlyIfRequired;
  if (!only) return false;
  if (key === 'address') return only.address;
  if (key === 'gpa') return only.gpa;
  return only.schoolDates && SCHOOL_DATE_KEYS.has(key);
}

/**
 * Candidate values for a profile key, best first. Several candidates let option matching
 * handle "Bachelor's Degree" vs "BS", or "January" vs "01". Null when the profile has no value.
 */
export function valueFor(
  key: ProfileKey,
  p: Profile,
  opts: {
    phoneWithCode?: boolean;
    yesNo?: boolean;
    now?: Date;
    label?: string;
    description?: string;
    required?: boolean;
    options?: string[];
    /** Entry of a numbered Education / Work Experience block. */
    index?: number;
    /** The hiring company, for "have you worked for this company / us?". */
    company?: string;
    /** The form has its own preferred-name box, so the first-name box keeps the legal first name. */
    hasPreferredNameField?: boolean;
  } = {},
): string[] | null {
  if (!opts.required && skipUnlessRequired(key, p)) return null;
  const factIndex = key === 'gpa' ? educationFactIndex(p, opts.label ?? 'GPA', opts.index) : null;
  const edu = key === 'gpa' ? (factIndex === null ? undefined : p.education[factIndex]) : opts.index !== undefined ? educationEntries(p)[opts.index] : (p.education.find((e) => e.school) ?? p.education[0]);
  const job = experienceEntries(p)[opts.index ?? 0];
  switch (key) {
    case 'fullName':
      // Same rule as the first-name box: a single name box gets the name people actually use.
      return nonEmpty([opts.hasPreferredNameField ? p.firstName : p.preferredName || p.firstName, p.lastName].filter(Boolean).join(' '));
    case 'firstName':
      // Without a separate preferred-name box, the name people actually use goes in the first-name box.
      return nonEmpty(opts.hasPreferredNameField ? p.firstName : p.preferredName || p.firstName);
    case 'lastName':
      return nonEmpty(p.lastName);
    case 'hasPreferredName':
      // Only tick it when the saved preferred name actually differs from the legal first name.
      return p.preferredName && p.preferredName.trim().toLowerCase() !== p.firstName.trim().toLowerCase() ? ['Yes'] : null;
    case 'preferredName':
      return nonEmpty(p.preferredName || p.firstName);
    case 'pronouns':
      return nonEmpty(p.pronouns);
    case 'email':
      return nonEmpty(p.email);
    case 'phone': {
      const national = nationalNumber(p.phone, p.countryCode);
      if (!opts.phoneWithCode || !national) return nonEmpty(national);
      const code = normalizeCode(p.countryCode);
      return nonEmpty(code ? `${code} ${national}` : national);
    }
    case 'phoneType':
      return ['Mobile', 'Cell', 'Mobile Phone', 'Cell Phone'];
    case 'phoneCountryCode': {
      const code = normalizeCode(p.countryCode);
      if (!code) return null;
      const digits = code.slice(1);
      return code === '+1'
        ? ['+1', '1', 'United States (+1)', 'United States +1', 'United States', 'USA']
        : [code, digits, `(${code})`];
    }
    case 'ageAtLeast': {
      const age = parseInt(p.age, 10);
      const min = parseInt(/\b(1[4-9]|[2-6][0-9])\b/.exec(opts.label ?? '')?.[1] ?? '', 10);
      return Number.isFinite(age) && Number.isFinite(min) ? [age >= min ? 'Yes' : 'No'] : null;
    }
    case 'acknowledge':
      return ['Yes', 'I acknowledge', 'I agree', 'Agree', 'Acknowledge'];
    case 'essentialFunctions':
      return [
        'Yes',
        'I can perform the essential functions of this role with or without reasonable accommodation',
        'Yes, without accommodation',
        'Yes, with accommodation',
        'I can',
        'Able',
      ];
    case 'textConsent':
      return p.textConsent
        ? ['Yes', 'I agree', 'Agree', 'I consent', 'Yes, I agree', 'Opt in']
        : ['No', 'I do not agree', 'I disagree', 'I do not consent', 'No, I do not agree', 'Opt out'];
    case 'ageRange': {
      const age = parseInt(p.age, 10);
      if (!Number.isFinite(age)) return null;
      const hit = (opts.options ?? []).find((o) => {
        const nums = (o.match(/\d+/g) ?? []).map(Number);
        if (nums.length >= 2) return age >= nums[0]! && age <= nums[1]!;
        if (nums.length === 1) return /or (older|above|more|over)|\+|and (over|above|older)|over|above/i.test(o) ? age >= nums[0]! : /under|below|less|younger/i.test(o) ? age < nums[0]! : false;
        return false;
      });
      return hit ? [hit] : null;
    }
    case 'age':
      return nonEmpty(p.age);
    case 'address':
      return nonEmpty(p.address);
    case 'city': {
      const place = applicantLocationParts(p);
      return place.valid ? nonEmpty(place.city) : null;
    }
    case 'state':
      return stateVariants(p.state);
    case 'zip':
      return nonEmpty(p.zip);
    case 'country':
      return isUS(p.country) ? ['United States', 'United States of America', 'USA', 'US'] : nonEmpty(p.country);
    case 'cityStateZip': {
      const line = [[p.city, p.state].filter(Boolean).join(', '), p.zip].filter(Boolean).join(' ');
      return nonEmpty(line, [p.city, p.state].filter(Boolean).join(', '));
    }
    case 'cityState': {
      const place = applicantLocationParts(p);
      return place.valid ? nonEmpty([place.city, place.state].filter(Boolean).join(', '), place.city) : null;
    }
    case 'location': {
      const place = applicantLocationParts(p);
      if (!place.valid) return null;
      // Region lists ("North America", "Europe") are matched by the region of the country.
      return nonEmpty(
        [place.city, place.state].filter(Boolean).join(', '),
        [place.city, place.state, place.country].filter(Boolean).join(', '),
        place.city,
        // Lists of states ("California", "Texas"): the profile state by name and abbreviation.
        ...(isUS(p.country) !== false ? (stateVariants(p.state) ?? []) : []),
        ...regionOf(p.country),
      );
    }
    case 'linkedin':
      return nonEmpty(p.linkedin);
    case 'github':
      return nonEmpty(p.github);
    case 'portfolio':
      return nonEmpty(p.portfolio, p.website);
    case 'website':
      return nonEmpty(p.website, p.portfolio, p.github);
    case 'currentCompany':
      return nonEmpty(p.currentCompany.trim()) ?? (opts.required ? ['N/A'] : null);
    case 'currentTitle':
      return nonEmpty(p.currentTitle.trim()) ?? (opts.required ? ['N/A'] : null);
    case 'previousCompany':
      return nonEmpty(previousJob(p).company) ?? (opts.required ? ['N/A'] : null);
    case 'previousTitle':
      return nonEmpty(previousJob(p).title) ?? (opts.required ? ['N/A'] : null);
    case 'recentCompany':
      return nonEmpty(p.currentCompany, previousJob(p).company) ?? (opts.required ? ['N/A'] : null);
    case 'recentTitle':
      return nonEmpty(p.currentTitle, previousJob(p).title) ?? (opts.required ? ['N/A'] : null);
    case 'link': {
      const link = uniqueLinks(p)[opts.index ?? 0];
      return link ? [link] : null;
    }
    case 'skills':
      return p.skills.length ? [p.skills.join(', ')] : null;
    case 'employedAt':
      return employedAt(opts.label ?? '', p, opts.company ?? '', opts.now ?? new Date());
    case 'nonCompete':
      return yesNo(p.preferences.nonCompete);
    case 'govEmployee':
      return yesNo(p.workAuth.govEmployee);
    case 'otherCitizenship':
      return yesNo(p.workAuth.otherCitizenship);
    case 'sanctionedCountry':
      return sanctionedAnswer(opts.label ?? '', p);
    case 'locationPreference':
      // Picked from the options by pickLocationPreference; these are only a fallback for free-text boxes.
      return nonEmpty([p.city, p.state].filter(Boolean).join(', '), p.city);
    case 'school':
      return nonEmpty(edu?.school);
    case 'degree': {
      const { degree } = edu ? splitDegree(edu) : { degree: '' };
      const type = standardDegree(degree);
      return degree ? degreeVariants(type || degree, degree) : null;
    }
    case 'major':
      return nonEmpty(edu ? splitDegree(edu).major : '');
    case 'gpa':
      return nonEmpty(edu?.gpa);
    case 'eduStartMonth':
      return edu ? month(edu.startDate) : null;
    case 'eduStartYear':
      return edu ? year(edu.startDate) : null;
    case 'eduEndMonth':
      return edu ? month(edu.endDate) : null;
    case 'eduEndYear':
      return edu ? year(edu.endDate) : null;
    case 'graduatingIn':
      return graduatingIn(opts.label ?? '', edu);
    case 'majorIs':
      return majorIs(opts.label ?? '', edu ? splitDegree(edu).major : '');
    case 'gradDate': {
      const m = /^(\d{4})-(\d{2})/.exec(edu?.endDate ?? '');
      return m ? [`${m[2]}/${m[1]}`] : null;
    }
    case 'authorized':
      return authorizedAnswers(p);
    case 'usCitizen': {
      const c = citizenship(p);
      return c === null ? null : [c === 'citizen' ? 'Yes' : 'No'];
    }
    case 'citizenshipStatus': {
      // Only citizen and green card map to one option; refugee vs asylee and visas are left to the person.
      const c = citizenship(p);
      if (c === 'citizen') return ['U.S. citizen or national of the United States', 'US Citizen', 'Citizen'];
      if (c === 'resident' && /permanent resident|green card/i.test(p.workAuth.status)) {
        return ['U.S. lawful permanent resident', 'Lawful Permanent Resident', 'Permanent Resident', 'Green Card'];
      }
      return null;
    }
    case 'usPerson': {
      const c = citizenship(p);
      if (c === null) return null;
      if (c === 'other' && /other visa/i.test(p.workAuth.status)) return null;
      return c === 'other' ? ['No'] : ['Yes', c === 'citizen' ? 'US Citizen' : /asylee|refugee/i.test(p.workAuth.status) ? 'Qualifying Asylee' : 'Lawful Permanent Resident'];
    }
    case 'clearanceEligible': {
      const c = citizenship(p);
      return c === null ? null : [c === 'citizen' ? 'Yes' : 'No'];
    }
    case 'clearance':
      return clearanceAnswers(p.workAuth.clearance, opts.label ?? '', opts.options ?? [], !!opts.yesNo);
    case 'visaStatus':
      return [p.workAuth.status.trim() || 'N/A'];
    case 'sponsorship':
      return yesNo(p.workAuth.needsSponsorship);
    case 'authorizedNoSponsor': {
      if (p.workAuth.authorizedUS === 'no' || p.workAuth.needsSponsorship === 'yes') return ['No'];
      return p.workAuth.authorizedUS === 'yes' && p.workAuth.needsSponsorship === 'no' ? ['Yes'] : null;
    }
    case 'livesIn':
      return livesIn(opts.label ?? '', p);
    case 'inUS': {
      const us = isUS(p.country);
      return us === null ? null : [us ? 'Yes' : 'No'];
    }
    case 'relocate':
      return yesNo(p.preferences.relocate);
    case 'salary':
      return salaryAnswer(p.preferences.salary, opts.description ?? '', opts.label ?? '');
    case 'noticePeriod': {
      const employed = !!(p.currentCompany.trim() || p.currentTitle.trim() || p.experience.some((x) => x.current));
      return employed ? ['2 weeks', '2 Weeks', '14 days', '2'] : ['0', '0 days', 'None', 'Immediate', 'Immediately'];
    }
    case 'startDate':
      return startDateValues(p.preferences.startDate, opts.now ?? new Date());
    case 'workMode': {
      const mode = p.preferences.workMode;
      if (opts.yesNo) {
        // "Flexible" means willing to work any arrangement, so every yes/no question about one is Yes.
        if (mode === 'flexible') return ['Yes'];
        const l = (opts.label ?? '').toLowerCase();
        const asked = (Object.keys(ARRANGEMENT_RE) as (keyof typeof ARRANGEMENT_RE)[]).filter((k) => ARRANGEMENT_RE[k].test(l));
        return mode && asked.includes(mode as keyof typeof ARRANGEMENT_RE) ? ['Yes'] : null;
      }
      const labels: Record<string, string[]> = {
        remote: ['Remote'],
        hybrid: ['Hybrid'],
        onsite: ['On-site', 'Onsite', 'In office'],
        flexible: ['Flexible', 'Open to any', 'Any'],
      };
      return (mode && labels[mode]) || null;
    }
    case 'gender':
      return eeo(p.eeo.gender);
    case 'race': {
      // One choice for several races: "Two or More Races". Checkbox lists tick each one instead (raceChoices).
      const races = racesOf(p.eeo.race);
      if (races.length > 1) return TWO_OR_MORE;
      return eeo(races[0] ?? DECLINE);
    }
    case 'hispanic':
      return eeo(p.eeo.hispanic);
    case 'veteran':
      return eeo(p.eeo.veteran);
    case 'disability':
      return eeo(p.eeo.disability);
    case 'declineOnly':
      return DECLINE_VARIANTS;
    case 'expTitle':
      return nonEmpty(job?.title);
    case 'expCompany':
      return nonEmpty(job?.company);
    case 'expLocation':
      return nonEmpty(job?.location);
    case 'expDescription':
      return nonEmpty(bulleted(job?.bullets ?? ''));
    case 'expCurrent':
      return job?.current ? ['Yes'] : null;
    case 'expStartMonth':
      return job ? month(job.startDate) : null;
    case 'expStartYear':
      return job ? year(job.startDate) : null;
    case 'expStartDate':
      return job ? monthYear(job.startDate) : null;
    case 'expEndMonth':
      return job && !job.current ? month(job.endDate) : null;
    case 'expEndYear':
      return job && !job.current ? year(job.endDate) : null;
    case 'expEndDate':
      return job && !job.current ? monthYear(job.endDate) : null;
    case 'resume':
    case 'coverLetter':
    case 'transcript':
      return null;
  }
}

/**
 * "Are you graduating from a bachelor's or master's degree program in 2027?": Yes when the saved graduation
 * year matches and (if the question names degree levels) the saved degree is one of them.
 */
function graduatingIn(label: string, edu: Profile['education'][number] | undefined): string[] | null {
  const asked = /\b(20\d\d)\b/.exec(label)?.[1];
  const year = /^(\d{4})/.exec(edu?.endDate ?? '')?.[1];
  if (!asked || !year || !edu) return null;
  if (year !== asked) return ['No'];
  const levels = (['bachelor', 'master', 'phd', 'associate'] as const).filter((l) =>
    l === 'phd' ? /ph\.?d|doctor/i.test(label) : new RegExp(`\\b${l}`, 'i').test(label),
  );
  if (!levels.length) return ['Yes'];
  const level = standardDegree(splitDegree(edu).degree).toLowerCase();
  if (!level) return null;
  const held = /bachelor/.test(level) ? 'bachelor' : /master|mba/.test(level) ? 'master' : /doctor|ph/.test(level) ? 'phd' : /associate/.test(level) ? 'associate' : '';
  return [levels.includes(held as (typeof levels)[number]) ? 'Yes' : 'No'];
}

/** Words that make "in ..." a category ("a STEM field") rather than one named major. */
const BROAD_SUBJECT_RE = /\b(field|fields|related|stem|technical|quantitative|similar|equivalent|discipline|area|or)\b/i;

/** "Is your degree in Computer Science?": Yes when the saved major is that subject; No only for a clearly different named major. */
function majorIs(label: string, major: string): string[] | null {
  const subject = / in (.+?)\??$/i.exec(label)?.[1]?.replace(/^(a|an|the)\s+/i, '') ?? '';
  if (!subject || !major.trim()) return null;
  const s = normalize(subject);
  const m = normalize(major);
  if (s && m && (m.includes(s) || s.includes(m))) return ['Yes'];
  return BROAD_SUBJECT_RE.test(subject) ? null : ['No'];
}

const TWO_OR_MORE = ['Two or More Races', 'Two or more races', 'Two or More', 'Multiracial', 'Multi-racial', 'Mixed race', 'Multiracial and/or Multiethnic', 'Multiracial and/or Multiethnic (Not Hispanic or Latino)'];

/**
 * Each answer to tick on a "select all that apply" race list: every saved race, plus Hispanic or Latino when
 * that was answered Yes. Declining ticks only the decline option.
 */
export function raceChoices(p: Profile): string[][] {
  const races = racesOf(p.eeo.race).map((r) => eeo(r));
  if (/^yes$/i.test(p.eeo.hispanic.trim())) races.push(['Hispanic or Latino', 'Hispanic', 'Latino', 'Hispanic or Latinx']);
  return races.length ? races : [DECLINE_VARIANTS];
}

/** The saved previous job, else the most recent past job in the work history. */
function previousJob(p: Profile): { company: string; title: string } {
  if (p.previousCompany.trim() || p.previousTitle.trim()) return { company: p.previousCompany.trim(), title: p.previousTitle.trim() };
  const past = p.experience.find((x) => !x.current && (x.company.trim() || x.title.trim()));
  return { company: past?.company.trim() ?? '', title: past?.title.trim() ?? '' };
}

/** Each distinct link in the profile, LinkedIn last (forms often ask for it separately). */
export function uniqueLinks(p: Profile): string[] {
  const key = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const link of [p.portfolio, p.website, p.github, p.linkedin]) {
    const k = key(link ?? '');
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(link.trim());
  }
  return out;
}

/** Cities that count as one area when picking a nearby office. */
const METROS: { states: string[]; cities: string[] }[] = [
  { states: ['ca'], cities: [...BAY_AREA_CITIES, 'santa cruz', 'scotts valley', 'capitola', 'gilroy', 'morgan hill', 'watsonville'] },
  { states: ['ca'], cities: ['los angeles', 'santa monica', 'culver city', 'pasadena', 'burbank', 'glendale', 'irvine', 'long beach', 'el segundo', 'playa vista', 'venice', 'torrance', 'anaheim', 'costa mesa', 'newport beach', 'hollywood', 'west hollywood', 'beverly hills'] },
  { states: ['ca'], cities: ['san diego', 'la jolla', 'carlsbad', 'del mar', 'chula vista'] },
  { states: ['wa'], cities: ['seattle', 'bellevue', 'redmond', 'kirkland', 'bothell', 'tacoma', 'everett', 'renton', 'issaquah', 'sammamish', 'kent', 'lynnwood'] },
  { states: ['ny', 'nj', 'ct'], cities: ['new york', 'new york city', 'nyc', 'brooklyn', 'queens', 'bronx', 'manhattan', 'staten island', 'long island city', 'jersey city', 'hoboken', 'newark', 'stamford', 'white plains', 'yonkers'] },
  { states: ['ma'], cities: ['boston', 'cambridge', 'somerville', 'waltham', 'burlington', 'quincy', 'newton', 'lexington', 'woburn'] },
  { states: ['il'], cities: ['chicago', 'evanston', 'oak brook', 'naperville', 'schaumburg', 'deerfield'] },
  { states: ['tx'], cities: ['austin', 'round rock', 'cedar park', 'georgetown'] },
  { states: ['tx'], cities: ['dallas', 'plano', 'irving', 'fort worth', 'richardson', 'frisco', 'addison'] },
  { states: ['tx'], cities: ['houston', 'the woodlands', 'sugar land', 'katy'] },
  { states: ['dc', 'va', 'md'], cities: ['washington', 'washington dc', 'arlington', 'alexandria', 'reston', 'mclean', 'herndon', 'tysons', 'bethesda', 'silver spring', 'rockville', 'chantilly'] },
  { states: ['co'], cities: ['denver', 'boulder', 'aurora', 'lakewood', 'broomfield', 'englewood'] },
  { states: ['ga'], cities: ['atlanta', 'alpharetta', 'marietta', 'sandy springs'] },
  { states: ['or', 'wa'], cities: ['portland', 'beaverton', 'hillsboro', 'vancouver'] },
  { states: ['nc'], cities: ['raleigh', 'durham', 'chapel hill', 'cary', 'morrisville', 'research triangle park'] },
  { states: ['pa', 'nj'], cities: ['philadelphia', 'king of prussia', 'conshohocken', 'camden'] },
  { states: ['fl'], cities: ['miami', 'fort lauderdale', 'boca raton', 'miami beach', 'coral gables'] },
  { states: ['az'], cities: ['phoenix', 'scottsdale', 'tempe', 'chandler', 'mesa'] },
  { states: ['ut'], cities: ['salt lake city', 'lehi', 'provo', 'draper', 'south jordan'] },
  { states: ['mn'], cities: ['minneapolis', 'st paul', 'saint paul', 'bloomington'] },
  { states: ['mi'], cities: ['detroit', 'ann arbor', 'warren', 'dearborn', 'southfield'] },
  { states: ['oh'], cities: ['cincinnati', 'mason', 'blue ash'] },
];

/** City (and state, if given) at the start of an option or address: "San Jose, CA, United States" → san jose / ca. */
function placeOf(text: string): { city: string; state: string } {
  const [city = '', state = ''] = text.split(/,|\s+-\s+|\(/).map((s) => normalize(s));
  return { city, state: /^[a-z]{2}$/.test(state) ? state : (Object.entries(US_STATES).find(([, n]) => n.toLowerCase() === state)?.[0].toLowerCase() ?? '') };
}

function metroOf(place: { city: string; state: string }): number {
  return METROS.findIndex((m) => m.cities.includes(place.city) && (!place.state || m.states.includes(place.state)));
}

const NO_FLEXIBILITY_RE = /\b(no|not have|don.?t have|without)\b.*\bflexib|\bno (other|additional|second|third|further) (location|office|preference)|\bonly (the )?(first|above|one)\b|^(none|n\/a|not applicable)$|no preference beyond/i;
const ANY_OFFICE_RE = /\b(any|all) (office|location)s?\b|open to (any|all)|anywhere|no preference$/i;

/**
 * The option for the Nth location preference: the person's own city, then other offices in the same area,
 * never one already chosen for an earlier preference. Past the first, when no office is nearby, the
 * "no flexibility for another office" option; otherwise -1 (left for the person).
 */
export function pickLocationPreference(options: string[], p: Profile, rank: number, chosen: string[]): number {
  const home = { city: normalize(p.city), state: (stateVariants(p.state) ?? []).map((s) => s.toLowerCase()).find((s) => s.length === 2) ?? '' };
  if (!home.city) return -1;
  const homeMetro = metroOf(home);
  const taken = new Set(chosen.map(normalize));
  const open = options.map((o, i) => ({ o, i })).filter(({ o }) => !isPlaceholderOption(o));
  // Offices are never repeated; the "no flexibility" answer can be given for every later preference.
  const office = open.filter(({ o }) => !ANY_OFFICE_RE.test(o) && !NO_FLEXIBILITY_RE.test(o) && !taken.has(normalize(o)));
  const same = office.find(({ o }) => placeOf(o).city === home.city);
  if (same) return same.i;
  const near = homeMetro >= 0 ? office.find(({ o }) => metroOf(placeOf(o)) === homeMetro) : undefined;
  if (near) return near.i;
  if (rank > 1) return open.find(({ o }) => NO_FLEXIBILITY_RE.test(o))?.i ?? -1;
  return -1;
}

/** "Ernst & Young, LLP" and "Ernst and Young" are one company: drop legal suffixes, "the", and punctuation. */
function companyKey(name: string): string {
  return normalize(name.replace(/&/g, ' and '))
    .replace(/\b(the|llp|llc|inc|incorporated|corp|corporation|co|company|ltd|limited|plc|gmbh|lp|group|holdings)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Companies a question names: "employee of Ernst & Young, LLP, Workday's auditors" → ["Ernst & Young"]. */
export function companiesAsked(label: string, hiring: string): string[] {
  const out: string[] = [];
  const re = /(?:\b(?:employee|employed|worked|partner|principal|contractor|intern|consultant)\b.{0,40}?\b(?:of|for|by|at|with)|\bwork(?:ing)? for)\s+(.+?)(?=[,?;:()]|\s+(?:or|and|in|within|as|during|since|before|after|at any time)\b|$)/gi;
  for (const m of label.matchAll(re)) {
    const name = m[1]!.trim().replace(/^(the|a|an)\s+/i, '');
    if (/^(this|our) (company|organization|firm|employer)$|^us$|^(this|our) (team|group)$/i.test(name)) {
      if (hiring.trim()) out.push(hiring.trim());
    } else if (name && !/^(any|your|my|our|a|an|another)\b/i.test(name)) out.push(name);
  }
  return Array.from(new Set(out));
}

/**
 * "Are you a current or recent former (within the preceding 24 months) employee of Ernst & Young?": Yes when the
 * work history has a job there that is current, or ended inside the stated window (any time, when none is
 * stated); No otherwise. "Currently employed by" asks only about a current job. A partner/principal clause
 * "at any time" also counts a past job with such a title.
 */
function employedAt(label: string, p: Profile, hiring: string, now: Date): string[] | null {
  const names = companiesAsked(label, hiring).map(companyKey).filter(Boolean);
  if (!names.length) return null;
  const l = label.toLowerCase();
  const currentOnly = /\bcurrent(ly)?\b/.test(l) && !/\b(former|previous(ly)?|ever|past|prior|recent)\b/.test(l);
  const window = /within (?:the )?(?:preceding|past|last|prior)?\s*(\d+)\s*(month|year)s?|(?:past|last|preceding) (\d+) (month|year)s?/.exec(l);
  const months = window ? Number(window[1] ?? window[3]) * (/year/.test(window[2] ?? window[4] ?? '') ? 12 : 1) : null;
  const partnerAnyTime = /(partner|principal)[^.?]{0,60}at any time|at any time[^.?]{0,40}(partner|principal)/.test(l);
  const jobs = [
    ...p.experience.filter((x) => x.company.trim()).map((x) => ({ company: x.company, title: x.title, end: x.current ? null : x.endDate, current: x.current })),
    ...(p.currentCompany.trim() ? [{ company: p.currentCompany, title: p.currentTitle, end: null, current: true }] : []),
    ...(p.previousCompany.trim() ? [{ company: p.previousCompany, title: p.previousTitle, end: '', current: false }] : []),
  ];
  const at = (company: string) => {
    const k = companyKey(company);
    return !!k && names.some((n) => n === k || ` ${k} `.includes(` ${n} `) || ` ${n} `.includes(` ${k} `));
  };
  const monthsAgo = (end: string) => {
    const m = /^(\d{4})-(\d{2})/.exec(end);
    return m ? (now.getFullYear() - Number(m[1])) * 12 + (now.getMonth() + 1 - Number(m[2])) : null;
  };
  for (const job of jobs.filter((j) => at(j.company))) {
    if (job.current) return ['Yes'];
    if (currentOnly) continue;
    if (months === null) return ['Yes'];
    const ago = monthsAgo(job.end ?? '');
    if (ago === null || ago <= months) return ['Yes'];
    if (partnerAnyTime && /partner|principal/i.test(job.title)) return ['Yes'];
  }
  return ['No'];
}

const SANCTIONED = ['iran', 'cuba', 'north korea', 'syria', 'crimea', 'donetsk', 'luhansk', 'sudan', 'russia', 'belarus', 'venezuela'];

/**
 * Export control: "Are you a current citizen, national or resident of any of the following countries...?" Yes when
 * the country of residence or a saved citizenship is on the question's list. No only when every citizenship is
 * known (none besides the saved status, or the other ones are listed) and none is on it.
 */
function sanctionedAnswer(label: string, p: Profile): string[] | null {
  const l = ` ${normalize(label)} `;
  const listed = SANCTIONED.filter((c) => l.includes(` ${c} `));
  if (!listed.length) return null;
  const mine = [p.country, ...p.workAuth.otherCountries.split(/[,;/]/)].map((c) => normalize(c)).filter(Boolean);
  if (mine.some((c) => listed.some((x) => c === x || c.includes(x)))) return ['Yes'];
  const other = p.workAuth.otherCitizenship;
  if (other === 'yes' && p.workAuth.otherCountries.trim()) return ['No'];
  // "No other citizenship" settles it only for a U.S. citizen; anyone else's own nationality is not saved.
  if (other === 'no' && citizenship(p) === 'citizen') return ['No'];
  return null;
}

/** One "• " bullet per line, keeping bullets already written with -, *, or •. */
export function bulleted(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `• ${l.replace(/^([-*•‣◦▪]|\d+[.)])\s*/, '')}`)
    .join('\n');
}

const REGIONS: [RegExp, string[]][] = [
  [/^(us|usa|u\.s\.a?\.?|united states( of america)?|canada|mexico)$/i, ['North America', 'Americas', 'NA', 'NAMER']],
  [/^(brazil|argentina|chile|colombia|peru|uruguay|ecuador|bolivia|paraguay|venezuela|costa rica|panama|guatemala)$/i, ['LATAM', 'Latin America', 'South America', 'Americas']],
  [/^(united kingdom|uk|ireland|germany|france|spain|portugal|italy|netherlands|belgium|switzerland|austria|poland|sweden|norway|denmark|finland|czechia|czech republic|romania|greece)$/i, ['Europe', 'EMEA', 'EU']],
  [/^(india|china|japan|south korea|singapore|philippines|vietnam|thailand|malaysia|indonesia|taiwan|hong kong|pakistan|bangladesh)$/i, ['Asia', 'APAC', 'Asia Pacific']],
  [/^(australia|new zealand)$/i, ['APAC', 'Asia Pacific', 'Oceania']],
];

/** Region names a location list may use for the country ("North America" for the US). */
function regionOf(country: string): string[] {
  return REGIONS.find(([re]) => re.test(country.trim()))?.[1] ?? [];
}

/** Education entries worth entering, in profile order. Numbered form sections map onto these. */
export function educationEntries(p: Profile) {
  return p.education.filter((e) => e.school.trim());
}

/** Work history entries worth entering, in profile order. */
export function experienceEntries(p: Profile) {
  return p.experience.filter((x) => x.company.trim() || x.title.trim());
}

/** "06/2025", "2025-06", "June 2025" for a YYYY-MM date. */
function monthYear(yyyyMm: string): string[] | null {
  const m = /^(\d{4})-(\d{2})/.exec(yyyyMm);
  if (!m) return null;
  const name = MONTHS[parseInt(m[2]!, 10) - 1];
  return [`${m[2]}/${m[1]}`, `${m[1]}-${m[2]}`, ...(name ? [`${name} ${m[1]}`] : [])];
}

/** Keys whose values are only safe to pick from a list, never typed free-form. */
export const CHOICE_ONLY_KEYS = new Set<ProfileKey>([
  'graduatingIn',
  'govEmployee',
  'employedAt',
  'nonCompete',
  'otherCitizenship',
  'sanctionedCountry',
  'majorIs',
  'ageAtLeast',
  'textConsent',
  'acknowledge',
  'essentialFunctions',
  'authorizedNoSponsor',
  'livesIn',
  'authorized',
  'usCitizen',
  'citizenshipStatus',
  'usPerson',
  'clearance',
  'clearanceEligible',
  'sponsorship',
  'inUS',
  'relocate',
  'gender',
  'race',
  'hispanic',
  'veteran',
  'disability',
  'declineOnly',
]);

const geo = (s: string) => normalize(s.normalize('NFD').replace(/\p{M}/gu, ''));
function locationCountry(s: string) {
  const n = geo(s);
  if (/^(us|usa|u s|u s a|united states( of america)?)$/.test(n)) return 'united states';
  if (/^(uk|u k|gb|gbr|great britain|united kingdom)$/.test(n)) return 'united kingdom';
  if (/^(ca|can|canada)$/.test(n)) return 'canada';
  if (/^(mx|mex|mexico)$/.test(n)) return 'mexico';
  return n;
}

/** A saved City may already contain its state/country. Strip only qualifiers that
 * agree with the explicit Profile fields; never rewrite the stored Profile or infer a conflicting fact.
 */
export function applicantLocationParts(profile: Pick<Profile, 'city' | 'state' | 'country'>) {
  const parts = profile.city.split(/\s*[,|·]\s*/).map(s => s.trim()).filter(Boolean);
  const city = parts[0] ?? '', country = profile.country.trim(), state = profile.state.trim();
  const states = (locationCountry(country) === 'united states' ? stateVariants(state) ?? [] : [state]).map(geo).filter(Boolean);
  const valid = parts.slice(1).every(p => states.includes(geo(p)) || (!!country && locationCountry(p) === locationCountry(country)));
  return { city, state, country, valid };
}

/** Only complete place searches and a city fallback; no state-only, country-only or truncated fragments. */
export function applicantLocationQueries(profile: Pick<Profile, 'city' | 'state' | 'country'>): string[] {
  const place = applicantLocationParts(profile);
  if (!place.valid || !place.city) return [];
  const fullState = locationCountry(place.country) === 'united states' ? US_STATES[place.state.toUpperCase()] ?? place.state : place.state;
  return [...new Set([
    [place.city, fullState, place.country].filter(Boolean).join(', '),
    [place.city, fullState].filter(Boolean).join(', '), place.city,
  ])];
}

/** Compare geographic components, never shared word fragments or the first search result. */
export function pickApplicantLocation(options: string[], rawProfile: Pick<Profile, 'city' | 'state' | 'country'>, allowBroad = false): number {
  const profile = applicantLocationParts(rawProfile);
  if (!profile.valid) return -1;
  const country = locationCountry;
  const city = geo(profile.city), savedCountry = country(profile.country);
  const states = (savedCountry === 'united states' ? stateVariants(profile.state) ?? [] : [profile.state]).map(geo).filter(Boolean);
  const matches = options.map((label, index) => {
    if (!city || isPlaceholderOption(label)) return -1;
    const parts = label.split(/\s*[,|·]\s*/).map(geo).filter(Boolean);
    if (parts.length > 1) {
      // Exact city boundaries prevent San Jose from matching San Jose del Castillo.
      if (parts[0] !== city) return -1;
      const tail = parts.slice(1);
      const regions = parts.length >= 3 ? tail.slice(0, -1) : tail;
      if (states.length && !regions.some(p => states.includes(p))) return -1;
      if (parts.length >= 3 && savedCountry && country(tail.at(-1)!) !== savedCountry) return -1;
      // A two-component label must explicitly identify the saved state or country.
      if (parts.length === 2 && !states.includes(tail[0]!) && (!savedCountry || country(tail[0]!) !== savedCountry)) return -1;
      return index;
    }
    // Also support punctuation-free complete labels, without substring similarity.
    const countries = savedCountry === 'united states' ? ['United States', 'United States of America', 'US', 'USA', 'U.S.'] : [profile.country];
    const variants = states.flatMap(state => countries.map(c => geo([city, state, c].filter(Boolean).join(' '))));
    if (!states.length && !savedCountry) variants.push(city);
    return variants.includes(geo(label)) ? index : -1;
  }).filter(index => index >= 0);
  // Duplicate or competing place labels are ambiguous, even if the shared city matches.
  if (matches.length) return matches.length === 1 ? matches[0]! : -1;
  // Generic region/state questions still support their explicit, exact saved values.
  // Never take this path for a city question or a list containing geographic place rows.
  if (!allowBroad || options.some(o => /[,|·]/.test(o))) return -1;
  const broad = options.map((label, index) => !isPlaceholderOption(label) &&
    (states.includes(geo(label)) || (!!savedCountry && country(label) === savedCountry) || regionOf(profile.country).some(r => geo(r) === geo(label))) ? index : -1).filter(i => i >= 0);
  return broad.length === 1 ? broad[0]! : -1;
}
