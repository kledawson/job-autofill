import type { Platform } from './types';

/** Sites the content script loads on automatically. Any other site is filled on request once access is granted. */
export const ATS_MATCHES = [
  '*://*.greenhouse.io/*',
  '*://jobs.lever.co/*',
  '*://jobs.eu.lever.co/*',
  '*://jobs.ashbyhq.com/*',
  '*://*.myworkdayjobs.com/*',
  '*://*.myworkdaysite.com/*',
  '*://*.myworkday.com/*',
];

/** Host permission requested at runtime to fill applications on any other site. */
export const ALL_SITES = ['<all_urls>'];

const WORKDAY_RE = /(^|\.)(myworkdayjobs|myworkdaysite|myworkday)\.com$/;

/** The ATS hosting `url`, or null for sites without a dedicated adapter. */
export function detectPlatform(url: string): Exclude<Platform, 'other'> | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (host === 'greenhouse.io' || host.endsWith('.greenhouse.io')) return 'greenhouse';
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') return 'lever';
  if (host === 'jobs.ashbyhq.com') return 'ashby';
  if (WORKDAY_RE.test(host)) return 'workday';
  return null;
}

/** Like detectPlatform, but every other page gets the generic adapter. */
export function platformFor(url: string): Platform {
  return detectPlatform(url) ?? 'other';
}

/** True for http(s) pages, the only ones an extension can fill. */
export function isWebUrl(url: string | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

export const PLATFORM_NAMES: Record<Platform, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  other: 'Company site',
};

/**
 * Turns a pasted posting link into the URL of its application form.
 * Lever and Ashby keep the form on a separate route; Greenhouse shows it on the posting.
 */
export function toApplicationUrl(raw: string): string {
  const url = new URL(raw.trim());
  const platform = detectPlatform(url.href);
  const parts = url.pathname.split('/').filter(Boolean);
  if (platform === 'lever' && parts.length === 2) {
    url.pathname = `/${parts[0]}/${parts[1]}/apply`;
  } else if (platform === 'ashby' && parts.length === 2) {
    url.pathname = `/${parts[0]}/${parts[1]}/application`;
  }
  return url.href;
}

/** Key used to spot a job the user already filled, ignoring tracking params and the form route. */
export function jobKey(raw: string): string {
  try {
    const url = new URL(raw);
    // Workday adds a step after /apply ("/apply/applyManually"); the posting is the part before it.
    const path = url.pathname.replace(/\/(apply|application)(\/[^/]*)?\/?$/, '').replace(/\/$/, '');
    if (!detectPlatform(raw)) {
      // Company forms frequently identify jobs by query; dropping it merges unrelated applications.
      for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
      url.searchParams.sort();
      return url.hostname + path + url.search;
    }
    const ghJob = url.searchParams.get('gh_jid') ?? url.searchParams.get('token');
    return `${url.hostname}${path}${ghJob ? `#${ghJob}` : ''}`.toLowerCase();
  } catch {
    return raw;
  }
}

/**
 * The posting a person would share, rather than the application form they filled:
 * Workday drops the location and the /apply steps ("/job/Campbell,-CA/Engineer_JR1/apply/..." → "/job/Engineer_JR1"),
 * Lever drops /apply, Ashby drops /application.
 */
export function postingUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  url.hash = '';
  const platform = detectPlatform(url.href);
  const parts = url.pathname.split('/').filter(Boolean);
  if (platform === 'workday') {
    const job = parts.indexOf('job');
    const apply = parts.indexOf('apply', job + 1);
    const posting = parts.slice(job + 1, apply > job ? apply : undefined).pop();
    if (job < 0 || !posting) return url.href;
    url.pathname = '/' + [...parts.slice(0, job + 1), posting].join('/');
    url.search = '';
  } else if ((platform === 'lever' && parts[2] === 'apply') || (platform === 'ashby' && parts[2] === 'application')) {
    url.pathname = '/' + parts.slice(0, 2).join('/');
  } else if (!platform) {
    // Company boards put the form one route below the posting ("/jobs/<id>/apply?jobId=<id>&step=application").
    // The posting is the path before it; query values that only repeat that path, or name the form step, go too.
    const form = parts.findIndex((p, i) => i > 0 && /^(apply|application)$/i.test(p));
    if (form > 0 && form >= parts.length - 2) {
      const posting = parts.slice(0, form);
      url.pathname = '/' + posting.join('/');
      const decode = (p: string) => { try { return decodeURIComponent(p); } catch { return p; } };
      const kept = new Set(posting.map((p) => decode(p).toLowerCase()));
      for (const [key, value] of [...url.searchParams]) {
        if (/^step$/i.test(key) || kept.has(value.toLowerCase())) url.searchParams.delete(key);
      }
    }
  }
  return url.href;
}
