// Recognizes where a job is ("Remote", "Austin, TX", "London, United Kingdom") so it can be kept
// out of the company and title, which resumes often write on the same line ("Acme, Remote").

const STATE_CODES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|PR';
const STATE_NAMES =
  'alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|district of columbia|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|puerto rico';
const COUNTRIES =
  'usa|u\\.s\\.a?\\.?|us|united states|uk|u\\.k\\.|united kingdom|england|scotland|ireland|canada|mexico|brazil|india|china|japan|korea|south korea|taiwan|hong kong|singapore|philippines|vietnam|indonesia|australia|new zealand|germany|france|spain|portugal|italy|netherlands|belgium|switzerland|austria|sweden|norway|denmark|finland|poland|israel|uae|united arab emirates';
const REGIONS = `${STATE_NAMES}|${COUNTRIES}`;

const MODE = '(?:fully |100% )?(?:remote|hybrid|on-?site|in-?person|in office|virtual)';
// "Remote", "Remote (US)", "Remote - USA", "US Remote".
const MODE_RE = new RegExp(`^(?:(?:${REGIONS}) )?${MODE}(?:\\s*(?:[-–—(,]\\s*)?(?:${REGIONS})\\)?)?$`, 'i');
const CITY = "[A-Za-z][A-Za-z.'’-]*(?: [A-Za-z][A-Za-z.'’-]*){0,3}";
// State codes are matched in capitals only, so "Acme, Co" is not Colorado: "Austin, TX", "Austin, TX 78701, USA".
const CITY_CODE_RE = new RegExp(`^${CITY}, *(?:${STATE_CODES})(?: +\\d{5})?(?:, *(?:USA|US|U\\.S\\.A?\\.?|United States))?$`);
// "Austin, Texas", "London, United Kingdom", "Munich, Bavaria, Germany" is not covered.
const CITY_REGION_RE = new RegExp(`^${CITY}, *(?:${REGIONS})(?:, *(?:${COUNTRIES}))?$`, 'i');
const REGION_RE = new RegExp(`^(?:${REGIONS})$`, 'i');

const clean = (s: string) => s.trim().replace(/^\((.*)\)$/, '$1').replace(/[.,;]+$/, '').trim();

/** True when the text is only a job location. */
export function isJobLocation(s: string): boolean {
  const t = clean(s);
  return !!t && (MODE_RE.test(t) || CITY_CODE_RE.test(t) || CITY_REGION_RE.test(t));
}

/**
 * Splits a location written after a name: "Majorly, Remote" → Majorly + Remote,
 * "Acme Corp (Austin, TX)" → Acme Corp + Austin, TX. Returns an empty location when there is none.
 */
export function splitJobLocation(s: string): { name: string; location: string } {
  const text = s.trim();
  const paren = /^(.*\S)\s*\(([^()]+)\)$/.exec(text);
  if (paren && isJobLocation(paren[2]!)) return { name: paren[1]!.replace(/[,\s–—-]+$/, ''), location: paren[2]!.trim() };
  const parts = text.split(/\s*,\s*/);
  // Longest location first, so "Acme, Austin, TX" keeps "Austin, TX" together; the name must not be empty.
  for (let k = Math.min(3, parts.length - 1); k >= 1; k--) {
    const location = parts.slice(-k).join(', ');
    const name = parts.slice(0, -k).join(', ');
    // A lone state or country counts only after a comma: "Acme, California".
    if (name && (isJobLocation(location) || REGION_RE.test(clean(location)))) return { name, location: location.replace(/[.;]+$/, '') };
  }
  // "Majorly – Remote" or "Majorly | Remote", when the separator was not split already.
  const dash = /^(.*\S)\s+[–—|-]\s+(.+)$/.exec(text);
  if (dash && isJobLocation(dash[2]!)) return { name: dash[1]!, location: dash[2]!.trim() };
  return { name: text, location: '' };
}
