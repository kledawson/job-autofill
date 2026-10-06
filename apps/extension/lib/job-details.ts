// Where a job is, whether it is remote, and what it pays, read from the posting. Best effort: blank beats wrong.
import { findPayRange, formatAmount, type PayRange } from './autofill/salary';

export type WorkModel = 'Remote' | 'Hybrid' | 'On-site';
export const WORK_MODELS: WorkModel[] = ['Remote', 'Hybrid', 'On-site'];

export interface JobDetails {
  location: string;
  workMode: WorkModel | '';
  /** Posted pay such as "$120,000 - $150,000" or "$60/hour - $80/hour"; blank when the posting has none. */
  pay: string;
}

const COUNTRY_RE = /^(united states( of america)?|usa|u\.s\.a?\.?|us|canada|united kingdom|uk)$/i;

/** "San Francisco, CA, United States" → "San Francisco, CA". Anything unusual is kept as written. */
export function formatLocation(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 80) return '';
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 2 && COUNTRY_RE.test(parts[parts.length - 1]!)) parts.pop();
  return parts.join(', ');
}

/** A short label such as "Remote", "Hybrid", "OnSite", or "In office" (location, title, or a workplace-type field). */
export function normalizeWorkMode(raw: string): WorkModel | '' {
  if (/hybrid/i.test(raw)) return 'Hybrid';
  if (/remote|telecommut|work from home/i.test(raw)) return 'Remote';
  if (/on-?\s?site|in[- ]?(the )?office|in[- ]person/i.test(raw)) return 'On-site';
  return '';
}

/** Longer text such as a description: only explicit statements about the role count. */
export function inferWorkMode(description: string): WorkModel | '' {
  if (/\bhybrid\b/i.test(description)) return 'Hybrid';
  if (
    /\b(?:fully|100%|completely|entirely)[ -]remote\b|\bremote[- ]first\b|\b(?:this|the) (?:is a )?remote (?:role|position|job)\b|\bremote (?:role|position|opportunity)\b|\bwork(?:ing)? remotely\b/i.test(
      description,
    )
  ) {
    return 'Remote';
  }
  if (/\b(?:on-?site|in[- ]office)\s+(?:role|position|job)\b|\b(?:is|are|be)\s+(?:an?\s+)?(?:on-?site|in[- ]office)\b/i.test(description)) {
    return 'On-site';
  }
  return '';
}

/** schema.org JobPosting data, which most careers sites embed for search engines. */
export function findJobPosting(doc: Document): any | null {
  const visit = (node: any): any => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) return node.map(visit).find(Boolean) ?? null;
    const type = node['@type'];
    if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return node;
    return visit(node['@graph']);
  };
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const job = visit(JSON.parse(script.textContent ?? ''));
      if (job) return job;
    } catch {
      // Malformed JSON-LD is common; ignore it.
    }
  }
  return null;
}

export function formatPay({ low, high, hourly, currency }: PayRange): string {
  const unit = currency ? ` ${currency}` : '';
  return `${formatAmount(low, hourly)} - ${formatAmount(high, hourly)}${unit}`;
}

/** Pay from a posting's structured data: schema.org baseSalary. */
function structuredPay(job: any): string {
  const salary = job?.baseSalary;
  const value = salary?.value ?? salary;
  const low = Number(value?.minValue ?? value?.value);
  const high = Number(value?.maxValue ?? value?.value);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high < low) return '';
  const hourly = /hour/i.test(String(value?.unitText ?? ''));
  if (!hourly && /month|week|day/i.test(String(value?.unitText ?? ''))) return '';
  const currency = typeof salary?.currency === 'string' ? salary.currency.toUpperCase() : '';
  const range = { low, high, hourly, currency: currency === 'USD' ? '' : currency };
  return formatPay(range);
}

function structuredLocation(job: any): string {
  const place = [job.jobLocation].flat().find(Boolean);
  const address = place?.address;
  if (!address) return '';
  if (typeof address === 'string') return formatLocation(address);
  const city = String(address.addressLocality ?? '').trim();
  const state = String(address.addressRegion ?? '').trim();
  return [city, state].filter(Boolean).join(', ');
}

const LOCATION_SELECTORS = [
  '.job__location',
  '.posting-categories .location',
  '.posting-headline .location',
  '[data-automation-id="locations"]',
  '[itemprop="jobLocation"]',
  '[class*="job-location" i]',
  '.location',
].join(', ');

const WORKPLACE_SELECTORS = '.posting-categories .workplaceTypes, [data-automation-id="remoteType"]';

const textOf = (doc: Document, selector: string) =>
  (doc.querySelector<HTMLElement>(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Reads location and work model from a posting page; either may come back blank. */
export function readJobDetails(doc: Document, description: string, role: string): JobDetails {
  const job = findJobPosting(doc);
  let location = job ? structuredLocation(job) : '';
  if (!location) location = formatLocation(textOf(doc, LOCATION_SELECTORS));
  let workMode: WorkModel | '' = job?.jobLocationType === 'TELECOMMUTE' ? 'Remote' : '';
  workMode ||= normalizeWorkMode(textOf(doc, WORKPLACE_SELECTORS));
  workMode ||= normalizeWorkMode(`${location} ${role}`);
  workMode ||= inferWorkMode(description);
  const posted = findPayRange(description);
  const pay = (job ? structuredPay(job) : '') || (posted ? formatPay(posted) : '');
  return { location, workMode, pay };
}
