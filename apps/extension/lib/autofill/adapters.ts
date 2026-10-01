import type { Platform } from '../types';
import type { AdapterKeys } from './classify';

export interface JobInfo {
  company: string;
  role: string;
  /** Description text found on the page, if any. */
  description: string;
  /** For platforms whose form page lacks the description: identifiers to fetch it by. */
  remote?: { platform: 'lever' | 'ashby'; org: string; jobId: string };
}

export interface Adapter {
  platform: Platform;
  keys: AdapterKeys;
  /** Root to scan; the application form when it can be identified. */
  formRoot(doc: Document): ParentNode;
  jobInfo(doc: Document): JobInfo;
}

const text = (doc: ParentNode, sel: string) => (doc.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const longText = (doc: ParentNode, sel: string) => {
  const el = doc.querySelector<HTMLElement>(sel);
  return (el?.innerText ?? el?.textContent ?? '').trim();
};

const greenhouse: Adapter = {
  platform: 'greenhouse',
  keys: {
    first_name: 'firstName',
    last_name: 'lastName',
    preferred_name: 'preferredName',
    email: 'email',
    phone: 'phone',
    country: 'country',
    'candidate-location': 'location',
    resume: 'resume',
    cover_letter: 'coverLetter',
    'school--0': 'school',
    'degree--0': 'degree',
    'discipline--0': 'major',
    'start-month--0': 'eduStartMonth',
    'start-year--0': 'eduStartYear',
    'end-month--0': 'eduEndMonth',
    'end-year--0': 'eduEndYear',
    gender: 'gender',
    hispanic_ethnicity: 'hispanic',
    veteran_status: 'veteran',
    disability_status: 'disability',
    // Legacy boards.greenhouse.io form
    'job_application[first_name]': 'firstName',
    'job_application[last_name]': 'lastName',
    'job_application[email]': 'email',
    'job_application[phone]': 'phone',
    'job_application[location]': 'location',
    'job_application[gender]': 'gender',
    'job_application[hispanic_ethnicity]': 'hispanic',
    'job_application[race]': 'race',
    'job_application[veteran_status]': 'veteran',
    'job_application[disability_status]': 'disability',
  },
  formRoot: (doc) => doc.querySelector('#application-form, #application_form, form[action*="applications"]') ?? doc.body,
  jobInfo(doc) {
    // "Job Application for Commercial Policy Lead at Northwind"
    const m = /^Job Application for (.+) at (.+)$/.exec(doc.title.trim());
    const role = text(doc, '.job__title h1, h1.app-title, .app-title, h1') || m?.[1] || '';
    const company =
      m?.[2] ||
      text(doc, '.company-name').replace(/^at\s+/i, '') ||
      (new URL(doc.location.href).searchParams.get('for') ?? doc.location.pathname.split('/').filter(Boolean)[0] ?? '');
    return { role, company, description: longText(doc, '.job__description, #content, .job-post-content') };
  },
};

const lever: Adapter = {
  platform: 'lever',
  keys: {
    name: 'fullName',
    email: 'email',
    phone: 'phone',
    location: 'location',
    org: 'currentCompany',
    'urls[LinkedIn]': 'linkedin',
    'urls[GitHub]': 'github',
    'urls[Github]': 'github',
    'urls[Portfolio]': 'portfolio',
    'urls[Other]': 'website',
    resume: 'resume',
    'eeo[gender]': 'gender',
    'eeo[race]': 'race',
    'eeo[veteran]': 'veteran',
    'eeo[disability]': 'disability',
    pronouns: 'pronouns',
  },
  formRoot: (doc) => doc.querySelector('#application-form, form') ?? doc.body,
  jobInfo(doc) {
    // "Contoso Labs - Administrative Business Partner"
    const [titleCompany, ...rest] = doc.title.split(' - ');
    const role = text(doc, '.posting-headline h2, .posting-header h2') || rest.join(' - ').trim();
    const [org = '', jobId = ''] = doc.location.pathname.split('/').filter(Boolean);
    const company =
      titleCompany?.trim() ||
      (doc.querySelector('.main-header-logo img')?.getAttribute('alt') ?? '').replace(/ logo$/i, '') ||
      org;
    const description = longText(doc, '[data-qa="job-description"], .posting-page .section-wrapper .content');
    return {
      role,
      company,
      description,
      remote: description ? undefined : { platform: 'lever', org, jobId },
    };
  },
};

const ashby: Adapter = {
  platform: 'ashby',
  keys: {
    _systemfield_name: 'fullName',
    _systemfield_email: 'email',
    _systemfield_phone: 'phone',
    communicationConsent: 'textConsent',
    _systemfield_location: 'location',
    _systemfield_resume: 'resume',
    _systemfield_linkedin: 'linkedin',
    _systemfield_eeoc_gender: 'gender',
    _systemfield_eeoc_race: 'race',
    _systemfield_eeoc_veteran_status: 'veteran',
    _systemfield_eeoc_disability_status: 'disability',
  },
  formRoot(doc) {
    // Some boards render sections (like the EEO questions) outside the first container, so take the
    // smallest element that holds every section.
    const sections = Array.from(doc.querySelectorAll('.ashby-application-form-section-container'));
    let common: Element | null = sections[0]?.parentElement ?? null;
    while (common && !sections.every((s) => common!.contains(s))) common = common.parentElement;
    if (common && common !== doc.documentElement) return common;
    return (
      doc.querySelector('.ashby-application-form-field-entry')?.closest('form, [class*="application-form-container"], main') ??
      doc.body
    );
  },
  jobInfo(doc) {
    // "Software Engineer @ Example Co"
    const m = /^(.+) @ (.+)$/.exec(doc.title.trim());
    const [org = '', jobId = ''] = doc.location.pathname.split('/').filter(Boolean);
    return {
      role: m?.[1] || text(doc, 'h1'),
      company: m?.[2] || org,
      description: longText(doc, '[class*="descriptionText"], .ashby-job-posting-description'),
      remote: { platform: 'ashby', org, jobId },
    };
  },
};

export const ADAPTERS: Record<Platform, Adapter> = { greenhouse, lever, ashby };
