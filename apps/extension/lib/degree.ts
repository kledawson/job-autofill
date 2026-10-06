// Degree type ("Bachelor's Degree") and field of study ("Computer Science") are kept apart so each can
// fill its own field on an application form.

/** Specific degrees offered in the profile, so forms listing "Bachelor of Science" can be answered exactly. */
export const SPECIFIC_DEGREES = [
  'Bachelor of Science',
  'Bachelor of Arts',
  'Bachelor of Engineering',
  'Bachelor of Business Administration',
  'Bachelor of Fine Arts',
  'Master of Science',
  'Master of Arts',
  'Master of Engineering',
] as const;

export const DEGREE_TYPES = [
  "Associate's Degree",
  "Bachelor's Degree",
  "Master's Degree",
  'MBA',
  'Doctorate (Ph.D.)',
  'High School Diploma / GED',
] as const;

// Keep specific bachelor's qualifications apart: BS and BA have the same level, but are not
// interchangeable when a form offers both. The first entry is the full name of each qualification.
const BACHELOR_ALIASES = [
  ['Bachelor of Science', 'BS', 'B.S.', 'B S', 'BSc', 'B.Sc.', 'B Sc', 'SB', 'S.B.'],
  ['Bachelor of Arts', 'BA', 'B.A.', 'B A', 'AB', 'A.B.'],
  ['Bachelor of Engineering', 'BE', 'B.E.', 'BEng', 'B.Eng.'],
  ['Bachelor of Business Administration', 'BBA', 'B.B.A.'],
  ['Bachelor of Fine Arts', 'BFA', 'B.F.A.'],
  ['Bachelor of Applied Science', 'BASc', 'B.A.Sc.'],
  ['Bachelor of Technology', 'BTech', 'B.Tech.'],
  ['Bachelor of Education', 'BEd', 'B.Ed.'],
  ['Bachelor of Commerce', 'BCom', 'B.Com.'],
] as const;

const degreeSpelling = (s: string) => s.toLowerCase().replace(/[.‘’ʼ']/g, '').replace(/\bbachelors\b/g, 'bachelor').replace(/\s+/g, ' ').trim();

/** Equivalent names for a specific bachelor's qualification; empty for a generic bachelor's degree. */
export function bachelorDegreeAliases(degree: string): string[] {
  const d = degreeSpelling(degree);
  const group = BACHELOR_ALIASES.find((aliases) => aliases.some((alias) => {
    const a = degreeSpelling(alias);
    return d === a || d.startsWith(`${a} `) || d.startsWith(`${a}(`) || d.startsWith(`${a},`);
  }));
  return group ? [...group] : [];
}

const DEGREE_START =
  /^((?:bachelor|master|doctor)s?(?:'s|’s)?(?: of (?:applied science|science|arts|engineering|business administration|fine arts|technology|education|commerce))?|ph\.?\s?d\.?|associate(?:'s|’s)?(?: of (?:science|arts))?|b\.?\s?[sa]\.?(?:c\.?)?|m\.?\s?[sa]\.?(?:c\.?)?|mba|b\.?\s?eng\.?|m\.?\s?eng\.?|b\.?\s?[bf]\.?(?:a\.?)|b\.?\s?a\.?\s?sc\.?|b\.?\s?(?:tech|ed|com)\.?|[as]\.?\s?b\.?|b\.?\s?e\.?)(?:\s+degree)?(?=[\s,:-]|$)(?!\s+(?:of|degree)\b)[\s,:-]*(?:in\s+)?(.+)$/i;

/** A degree saved as "B.S. Computer Science" is the degree "B.S." and the field "Computer Science". */
export function splitDegree(e: { degree: string; major: string }): { degree: string; major: string } {
  const degree = e.degree.trim();
  const major = e.major.trim();
  if (major) return { degree, major };
  const m = DEGREE_START.exec(degree);
  return m ? { degree: m[1]!.trim().replace(/[,:-]$/, ''), major: m[2]!.trim() } : { degree, major };
}

/** The standard degree type for wording like "B.S.", "Bachelor of Arts", or "Master's"; '' when unrecognized. */
export function standardDegree(degree: string): string {
  const d = degree.toLowerCase().replace(/[.’]/g, (c) => (c === '’' ? "'" : '')).trim();
  if (!d) return '';
  if (/^mba\b|business administration/.test(d) && /master|^mba/.test(d)) return 'MBA';
  if (/ph\s?d|doctor/.test(d)) return 'Doctorate (Ph.D.)';
  if (/master|^m\s?[sa]\b|^m\s?sc\b|^m\s?eng\b/.test(d)) return "Master's Degree";
  if (/bachelor|^baccalaureate(?: degree)?(?:$|\s+in\b)|^b\s?[sa]\b|^b\s?sc\b|^b\s?eng\b|undergrad/.test(d) || bachelorDegreeAliases(degree).length) return "Bachelor's Degree";
  if (/associate|^a\s?[as]\b/.test(d)) return "Associate's Degree";
  if (/high school|^ged\b|diploma/.test(d)) return 'High School Diploma / GED';
  return '';
}

const HONORS_RE = /\b(honou?rs?|distinction|cum laude|dean'?s list|valedictorian|salutatorian|with highest|summa|magna)\b/i;
const MINOR_RE = /\b(minor(?:ing)?|concentration|certificate|emphasis|specializ(?:ation|ing)|track)\b/i;
const NOISE_MAJOR_RE = /^(the )?major$|^major$|^n\/?a$/i;

export interface ParsedDegree {
  degree: string;
  major: string;
  honors: string;
}

/**
 * Reads one resume degree line such as "B.S. Computer Science, Honors in the Major" or
 * "Bachelor of Science (B.S.) in Computer Science with Honors" into the degree, the field of study,
 * and any honors, keeping minors, GPA, and honors out of the field of study.
 */
export function parseDegreeLine(raw: string): ParsedDegree {
  let text = raw.replace(/\((?:[A-Za-z]\.?){1,5}\)/g, ' ').replace(/\s+/g, ' ').trim();
  const honors: string[] = [];
  // "... in Computer Science with Honors"
  const tail = /\s+with\s+((?:highest |high |great )?(?:honou?rs?|distinction)\b.*)$/i.exec(text);
  if (tail) {
    honors.push(tail[1]!.trim());
    text = text.slice(0, tail.index);
  }
  const core: string[] = [];
  for (const clause of text.split(/\s*[;,]\s*/).map((c) => c.trim()).filter(Boolean)) {
    if (HONORS_RE.test(clause)) honors.push(clause.replace(/^with\s+/i, ''));
    else if (/\bgpa\b/i.test(clause) || /^\d\.\d/.test(clause)) continue;
    else if (MINOR_RE.test(clause) && !DEGREE_START.test(clause)) continue;
    else core.push(clause);
  }

  const cleanMajor = (m: string) => {
    const t = m
      .replace(/^(?:major(?:ing)?\s*(?:in|:)?\s*|in\s+)/i, '')
      .replace(/\s*[,;]?\s*\b(minor|concentration)\b.*$/i, '')
      .replace(/[\s,.:-]+$/, '')
      .trim();
    return NOISE_MAJOR_RE.test(t) ? '' : t;
  };

  let degree = '';
  let major = '';
  const [first = '', second = ''] = core;
  const asDegree = splitDegree({ degree: first, major: '' });
  if (standardDegree(asDegree.degree) || DEGREE_START.test(first) || standardDegree(first)) {
    degree = asDegree.degree;
    major = cleanMajor(asDegree.major);
    if (!major && second && !standardDegree(second)) major = cleanMajor(second);
  } else if (second && standardDegree(second)) {
    // "Computer Science, B.S."
    degree = splitDegree({ degree: second, major: '' }).degree;
    major = cleanMajor(first);
  } else {
    degree = first;
  }
  return { degree, major, honors: honors.join('; ') };
}

/** True when text starts with a degree ("B.S. Computer Science, …"), so a field holding it is not just honors. */
export function startsWithDegree(text: string): boolean {
  return DEGREE_START.test(text.trim()) || !!standardDegree(text.trim());
}
