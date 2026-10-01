import { DECLINE, type Profile, type YesNo } from '../types';
import type { ProfileKey } from './classify';
import { normalize } from './match';
import { splitDegree, standardDegree } from '../degree';
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
  const out = Array.from(new Set([degree, raw]));
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
  'black or african american': ['Black', 'African American'],
  white: ['Caucasian', 'White (Not Hispanic or Latino)'],
  asian: ['Asian (Not Hispanic or Latino)'],
  'american indian or alaska native': ['Native American', 'American Indian'],
  'native hawaiian or other pacific islander': ['Pacific Islander', 'Native Hawaiian'],
  'two or more races': ['Two or more', 'Multiracial', 'Mixed'],
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

function nonEmpty(...values: (string | undefined)[]): string[] | null {
  const out = values.map((v) => v?.trim() ?? '').filter(Boolean);
  return out.length ? Array.from(new Set(out)) : null;
}

function isUS(country: string): boolean | null {
  if (!country.trim()) return null;
  return /^(us|usa|u\.s\.a?\.?|united states( of america)?)$/i.test(country.trim());
}

/**
 * Candidate values for a profile key, best first. Several candidates let option matching
 * handle "Bachelor's Degree" vs "BS", or "January" vs "01". Null when the profile has no value.
 */
export function valueFor(key: ProfileKey, p: Profile, opts: { phoneWithCode?: boolean; yesNo?: boolean; now?: Date; label?: string; description?: string } = {}): string[] | null {
  const edu = p.education.find((e) => e.school) ?? p.education[0];
  const job = p.experience.find((x) => x.current) ?? p.experience.find((x) => x.company);
  switch (key) {
    case 'fullName':
      return nonEmpty([p.firstName, p.lastName].filter(Boolean).join(' '));
    case 'firstName':
      return nonEmpty(p.firstName);
    case 'lastName':
      return nonEmpty(p.lastName);
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
    case 'textConsent':
      return [p.textConsent ? 'Yes' : 'No'];
    case 'age':
      return nonEmpty(p.age);
    case 'address':
      return nonEmpty(p.address);
    case 'city':
      return nonEmpty(p.city);
    case 'state':
      return nonEmpty(p.state);
    case 'zip':
      return nonEmpty(p.zip);
    case 'country':
      return isUS(p.country) ? ['United States', 'United States of America', 'USA', 'US'] : nonEmpty(p.country);
    case 'cityStateZip': {
      const line = [[p.city, p.state].filter(Boolean).join(', '), p.zip].filter(Boolean).join(' ');
      return nonEmpty(line, [p.city, p.state].filter(Boolean).join(', '));
    }
    case 'cityState':
      return nonEmpty([p.city, p.state].filter(Boolean).join(', '), p.city);
    case 'location':
      return nonEmpty(
        [p.city, p.state].filter(Boolean).join(', '),
        [p.city, p.state, p.country].filter(Boolean).join(', '),
        p.city,
      );
    case 'linkedin':
      return nonEmpty(p.linkedin);
    case 'github':
      return nonEmpty(p.github);
    case 'portfolio':
      return nonEmpty(p.portfolio || p.website);
    case 'website':
      return nonEmpty(p.website || p.portfolio || p.github);
    case 'currentCompany':
      return [p.currentCompany.trim() || 'N/A'];
    case 'currentTitle':
      return [p.currentTitle.trim() || 'N/A'];
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
    case 'gradDate': {
      const m = /^(\d{4})-(\d{2})/.exec(edu?.endDate ?? '');
      return m ? [`${m[2]}/${m[1]}`] : null;
    }
    case 'authorized':
      return yesNo(p.workAuth.authorizedUS);
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
    case 'startDate':
      return p.preferences.startDate.trim() ? chosenStartDate(p.preferences.startDate) : twoWeeksOut(opts.now ?? new Date());
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
    case 'race':
      return eeo(p.eeo.race);
    case 'hispanic':
      return eeo(p.eeo.hispanic);
    case 'veteran':
      return eeo(p.eeo.veteran);
    case 'disability':
      return eeo(p.eeo.disability);
    case 'declineOnly':
      return DECLINE_VARIANTS;
    case 'resume':
    case 'coverLetter':
    case 'transcript':
      return null;
  }
}

/** Keys whose values are only safe to pick from a list, never typed free-form. */
export const CHOICE_ONLY_KEYS = new Set<ProfileKey>([
  'ageAtLeast',
  'textConsent',
  'acknowledge',
  'authorizedNoSponsor',
  'livesIn',
  'authorized',
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

/** Keys never guessed from the top dropdown option when nothing matches. */
/** Keys where guessing the top search result beats leaving the field empty ("San Jose, CA, United States"). */
export const TOP_OPTION_KEYS = new Set<ProfileKey>(['location', 'city']);


/** Keys where the first search result is acceptable when no option matches by text. */
export const SEARCH_FIRST_RESULT_KEYS = new Set<ProfileKey>(['location']);
