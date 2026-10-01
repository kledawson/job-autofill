// Salary answers: use the pay range posted in the job description when there is one,
// otherwise the amount saved in settings.

export interface PayRange {
  low: number;
  high: number;
  hourly: boolean;
  /** Currency code written right after the range, e.g. "USD". */
  currency: string;
}

const AMOUNT = '(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s*([kK])?';
const RANGE_RE = new RegExp(`\\$\\s*${AMOUNT}\\s*(?:-|–|—|to|and)\\s*\\$?\\s*${AMOUNT}`, 'g');

function amount(raw: string, k: string | undefined): number {
  const n = parseFloat(raw.replace(/,/g, ''));
  return k ? n * 1000 : n;
}

/** The pay range stated in a job description, preferring one that sits next to words like "salary" or "compensation". */
export function findPayRange(description: string): PayRange | null {
  let first: PayRange | null = null;
  for (const m of description.matchAll(RANGE_RE)) {
    let low = amount(m[1]!, m[2]);
    const high = amount(m[3]!, m[4]);
    // "$100-120k": the k belongs to both numbers.
    if (!m[2] && m[4] && low < 1000 && high >= 1000) low *= 1000;
    const after = description.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40);
    const hourly = /per hour|\/\s*h(ou)?r|hourly/i.test(after);
    const plausible = hourly ? low >= 8 && high <= 500 : low >= 15000 && high <= 2_000_000;
    if (!plausible || high < low) continue;
    const currency = /^\s*(USD|CAD|EUR|GBP|AUD)\b/i.exec(after)?.[1]?.toUpperCase() ?? '';
    const range = { low, high, hourly, currency };
    const before = description.slice(Math.max(0, (m.index ?? 0) - 200), m.index ?? 0);
    if (/salary|pay|compensation|base|range|ote|wage/i.test(before)) return range;
    first ??= range;
  }
  return first;
}

export function formatAmount(n: number, hourly: boolean): string {
  return hourly ? `$${Math.round(n)}/hour` : `$${(Math.round(n / 1000) * 1000).toLocaleString('en-US')}`;
}

/** Numbers in a saved salary like "$100k-$120k" or "$120,000". */
function savedAmounts(text: string): number[] {
  return Array.from(text.matchAll(new RegExp(`\\$?\\s*${AMOUNT}`, 'g')))
    .map((m) => amount(m[1]!, m[2]))
    .filter((n) => n >= 8);
}

/**
 * Candidate answers for a salary question, best first, or null when nothing is known.
 * A posted range answers a range question with the range and a single-value question with a figure
 * a bit above the midpoint (a quarter of the way down from the top: $100k-$120k becomes $115k).
 * With no posted range, the saved amount is used; a saved range given to a single-value question
 * becomes its lowest value.
 */
export function salaryAnswer(saved: string, description: string, label: string): string[] | null {
  const wantsRange = /\brange\b/i.test(label);
  const posted = findPayRange(description);
  if (posted) {
    const { low, high, hourly, currency } = posted;
    const unit = currency ? ` ${currency}` : '';
    return wantsRange
      ? [`${formatAmount(low, hourly)} - ${formatAmount(high, hourly)}${unit}`]
      : [`${formatAmount(low + 0.75 * (high - low), hourly)}${unit}`];
  }
  const text = saved.trim();
  if (!text) return null;
  const nums = savedAmounts(text);
  if (nums.length >= 2 && !wantsRange) return [formatAmount(Math.min(...nums), nums[0]! < 500)];
  return [text];
}
