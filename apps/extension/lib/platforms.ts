import type { Platform } from './types';

export const WEB_MATCHES = ['http://*/*', 'https://*/*'];

export function detectPlatform(url: string): Platform | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (host === 'greenhouse.io' || host.endsWith('.greenhouse.io')) return 'greenhouse';
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') return 'lever';
  if (host === 'jobs.ashbyhq.com') return 'ashby';
  return null;
}

export const PLATFORM_NAMES: Record<Platform, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  generic: 'Other website',
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
    const path = url.pathname.replace(/\/(apply|application)\/?$/, '').replace(/\/$/, '');
    const ghJob = url.searchParams.get('gh_jid') ?? url.searchParams.get('token');
    return `${url.hostname}${path}${ghJob ? `#${ghJob}` : ''}`.toLowerCase();
  } catch {
    return raw;
  }
}
