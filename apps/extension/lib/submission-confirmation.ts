/** Supported success evidence, separate from the user's submit intent and queue ownership. */
export type SubmissionEvidence = 'greenhouse-confirmation' | 'lever-confirmation' | 'ashby-confirmation';

/** Confirmation routes must retain both company and job identity. A generic /thanks is unsafe. */
export function isSubmissionUrl(original: string, current: string): boolean {
  try {
    const from = new URL(original), to = new URL(current);
    if (from.origin !== to.origin || !/^https?:$/.test(to.protocol) || to.username || to.password) return false;
    if (/(^|\.)greenhouse\.io$/.test(from.hostname)) return isGreenhouseConfirmationUrl(original, current);
    const parts = from.pathname.split('/').filter(Boolean);
    if (parts.length < 2 || parts.length > 3) return false;
    const base = '/' + parts.slice(0, 2).join('/');
    const routes = ['jobs.lever.co', 'jobs.eu.lever.co'].includes(from.hostname) ? ['', '/apply', '/thanks'] :
      from.hostname === 'jobs.ashbyhq.com' ? ['', '/application', '/confirmation', '/application/confirmation'] : [];
    return routes.some(suffix => to.pathname.replace(/\/$/, '') === base + suffix);
  } catch { return false; }
}

export const SUBMIT_INTENT_MS = 10 * 60_000;
export function recentSubmitIntent(at: unknown, now = Date.now()): boolean {
  return typeof at === 'number' && Number.isSafeInteger(at) && at <= now && now - at <= SUBMIT_INTENT_MS;
}

/** Only control/error metadata is inspected; applicant answers never leave the page. */
export function hasSubmissionErrors(doc: Document): boolean {
  return [...doc.querySelectorAll('form input, form select, form textarea, form [aria-invalid="true"], form [role="alert"], form .field-error, form .error-message')].some(el => {
    if (el.matches('input, select, textarea') && el.getAttribute('aria-invalid') !== 'true' && !(('willValidate' in el) && el.willValidate && 'validity' in el && !(el.validity as ValidityState).valid)) return false;
    if (el.matches('[role="alert"], .field-error, .error-message') && !el.textContent?.trim()) return false;
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = doc.defaultView?.getComputedStyle(node);
      if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true' || style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  });
}

export function isGreenhouseConfirmationUrl(original: string, current: string): boolean {
  try {
    const from = new URL(original), to = new URL(current);
    if (!/^https?:$/.test(to.protocol) || from.origin !== to.origin || !/(^|\.)greenhouse\.io$/.test(to.hostname)) return false;
    const path = from.pathname.replace(/\/$/, '');
    if (!/^\/[^/]+\/jobs\/\d+$/.test(path)) return false;
    return ['', '/confirmation', '/thank_you', '/thank-you'].some(suffix => to.pathname.replace(/\/$/, '') === path + suffix);
  } catch { return false; }
}

/** Exact confirmation language in a visible heading/status, with the application form gone.
 * A description containing "thank you", an empty form, or a route change alone is insufficient.
 */
export function readSubmissionEvidence(doc: Document): SubmissionEvidence | null {
  const host = doc.location.hostname;
  const evidence: SubmissionEvidence | null = /(^|\.)greenhouse\.io$/.test(host) ? 'greenhouse-confirmation' :
    ['jobs.lever.co', 'jobs.eu.lever.co'].includes(host) ? 'lever-confirmation' : host === 'jobs.ashbyhq.com' ? 'ashby-confirmation' : null;
  if (!evidence) return null;
  const visible = (el: Element) => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = doc.defaultView?.getComputedStyle(node);
      if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true' || style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  };
  if ([...doc.querySelectorAll('form input:not([type="hidden"]), form textarea, form select, form [role="combobox"], form [role="textbox"], form [contenteditable="true"], #application-form input, #application_form input')].some(visible)) return null;
  const success = /^(?:your )?application (?:has been |was |is )?(?:successfully )?(?:submitted|received)(?: successfully)?(?:[.!]|$)|^(?:thank you|thanks) for applying(?:[.!]|$)/i;
  if ([...doc.querySelectorAll('[role="alert"], .field-error, .error-message, [aria-invalid="true"]')].some(el => visible(el) && !success.test((el.textContent ?? '').trim()) && (el.textContent?.trim() || el.hasAttribute('aria-invalid')))) return null;
  return [...doc.querySelectorAll('h1, h2, h3, [role="status"], [role="alert"], [data-testid="application-success"], .application--success, .application__confirmation')]
    .some(el => !el.closest('.job__description, #content, .job-post-content, .job-description, [data-qa="job-description"]') && visible(el) && success.test((el.textContent ?? '').replace(/\s+/g, ' ').trim())) ? evidence : null;
}
