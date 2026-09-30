// Words that appear in many options and say little on their own ("Stanford University" vs "Aalborg University").
const GENERIC_TOKENS = new Set(['university', 'college', 'school', 'institute', 'technology', 'degree', 'state', 'community', 'academy']);

const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'in', 'to', 'and', 'or', 'i', 'my', 'am', 'is', 'are', 'for', 'as', 'with']);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/'s\b/g, '')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t));
}

const DECLINE_RE =
  /decline|prefer not|rather not|not (wish|want) to|don.?t (wish|want)|choose not|not to (answer|say|disclose|self)|wish to not|opt out/i;

export function isDecline(s: string): boolean {
  return DECLINE_RE.test(s);
}

export function isPlaceholderOption(s: string): boolean {
  const n = normalize(s);
  return !n || /^(select|please select|choose|select an? option|select one|click here|none selected)\b/.test(n) || /^-+$/.test(s.trim());
}

function polarity(s: string): 'yes' | 'no' | null {
  const first = normalize(s).split(' ')[0];
  if (first === 'yes' || first === 'y') return 'yes';
  if (first === 'no' || first === 'n') return 'no';
  return null;
}

/** Similarity between a desired value and an option label, 0..1. */
export function similarity(want: string, option: string): number {
  const w = normalize(want);
  const o = normalize(option);
  if (!w || !o) return 0;
  if (w === o) return 1;

  const wantDecline = isDecline(want);
  const optDecline = isDecline(option);
  if (wantDecline || optDecline) return wantDecline && optDecline ? 0.95 : 0;

  const pw = polarity(want);
  const po = polarity(option);
  if (pw && po) {
    if (pw !== po) return 0;
    // "Yes" vs "Yes, I am authorized..." is a match; longer phrases fall through to token overlap.
    if (w === pw) return 0.9;
  } else if (pw && w === pw) {
    return 0;
  }

  if (o.startsWith(`${w} `) || w.startsWith(`${o} `)) return 0.85;

  const wt = [...new Set(tokens(want))];
  const ot = [...new Set(tokens(option))];
  if (!wt.length || !ot.length) return 0;
  const oset = new Set(ot);
  const weight = (ts: string[]) => ts.reduce((sum, t) => sum + (GENERIC_TOKENS.has(t) ? 0.3 : 1), 0);
  const shared = weight(wt.filter((t) => oset.has(t)));
  if (!shared) return 0;
  const dice = (2 * shared) / (weight(wt) + weight(ot));
  const coverage = shared / weight(wt);
  return Math.max(dice, coverage * 0.8);
}

export const MATCH_THRESHOLD = 0.5;

/**
 * Index of the option that best matches any of the candidate values (earlier candidates win ties),
 * or -1 when nothing is close enough. Guessing is worse than leaving a field for the user.
 */
export function bestOption(candidates: string[], options: string[]): number {
  let best = -1;
  let bestScore = 0;
  candidates.forEach((cand, ci) => {
    options.forEach((opt, oi) => {
      if (isPlaceholderOption(opt)) return;
      const score = similarity(cand, opt) - ci * 0.001;
      if (score > bestScore) {
        bestScore = score;
        best = oi;
      }
    });
  });
  return bestScore >= MATCH_THRESHOLD ? best : -1;
}

/** Character limit stated by the field or its label ("max 500 characters", "250 words"). */
export function characterLimitFor(label: string, maxLength?: number): number {
  const DEFAULT = 1500;
  let limit = maxLength && maxLength > 0 && maxLength < 100000 ? maxLength : DEFAULT;
  const chars = label.match(/(\d[\d,]*)\s*(characters|chars|character)/i);
  if (chars?.[1]) limit = Math.min(limit, parseInt(chars[1].replace(/,/g, ''), 10));
  const words = label.match(/(\d[\d,]*)\s*words?/i);
  if (words?.[1]) limit = Math.min(limit, parseInt(words[1].replace(/,/g, ''), 10) * 6);
  return Math.max(100, limit);
}
