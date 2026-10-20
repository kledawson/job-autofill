// Finds the job posting behind an application form, so free-response prompts can name it and include its
// description when the form page does not show one. Reads only the posting the page links to on its own site.
import { findJobPosting } from './job-details';
import { postingUrl } from './platforms';

/** Link text that leads from an application form back to its posting. */
const POSTING_LINK_RE = /\b(job description|job details|job posting|view (the )?(full )?(job|posting|role|position)|see (the )?(full )?(job|posting)|back to (the )?(job|posting|role)|about (the|this) (job|role|position))\b/i;

function webUrl(raw: string, base?: string): URL | null {
  try {
    const url = new URL(raw, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * The posting's address: a same-site "View job description" style link on the page, otherwise the posting the
 * form's own address points to (Lever /apply, Ashby /application, Workday steps, company /apply routes), otherwise
 * the page itself. Always an http(s) URL without a fragment, or '' for pages that are not on the web.
 */
export function findPostingLink(doc: Document, pageUrl: string): string {
  const page = webUrl(pageUrl);
  if (!page) return '';
  page.hash = '';
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (!POSTING_LINK_RE.test((a.textContent ?? '') + ' ' + (a.getAttribute('aria-label') ?? ''))) continue;
    const url = webUrl(a.getAttribute('href')!, page.href);
    if (!url || url.origin !== page.origin) continue;
    url.hash = '';
    if (url.href !== page.href) return url.href;
  }
  return webUrl(postingUrl(page.href))?.href ?? page.href;
}

const DESCRIPTION_SELECTORS = '[itemprop="description"], .job__description, [data-qa="job-description"], .posting-page .section-wrapper .content, ' +
  '[class*="descriptionText"], .ashby-job-posting-description, [data-automation-id="jobPostingDescription"], ' +
  '[class*="job-description" i], [class*="jobDescription" i], [id*="job-description" i], [id*="jobDescription" i], main';

/** The description in a fetched posting page: its schema.org JobPosting, else the usual description blocks. */
export function readPostingDescription(doc: Document): string {
  const data = findJobPosting(doc);
  const fromData = typeof data?.description === 'string'
    ? new DOMParser().parseFromString(data.description, 'text/html').body.textContent ?? '' : '';
  const block = doc.querySelector<HTMLElement>(DESCRIPTION_SELECTORS);
  const text = fromData.trim() || (block?.textContent ?? '');
  return text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, 8000);
}

/**
 * Fetches the posting page when it is another page on the same site and returns its description, or ''.
 * Same-site only: the request goes where the person's own application page already is.
 */
export async function fetchPostingDescription(link: string, pageUrl: string, signal?: AbortSignal): Promise<string> {
  const target = webUrl(link), page = webUrl(pageUrl);
  if (!target || !page || target.origin !== page.origin) return '';
  page.hash = ''; target.hash = '';
  if (target.href === page.href) return '';
  const res = await fetch(target.href, { credentials: 'include', signal });
  if (!res.ok || !/html/i.test(res.headers.get('content-type') ?? '')) return '';
  const doc = new DOMParser().parseFromString((await res.text()).slice(0, 3_000_000), 'text/html');
  return readPostingDescription(doc);
}
