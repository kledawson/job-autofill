import { DECLINE, type Profile, type YesNo } from '../types';
import type { ProfileKey } from './classify';

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

function degreeVariants(degree: string): string[] {
  const d = degree.toLowerCase();
  const out = [degree];
  if (/bachelor|\bb\.?s\.?\b|\bb\.?a\.?\b|\bbsc\b|undergrad/.test(d)) out.push("Bachelor's Degree", 'Bachelor', "Bachelor's");
  else if (/master|\bm\.?s\.?\b|\bm\.?a\.?\b|\bmsc\b|mba/.test(d)) out.push("Master's Degree", 'Master', "Master's");
  else if (/ph\.?d|doctor/.test(d)) out.push('Doctor of Philosophy (Ph.D.)', 'Ph.D.', 'Doctorate');
  else if (/associate/.test(d)) out.push("Associate's Degree", 'Associate');
  else if (/high school|ged/.test(d)) out.push('High School', 'High School Diploma');
  return out;
}

function eeo(value: string): string[] | null {
  const v = value.trim();
  if (!v) return null;
  return v === DECLINE ? DECLINE_VARIANTS : [v];
}

/** Reuse an explicit US Citizen category, never infer from residence or work eligibility. */
export function usCitizenshipAnswer(p: Profile): YesNo {
  if (p.workAuth.usCitizen) return p.workAuth.usCitizen;
  return [p.workAuth.status, p.workAuth.exportStatus].some(v => /^(us|u\.s\.?|united states) citizen$/i.test(v.trim())) ? 'yes' : '';
}

function nonEmpty(...values: (string | undefined)[]): string[] | null {
  const out = values.map((v) => v?.trim() ?? '').filter(Boolean);
  return out.length ? Array.from(new Set(out)) : null;
}

function schoolVariants(school: string): string[] | null {
  const uc = /^uc\s+(.+)$/i.exec(school.trim());
  const expanded = /^sjsu$/i.test(school.trim())
    ? 'San Jose State University'
    : uc ? `University of California, ${uc[1]}` : undefined;
  return nonEmpty(school, expanded);
}

/** Search official names first; shorten queries only when no matching option returns. */
export function schoolSearchQueries(candidates: string[]): string[] {
  const official = candidates[1] ?? candidates[0] ?? '';
  const shorter = official.replace(/\b(university|college|of|the)\b/gi, '').replace(/[,\s]+/g, ' ').trim();
  return [...new Set([official, candidates[0] ?? '', shorter].filter(Boolean))];
}

function isUS(country: string): boolean | null {
  if (!country.trim()) return null;
  return /^(us|usa|u\.s\.a?\.?|united states( of america)?)$/i.test(country.trim());
}

/**
 * Candidate values for a profile key, best first. Several candidates let option matching
 * handle "Bachelor's Degree" vs "BS", or "January" vs "01". Null when the profile has no value.
 */
export function valueFor(key: ProfileKey, p: Profile): string[] | null {
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
    case 'phone':
      return nonEmpty(p.phone);
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
    case 'phoneCountryCode':
      return isUS(p.country) ? ['+1', '1', 'United States (+1)', 'United States +1', 'US +1'] : null;
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
      return nonEmpty(job?.company);
    case 'currentTitle':
      return nonEmpty(p.currentTitle || job?.title);
    case 'school':
      return edu?.school ? schoolVariants(edu.school) : null;
    case 'degree':
      return edu?.degree ? degreeVariants(edu.degree) : null;
    case 'major':
      return nonEmpty(edu?.major);
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
      if (p.workAuth.authorizedUS === 'yes' && p.workAuth.authorizationScope === 'any-employer') {
        return ['I am authorized to work in the United States for any employer', 'Yes'];
      }
      if (p.workAuth.authorizedUS === 'no') return ['No', 'I am not authorized to work in the United States'];
      return yesNo(p.workAuth.authorizedUS);
    case 'usCitizen':
      return usCitizenshipAnswer(p) === 'yes'
        ? ['Yes', 'US Citizen', 'Yes, I am currently a US Citizen']
        : usCitizenshipAnswer(p) === 'no' ? ['No', 'Not a US Citizen', 'No, I am not a US Citizen'] : null;
    case 'citizenshipCountry':
      return nonEmpty(p.workAuth.citizenshipCountry);
    case 'exportStatus':
      return nonEmpty(p.workAuth.exportStatus);
    case 'activeClearance':
      return nonEmpty(p.workAuth.activeClearance);
    case 'clearanceEligible':
      return yesNo(p.workAuth.clearanceEligible);
    case 'sponsorship':
      return yesNo(p.workAuth.needsSponsorship);
    case 'inUS': {
      const us = isUS(p.country);
      return us === null ? null : [us ? 'Yes' : 'No'];
    }
    case 'relocate':
      return yesNo(p.preferences.relocate);
    case 'salary':
      return nonEmpty(p.preferences.salary);
    case 'startDate':
      return nonEmpty(p.preferences.startDate);
    case 'workMode': {
      const mode = p.preferences.workMode;
      const labels: Record<string, string[]> = {
        remote: ['Remote'],
        hybrid: ['Hybrid'],
        onsite: ['On-site', 'Onsite', 'In office'],
        flexible: ['Flexible', 'Open to any', 'Any'],
      };
      return (mode && labels[mode]) || null;
    }
    case 'howHeard':
      return nonEmpty(p.preferences.howHeard);
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
      return null;
  }
}

/** Keys whose values are only safe to pick from a list, never typed free-form. */
export const CHOICE_ONLY_KEYS = new Set<ProfileKey>([
  'usCitizen', 'exportStatus', 'activeClearance', 'clearanceEligible',
  'authorized',
  'sponsorship',
  'inUS',
  'phoneCountryCode',
  'relocate',
  'gender',
  'race',
  'hispanic',
  'veteran',
  'disability',
  'declineOnly',
]);

/** Keys where the first search result is acceptable when no option matches by text. */
export const SEARCH_FIRST_RESULT_KEYS = new Set<ProfileKey>(['location', 'school']);
