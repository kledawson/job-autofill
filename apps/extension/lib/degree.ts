// Degree type ("Bachelor's Degree") and field of study ("Computer Science") are kept apart so each can
// fill its own field on an application form.

export const DEGREE_TYPES = [
  "Associate's Degree",
  "Bachelor's Degree",
  "Master's Degree",
  'MBA',
  'Doctorate (Ph.D.)',
  'High School Diploma / GED',
] as const;

const DEGREE_START =
  /^((?:bachelor|master|doctor)s?(?:'s|’s)?(?: of (?:science|arts|engineering|business administration|fine arts))?|ph\.?\s?d\.?|associate(?:'s|’s)?(?: of (?:science|arts))?|b\.?\s?[sa]\.?(?:c\.?)?|m\.?\s?[sa]\.?(?:c\.?)?|mba|b\.?\s?eng\.?|m\.?\s?eng\.?)(?=[\s,:-])[\s,:-]*(?:in\s+)?(.+)$/i;

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
  if (/bachelor|^b\s?[sa]\b|^b\s?sc\b|^b\s?eng\b|undergrad/.test(d)) return "Bachelor's Degree";
  if (/associate|^a\s?[as]\b/.test(d)) return "Associate's Degree";
  if (/high school|^ged\b|diploma/.test(d)) return 'High School Diploma / GED';
  return '';
}
