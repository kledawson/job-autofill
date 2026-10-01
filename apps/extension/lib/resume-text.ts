// Reads a resume's text locally, without AI. Contact details and links are reliable;
// education, experience, and skills are best-effort because resume layouts vary.
import { sanitizeDraft, type ResumeDraft } from './resume';
import { parseDegreeLine } from './degree';
import type { Education, Experience } from './types';

// --- Dates -------------------------------------------------------------------

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const SEASON = '(?:spring|summer|fall|autumn|winter)';
const YEAR = "(?:(?:19|20)\\d{2}|['’]\\d{2}(?!\\d))";
const DAY = '\\d{1,2}(?:st|nd|rd|th)?';
const DATE = `(?:(?:${MONTH}|${SEASON})\\s+${DAY},?\\s+${YEAR}|\\d{1,2}\\/\\d{1,2}\\/${YEAR}|(?:${MONTH}|${SEASON}),?\\s*${YEAR}|\\d{1,2}\\/${YEAR}|${YEAR})`;
const END = `(?:(?:expected|anticipated|exp\\.?|projected|est\\.?)\\s*:?\\s*)?(?:${DATE}|present|current|now|ongoing|today)`;
const RANGE_RE = new RegExp(`(${DATE})\\s*(?:-|–|—|to|until)\\s*(${END})`, 'i');
// "May – August 2025": the year is written once, after the second month.
const SHARED_RE = new RegExp(`(${MONTH})\\s*(?:-|–|—|to)\\s*(${MONTH})\\s*(?:${DAY},?\\s*)?(${YEAR})`, 'i');
const SINGLE_RE = new RegExp(`(?:expected|anticipated|graduat\\w*|class of)?:?\\s*(${DATE})`, 'i');

const MONTH_NUM: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  spring: 1, summer: 6, fall: 9, autumn: 9, winter: 12,
};
// A season that ends a range ("Fall 2022 – Spring 2026") means the end of that term.
const SEASON_END: Record<string, number> = { spring: 5, summer: 8, fall: 12, autumn: 12, winter: 3 };

/** "Jun 2025" → "2025-06", "06/15/2025" → "2025-06", "Jun '25" → "2025-06", "2025" → "2025-01", "Present" → "". */
export function toMonth(s: string, isEnd = false): string {
  const t = s.trim().toLowerCase().replace(/^(expected|anticipated|exp\.?|projected|est\.?)\s*:?\s*/, '');
  let year = /((?:19|20)\d{2})/.exec(t)?.[1];
  if (!year) {
    const short = /['’](\d{2})(?!\d)/.exec(t)?.[1];
    if (short) year = `${parseInt(short, 10) > 60 ? '19' : '20'}${short}`;
  }
  if (!year) return '';
  const slash = /^(\d{1,2})\//.exec(t);
  if (slash) return `${year}-${slash[1]!.padStart(2, '0')}`;
  const word = /^[a-z]+/.exec(t)?.[0];
  const season = word && isEnd ? SEASON_END[word] : undefined;
  const n = season ?? (word ? MONTH_NUM[word.slice(0, 3)] ?? MONTH_NUM[word] : undefined);
  return `${year}-${String(n ?? 1).padStart(2, '0')}`;
}

function dateRange(text: string): { start: string; end: string; current: boolean; match: string } | null {
  const m = RANGE_RE.exec(text);
  if (m) {
    const current = /present|current|now|ongoing|today/i.test(m[2]!);
    return { start: toMonth(m[1]!), end: current ? '' : toMonth(m[2]!, true), current, match: m[0] };
  }
  const shared = SHARED_RE.exec(text);
  if (shared) {
    const year = shared[3]!;
    return { start: toMonth(`${shared[1]} ${year}`), end: toMonth(`${shared[2]} ${year}`, true), current: false, match: shared[0] };
  }
  return null;
}

// --- Sections ----------------------------------------------------------------

type Section = 'header' | 'education' | 'experience' | 'skills' | 'other';

const HEADINGS: [Section, RegExp][] = [
  ['education', /^(education|academic background|academics)$/],
  ['experience', /^((work|professional|relevant|industry|research|internship|employment)\s+)?(experience|history|experiences)$|^(employment|internships?|work)$/],
  ['skills', /^((technical|core|key|relevant)\s+)?skills( (and|&) (interests|tools|technologies))?$|^(technologies|tools|technical proficiencies)$/],
  ['other', /^(projects?|personal projects|academic projects|leadership|activities|extracurriculars?|awards?|honors( (and|&) awards)?|certifications?|publications|volunteer(ing| experience)?|summary|objective|profile|interests|(relevant )?coursework|involvement|languages|references)$/],
];

function headingOf(line: string): Section | null {
  const t = line.toLowerCase().replace(/[^a-z& ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.split(' ').length > 5) return null;
  for (const [section, re] of HEADINGS) if (re.test(t)) return section;
  return null;
}

// --- Contact details -----------------------------------------------------------

const EMAIL_RE = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const PHONE_RE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const STATES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
// Spaces only (no newlines), so a name on the line above is never pulled into the city.
const LOCATION_RE = new RegExp(`\\b([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,3}), *(${STATES})\\b(?: +(\\d{5}))?`);
const BULLET_RE = /^[•●▪◦‣⁃∙·*–-]\s*/;
const SEPARATORS = /\s*(?:\t|\s\|\s|\|\s*|\s•\s|\s·\s|\s⋄\s|\s◆\s|\s—\s|\s–\s)\s*/;

function titleCase(s: string): string {
  return s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s;
}

function findName(header: string[]): { first: string; last: string } {
  for (const line of header.slice(0, 4)) {
    const candidate = line.split(SEPARATORS)[0]!.trim();
    if (EMAIL_RE.test(candidate) || /\d/.test(candidate)) continue;
    const words = candidate.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && /^[A-Za-zÀ-ÿ .'-]+$/.test(candidate)) {
      const clean = words.map(titleCase);
      return { first: clean[0]!, last: clean[clean.length - 1]! };
    }
  }
  return { first: '', last: '' };
}

function findLinks(text: string, annotations: string[]) {
  const withoutEmails = text.replace(new RegExp(EMAIL_RE.source, 'g'), ' ');
  const all = [...annotations, ...(withoutEmails.match(/(?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)+(?:\/[\w\-./#?=%&~]*)?/g) ?? [])];
  const out = { linkedin: '', github: '', portfolio: '' };
  for (const raw of all) {
    const url = raw.replace(/[.,;)]+$/, '');
    if (/@/.test(url) || /^mailto:|^tel:/i.test(url)) continue;
    if (!out.linkedin && /linkedin\.com\/in\//i.test(url)) out.linkedin = url;
    else if (!out.github && /github\.com\/[\w-]+/i.test(url) && !/github\.com\/?$/i.test(url)) out.github = url;
    else if (
      !out.portfolio &&
      !/linkedin\.com|github\.com|gmail|yahoo|outlook|hotmail|icloud|\.edu\b/i.test(url) &&
      /\.(com|dev|io|me|net|org|co|app|site|xyz|page|ai|tech)\b/i.test(url)
    ) {
      out.portfolio = url;
    }
  }
  return out;
}

// --- Education ------------------------------------------------------------------

const SCHOOL_RE = /university|college|institute|school|academy|polytechnic/i;
const DEGREE_RE =
  /\b(bachelor|master|doctor|ph\.?\s?d|associate|b\.?\s?s\.?c?|b\.?\s?a\.?|b\.?\s?eng|m\.?\s?s\.?c?|m\.?\s?a\.?|m\.?\s?eng|mba|b\.?\s?b\.?\s?a|high school diploma)(?![A-Za-z])/i;

function stripDates(s: string): string {
  return s
    .replace(RANGE_RE, '')
    .replace(SHARED_RE, '')
    .replace(new RegExp(`(expected|anticipated|graduat\\w*|class of)?:?\\s*${DATE}`, 'gi'), '')
    .replace(/\(\s*\)/g, '')
    .replace(/^[\s,|–—-]+|[\s,|–—-]+$/g, '')
    .trim();
}

function parseEducation(lines: string[]): Education[] {
  const entries: string[][] = [];
  for (const line of lines) {
    if (!BULLET_RE.test(line) && SCHOOL_RE.test(line) && !DEGREE_RE.test(line.split(SEPARATORS)[0] ?? '')) entries.push([line]);
    else if (entries.length) entries[entries.length - 1]!.push(line);
    else if (SCHOOL_RE.test(line)) entries.push([line]);
  }
  return entries.map((entry) => {
    const text = entry.join('\n');
    const segments = entry.flatMap((l) => l.replace(BULLET_RE, '').split(SEPARATORS)).map((s) => s.trim()).filter(Boolean);
    const school = stripDates(segments.find((s) => SCHOOL_RE.test(s) && !DEGREE_RE.test(s)) ?? segments[0] ?? '');
    const degreeSeg = segments.find((s) => DEGREE_RE.test(s));
    const parsed = degreeSeg ? parseDegreeLine(stripDates(degreeSeg)) : { degree: '', major: '', honors: '' };
    const { degree, major } = parsed;
    const range = dateRange(text);
    const single = range ? null : SINGLE_RE.exec(text.replace(/gpa[:\s]*[\d.]+(\s*\/\s*[\d.]+)?/gi, ''));
    const gpa = /gpa[:\s]*([0-4]\.\d{1,2})/i.exec(text)?.[1] ?? '';
    // Honors from the degree line itself, else from another line ("GPA: 3.8, Dean's List" gives "Dean's List").
    const honors =
      parsed.honors ||
      entry
        .filter((l) => l !== degreeSeg && !(degreeSeg && l.includes(degreeSeg)))
        .flatMap((l) => l.replace(BULLET_RE, '').split(/\s*[;,]\s*/))
        .filter((c) => /dean.?s list|honou?rs|cum laude|scholar/i.test(c))
        .join('; ');
    return {
      school: school.replace(/[,\s]+$/, ''),
      degree,
      major,
      gpa,
      startDate: range?.start ?? '',
      endDate: range ? range.end : single ? toMonth(single[1]!) : '',
      honors: honors === school ? '' : honors,
    };
  });
}

// --- Experience -----------------------------------------------------------------

const TITLE_RE =
  /\b(engineer|intern|developer|analyst|manager|assistant|associate|scientist|designer|researcher|lead|director|consultant|specialist|coordinator|founder|co-founder|president|officer|fellow|tutor|teacher|instructor|representative|administrator|architect|technician|programmer|strategist|head|member|volunteer|ambassador|captain|chair)\b/i;

const TRAILING_LOCATION_RE = new RegExp(`^(.*?)[,\\s]+((?:[A-Z][A-Za-z.'-]+ ?){1,3}, *(?:${STATES})\\b(?: +\\d{5})?)$`);

function isLocation(s: string): boolean {
  return LOCATION_RE.test(s) && s.replace(LOCATION_RE, '').replace(/[\s,]/g, '').length < 3 || /^(remote|hybrid|on-?site)$/i.test(s.trim());
}

interface RawEntry {
  headers: string[];
  bullets: string[];
  hasDate: boolean;
}

function parseExperience(lines: string[]): Experience[] {
  const hasGlyphs = lines.some((l) => BULLET_RE.test(l) && !RANGE_RE.test(l));
  const entries: RawEntry[] = [];
  let cur: RawEntry | null = null;

  for (const line of lines) {
    const hasDate = RANGE_RE.test(line) || (new RegExp(`(^|\\t|\\s{2,})${DATE}\\s*$`, 'i').test(line) && line.length < 90);
    if (hasGlyphs && BULLET_RE.test(line) && !hasDate) {
      if (cur) cur.bullets.push(line.replace(BULLET_RE, '').trim());
      continue;
    }
    const prev = cur?.bullets[cur.bullets.length - 1];
    const looksLikeHeader = hasDate || /\t/.test(line) || isLocation(line.split(SEPARATORS).pop() ?? '') || (line.length < 70 && TITLE_RE.test(line) && !/\.$/.test(line));
    if (cur && prev !== undefined && !looksLikeHeader && (/^[a-z(]/.test(line) || !/[.!?]$/.test(prev))) {
      cur.bullets[cur.bullets.length - 1] = `${prev} ${line.trim()}`;
      continue;
    }
    // A second header line (e.g. the company under the title) is short and not a sentence.
    const secondHeader = !!cur && !cur.bullets.length && cur.headers.length < 2 && line.length < 60 && !/[.!?]$/.test(line);
    if (!looksLikeHeader && !secondHeader) {
      if (cur) cur.bullets.push(line.replace(BULLET_RE, '').trim());
      continue;
    }
    // A line holding only the dates, under the title and company, belongs to that same job.
    const dateOnly = hasDate && stripDates(line).replace(/[\s,()|•·–—-]+/g, '') === '';
    const joinsDates = dateOnly && !!cur && !cur.hasDate && !cur.bullets.length;
    if (!cur || cur.bullets.length || (hasDate && cur.hasDate) || (cur.headers.length >= 2 && !joinsDates)) {
      cur = { headers: [], bullets: [], hasDate: false };
      entries.push(cur);
    }
    cur.headers.push(line);
    if (hasDate) cur.hasDate = true;
  }

  return entries
    .map((e) => {
      const joined = e.headers.join('\n');
      const range = dateRange(joined);
      // A job that lists one month ("Jun 2025") started and ended in that month.
      const single = range ? null : SINGLE_RE.exec(joined);
      const singleMonth = single ? toMonth(single[1]!) : '';
      let segments = e.headers
        .flatMap((h) => stripDates(h).split(SEPARATORS))
        .flatMap((s) => s.split(/\s+at\s+/))
        .map((s) => s.trim().replace(/^[,\s]+|[,\s]+$/g, ''))
        .filter(Boolean);
      let location = segments.find(isLocation) ?? '';
      segments = segments.filter((s) => !isLocation(s));
      // "Acme Corp, San Francisco, CA" in one segment: the location is the tail, not part of the company.
      if (!location) {
        segments = segments.map((s) => {
          const m = TRAILING_LOCATION_RE.exec(s);
          if (!m || !m[1]!.trim()) return s;
          location = m[2]!.trim();
          return m[1]!.replace(/[,\s-]+$/, '').trim();
        });
      }
      // "Software Engineer, Acme Corp" on one line
      if (segments.length === 1 && segments[0]!.includes(', ')) segments = segments[0]!.split(/,\s+/);
      const titleIdx = segments.findIndex((s) => TITLE_RE.test(s));
      const title = segments[titleIdx >= 0 ? titleIdx : 0] ?? '';
      const company = segments.find((_, i) => i !== (titleIdx >= 0 ? titleIdx : 0)) ?? '';
      return {
        title,
        company,
        location,
        startDate: range?.start ?? singleMonth,
        endDate: range ? range.end : singleMonth,
        current: range?.current ?? false,
        bullets: e.bullets.join('\n'),
      };
    })
    .filter((x) => x.title || x.company);
}

// --- Skills ---------------------------------------------------------------------

function parseSkills(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    let line = raw.replace(BULLET_RE, '');
    const label = /^([^:]{1,40}):\s*(.+)$/.exec(line);
    if (label) line = label[2]!;
    for (const part of line.split(/\s*[,;|•·]\s*|\t/)) {
      const s = part.replace(/\.$/, '').trim();
      if (s && s.length <= 40 && s.split(/\s+/).length <= 5) out.push(s);
    }
  }
  return Array.from(new Set(out));
}

// --- Entry point ----------------------------------------------------------------

/**
 * Turns resume text lines (big horizontal gaps as tabs) and link annotations into draft profile fields.
 */
export function parseResumeText(lines: string[], annotations: string[] = []): ResumeDraft {
  const sections: Record<Section, string[]> = { header: [], education: [], experience: [], skills: [], other: [] };
  let current: Section = 'header';
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const heading = headingOf(line);
    if (heading) {
      current = heading;
      continue;
    }
    sections[current].push(line.trim());
  }

  const header = sections.header.length ? sections.header : lines.slice(0, 6);
  const headerText = header.join('\n');
  const allText = lines.join('\n');
  const name = findName(header);
  const location = LOCATION_RE.exec(headerText);
  const links = findLinks(headerText + '\n' + allText.slice(0, 600), annotations);
  const experience = parseExperience(sections.experience);
  const education = parseEducation(sections.education);

  return sanitizeDraft({
    firstName: name.first,
    lastName: name.last,
    email: EMAIL_RE.exec(headerText)?.[0] ?? EMAIL_RE.exec(allText)?.[0] ?? '',
    phone: (PHONE_RE.exec(headerText) ?? PHONE_RE.exec(allText))?.[0].trim() ?? '',
    city: location?.[1] ?? '',
    state: location?.[2] ?? '',
    zip: location?.[3] ?? '',
    ...links,
    currentTitle: experience.find((x) => x.current)?.title ?? '',
    currentCompany: experience.find((x) => x.current)?.company ?? '',
    education,
    experience,
    skills: parseSkills(sections.skills),
  });
}

export type ResumeSection = 'education' | 'experience' | 'skills';

/** Sections the local reader could not find, to offer Gemini for. */
export function missingSections(d: ResumeDraft): ResumeSection[] {
  const out: ResumeSection[] = [];
  if (!d.education.length) out.push('education');
  if (!d.experience.length) out.push('experience');
  if (!d.skills.length) out.push('skills');
  return out;
}
