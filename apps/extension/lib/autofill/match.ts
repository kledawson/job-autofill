// Words that appear in many options and say little on their own ("Stanford University" vs "Aalborg University").
const GENERIC_TOKENS = new Set(['university', 'college', 'school', 'institute', 'technology', 'degree', 'state', 'community', 'academy']);

const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'in', 'to', 'and', 'or', 'i', 'my', 'am', 'is', 'are', 'for', 'as', 'with']);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
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
  if (/veteran/.test(w) && /veteran/.test(o)) {
    const negative = (s: string) => /\b(not|no|non|never)\b/.test(s);
    if (negative(w) !== negative(o)) return 0;
  }
  if (/^(secret|top secret|confidential|public trust|top secret sci)$/.test(w)) return 0;
  if (/authori[sz]ed/.test(w) && /authori[sz]ed/.test(o)) {
    const negative = (s: string) => /not authori[sz]ed|unauthori[sz]ed|\bno\b/.test(s);
    if (negative(w) !== negative(o)) return 0;
  }

  // These saved categories assert precise eligibility facts. Similar vocabulary
  // is insufficient ("never held" is different from "no active clearance").
  if (/any employer|specific employer|never held a clearance|us citizen|lawful permanent resident|qualifying asylee/.test(w)) {
    if (/any employer/.test(w)) return /any employer/.test(o) && !/not authorized|not authorised|unauthorized|specific employer/.test(o) ? 0.95 : 0;
    if (/never held a clearance/.test(w)) return /never (held|had).*clearance/.test(o) ? 0.95 : 0;
    // Positive and negative citizenship statements must never fuzzy-match.
    if (/us citizen/.test(w)) {
      const negative = (s: string) => /\b(no|not|non|never)\b/.test(s);
      if (negative(w) !== negative(o)) return 0;
      if (/permanent resident|asylee|or/.test(o)) return 0;
    }
    if (/lawful permanent resident|qualifying asylee/.test(w)) return o.includes(w) ? 0.95 : 0;
  }

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

/**
 * A search result can use an expanded display name ("San Jose, California"),
 * so compare distinctive query words before accepting a filtered first result.
 */
export function firstSearchResultIsRelevant(query: string, result: string): boolean {
  const queryTokens = [...new Set(tokens(query).filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t)))];
  const resultTokens = new Set(tokens(result));
  if (!queryTokens.length) return false;
  const shared = queryTokens.filter((t) => resultTokens.has(t)).length;
  // Search widgets filter options using the full query. A single distinctive shared
  // token is enough to accept their first result (for example, "UC Berkeley" →
  // "University of California, Berkeley", where only "Berkeley" is distinctive).
  return shared >= 1;
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
