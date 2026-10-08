import { standardDegree } from './degree';
import { questionMeaning } from './answer-semantics';
import type { Profile } from './types';
export function educationLevel(degree: string): string {
  const d = standardDegree(degree).toLowerCase();
  return /bachelor/.test(d) ? 'undergraduate' : /master/.test(d) ? 'graduate' : /doctor/.test(d) ? 'doctoral' : 'other';
}
/** Returns a stored entry index only when the question identifies one education record. */
export function educationFactIndex(profile: Profile, label: string, sectionIndex?: number): number | null {
  const meaning = questionMeaning(label);
  const qualifier = meaning?.intent === 'gpa' ? meaning.qualifier : meaning?.intent === 'degree' ? meaning.qualifier.split(':')[0] : 'unspecified';
  let index: number;
  if (sectionIndex !== undefined) {
    const entry = profile.education.filter(e => e.school.trim())[sectionIndex];
    index = entry ? profile.education.indexOf(entry) : profile.education.length === 1 && sectionIndex === 0 ? 0 : -1;
  } else if (qualifier !== 'unspecified') {
    const matches = profile.education.map((e, i) => educationLevel(e.degree) === qualifier ? i : -1).filter(i => i >= 0);
    if (matches.length !== 1) return null;
    index = matches[0]!;
  } else if (profile.education.length === 1) index = 0;
  else return null;
  const entry = profile.education[index];
  return !entry || (qualifier !== 'unspecified' && educationLevel(entry.degree) !== qualifier) ? null : index;
}

/** Lossless exact score on a 4.0 scale; ranges and other scales are not applicant facts. */
export function parseExactGpa(value: string): string | null {
  const score = /^(\d(?:\.\d{1,3})?)(?:\s*(?:out of|of|\/)\s*4(?:\.0)?)?$/.exec(value.trim());
  return score && +score[1]! <= 4 ? score[1]! : null;
}
