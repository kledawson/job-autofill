import type { Profile } from './types';

/** Most recent start date first; entries without a start date go last. */
export const byStartDesc = <T extends { startDate: string }>(items: T[]): T[] =>
  items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (b.item.startDate || '').localeCompare(a.item.startDate || '') || a.i - b.i)
    .map(({ item }) => item);

export const sortProfileEntries = (p: Profile): Profile => ({
  ...p,
  education: byStartDesc(p.education),
  experience: byStartDesc(p.experience),
});
