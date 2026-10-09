import type { Platform, Profile } from '../types';
import type { AdapterKeys } from './classify';
import { addEntries } from './entries';
import { findJobPosting, formatLocation } from '../job-details';

export interface JobInfo {
  company: string;
  role: string;
  /** Description text found on the page, if any. */
  description: string;
  /** "City, ST" when the platform states it more reliably than the page (Workday's URL); blank otherwise. */
  location?: string;
  /** For platforms whose form page lacks the description: identifiers to fetch it by. */
  remote?: { platform: 'lever' | 'ashby'; org: string; jobId: string };
}

export interface Adapter {
  platform: Platform;
  keys: AdapterKeys;
  /** Root to scan; the application form when it can be identified. */
  formRoot(doc: Document): ParentNode;
  jobInfo(doc: Document): JobInfo;
  /**
   * Multi-step applications (Workday's My Information, My Experience, ...): keep watching the whole page
   * and fill each step as it appears, and wait for the form while the person signs in.
   */
  multiStep?: boolean;
  /** Start filling (and watching) at once instead of waiting for a recognisable form first. */
  watchWholeFlow?: boolean;
  /** Fields this adapter must recognise before a page counts as an application form (default: any 2 fields). */
  minProfileFields?: number;
  /** Runs before each scan, e.g. to add one work-experience entry per profile entry. */
  prepare?(root: ParentNode, profile: Profile, done: WeakSet<Element>): Promise<boolean>;
  /** Fetches the job description from the page's own site when the form page does not show it. */
  fetchDescription?(doc: Document): Promise<string>;
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

function stripHtml(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const meta = (doc: Document, prop: string) =>
  (doc.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`)?.getAttribute('content') ?? '').trim();

function jobPostingData(doc: Document): { title: string; company: string; description: string } | null {
  const job = findJobPosting(doc);
  if (!job) return null;
  const org = job.hiringOrganization;
  return {
    title: String(job.title ?? '').trim(),
    company: String((typeof org === 'string' ? org : org?.name) ?? '').trim(),
    description: stripHtml(String(job.description ?? '')).slice(0, 8000),
  };
}

/** "careers.acme.com" → "Acme". */
function companyFromHost(host: string): string {
  const parts = host.replace(/^www\./, '').split('.');
  const generic = /^(careers?|jobs?|apply|talent|recruiting|hire|work|join)$/i;
  const name = parts.length > 2 && generic.test(parts[0]!) ? parts[1]! : parts[0]!;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function shortHeading(doc: Document): string {
  const h1 = text(doc, 'h1');
  return h1.length > 0 && h1.length < 120 ? h1 : '';
}

/** "Software Engineer at Acme | Handshake" or "Engineer - Acme - Handshake" → role and company; blanks when the title doesn't say. */
export function splitTitle(title: string): { role: string; company: string } {
  const parts = title.split(/\s+[|–—]\s+|\s+-\s+/).map((p) => p.trim()).filter((p) => p && !/^(handshake|jobs?|careers?|apply|application)$/i.test(p));
  const first = parts[0] ?? '';
  const at = /^(.+?)\s+at\s+(.+)$/i.exec(first);
  if (at) return { role: at[1]!.trim(), company: at[2]!.trim() };
  // "Careers at Airbnb", "Jobs at Acme": the employer is what follows.
  const company = (parts[1] ?? '').replace(/^(?:careers?|jobs?|work|working)\s+(?:at|with|for)\s+/i, '');
  return { role: first, company };
}

const PLACE = /^[A-Z][\p{L} .'-]+(, [A-Z][\p{L} .'-]+){1,2}$/u;

/** A short line such as "London, United Kingdom" or "Austin, TX" among the first lines after the job title; blank if none. */
export function placeAfterTitle(doc: Document): string {
  const h1 = Array.from(doc.querySelectorAll('h1')).find((h) => (h.textContent ?? '').trim().length > 2);
  if (!h1) return '';
  const lines = Array.from(doc.body.querySelectorAll('*'))
    .filter((el) => !el.children.length && !!(h1.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && !h1.contains(el))
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const t of lines.slice(0, 15)) if (t.length < 60 && !/\d/.test(t) && PLACE.test(t)) return t;
  return '';
}

/** Handshake job pages: the title reads "Role | Company | Handshake" and the posting sits in [data-hook="job-details-page"]. */
function handshakeInfo(doc: Document): JobInfo | null {
  if (!/(^|\.)joinhandshake\.com$/.test(doc.location.hostname)) return null;
  const root = doc.querySelector<HTMLElement>('[data-hook="job-details-page"]');
  const fromTitle = splitTitle(doc.title);
  const role = (root && text(root, 'h1')) || fromTitle.role;
  const description = root ? (root.innerText ?? root.textContent ?? '').trim().slice(0, 8000) : '';
  // Short leaf text such as "Austin, TX" or "Remote" near the top of the posting.
  const place = root
    ? Array.from(root.querySelectorAll('span, div, p, li'))
        .filter((el) => !el.children.length)
        .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
        .slice(0, 80)
        .find((t) => t.length < 60 && (/^[A-Z][\w .'-]+, [A-Z]{2}\b/.test(t) || /^[A-Z][\w .'-]+, [A-Z][a-z]+( [A-Z][a-z]+)*$/.test(t)))
    : '';
  return { role, company: fromTitle.company, description, location: place || undefined };
}

/** Any careers site or form without a dedicated adapter: everything comes from labels and page metadata. */
const other: Adapter = {
  platform: 'other',
  keys: {},
  multiStep: true,
  minProfileFields: 2,
  formRoot(doc) {
    // The form with the most inputs, unless the fields are not inside a form at all.
    let best: Element | null = null;
    let bestCount = 0;
    for (const form of Array.from(doc.querySelectorAll('form'))) {
      const n = form.querySelectorAll('input:not([type="hidden"]), select, textarea, button[aria-haspopup="listbox"]').length;
      if (n > bestCount) {
        best = form;
        bestCount = n;
      }
    }
    return best && bestCount >= 3 ? best : doc.body;
  },
  jobInfo(doc) {
    const handshake = handshakeInfo(doc);
    if (handshake) return handshake;
    const data = jobPostingData(doc);
    const title = doc.title.split(/\s+[|–—-]\s+/)[0]?.trim() ?? '';
    const description =
      data?.description ||
      longText(doc, '[itemprop="description"], [class*="job-description" i], [class*="jobDescription" i], [id*="job-description" i], [id*="jobDescription" i]').slice(0, 8000);
    const fromTitle = splitTitle(meta(doc, 'og:title') || doc.title);
    const siteName = meta(doc, 'og:site_name');
    // A site name like "Handshake" names the job board, not the employer, so a company in the title wins.
    const company = data?.company || fromTitle.company || siteName || companyFromHost(doc.location.hostname);
    return {
      role: data?.title || shortHeading(doc) || fromTitle.role || meta(doc, 'og:title') || title,
      company,
      description,
      location: placeAfterTitle(doc) || undefined,
    };
  },
  prepare: addEntries,
};

/** Workday career sites: {tenant}.wd5.myworkdayjobs.com/{lang}/{site}/job/{location}/{Title_JR123}/apply/... */
function workdayPosting(doc: Document): { tenant: string; site: string; jobPath: string } | null {
  const parts = doc.location.pathname.split('/').filter(Boolean);
  if (/^[a-z]{2}(-[A-Z]{2})?$/.test(parts[0] ?? '')) parts.shift();
  let tenant = doc.location.hostname.split('.')[0] ?? '';
  // myworkdaysite.com keeps the tenant in the path: /recruiting/{tenant}/{site}/job/...
  if (parts[0] === 'recruiting') {
    parts.shift();
    tenant = parts.shift() ?? tenant;
  }
  const site = parts[0] ?? '';
  const job = parts.indexOf('job');
  if (!site || job < 0) return null;
  const end = parts.indexOf('apply');
  const jobPath = parts.slice(job + 1, end > job ? end : undefined).join('/');
  return jobPath ? { tenant, site, jobPath } : null;
}

/** Workday's location slug: "Campbell,-CA", "Santa-Clara-CA" or "US-CA-San-Jose" → "City, ST"; blank for anything else. */
export function workdayLocation(slug: string): string {
  let text = decodeURIComponent(slug);
  const countryFirst = /^usa?-([A-Z]{2})-(.+)$/i.exec(text);
  if (countryFirst) return formatLocation(`${countryFirst[2]!.replace(/-/g, ' ')}, ${countryFirst[1]!.toUpperCase()}`);
  text = text.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text.includes(',')) text = text.replace(/ ([A-Z]{2})$/, ', $1');
  if (/multiple|locations|various/i.test(text)) return '';
  return formatLocation(text);
}

const workday: Adapter = {
  platform: 'workday',
  multiStep: true,
  watchWholeFlow: true,
  minProfileFields: 2,
  keys: {
    // Current Workday ids
    'name--legalName--firstName': 'firstName',
    'name--legalName--lastName': 'lastName',
    'name--preferredName--firstName': 'preferredName',
    'emailAddress--emailAddress': 'email',
    'phoneNumber--phoneNumber': 'phone',
    'phoneNumber--countryPhoneCode': 'phoneCountryCode',
    'address--addressLine1': 'address',
    'address--city': 'city',
    'address--postalCode': 'zip',
    'address--countryRegion': 'state',
    'country--country': 'country',
    jobTitle: 'expTitle',
    companyName: 'expCompany',
    roleDescription: 'expDescription',
    currentlyWorkHere: 'expCurrent',
    school: 'school',
    degree: 'degree',
    fieldOfStudy: 'major',
    gradeAverage: 'gpa',
    // Older data-automation-id names
    legalNameSection_firstName: 'firstName',
    legalNameSection_lastName: 'lastName',
    email: 'email',
    'phone-number': 'phone',
    countryPhoneCode: 'phoneCountryCode',
    addressSection_addressLine1: 'address',
    addressSection_city: 'city',
    addressSection_postalCode: 'zip',
    addressSection_countryRegion: 'state',
    countryDropdown: 'country',
    linkedinQuestion: 'linkedin',
    'file-upload-input-ref': 'resume',
  },
  // The application pages, without the site header's language and account menus.
  formRoot: (doc) => doc.querySelector('[data-automation-id="applyFlowPage"]') ?? doc.querySelector('main') ?? doc.body,
  jobInfo(doc) {
    const posting = workdayPosting(doc);
    const fromPath = (posting?.jobPath.split('/').pop() ?? '').replace(/_[A-Z]*[-_]?\d[\w-]*$/, '').replace(/-/g, ' ').trim();
    const tenant = posting?.tenant ?? '';
    const segments = posting?.jobPath.split('/') ?? [];
    return {
      location: segments.length > 1 ? workdayLocation(segments[0]!) : '',
      role: text(doc, '[data-automation-id="jobPostingHeader"]') || fromPath || shortHeading(doc),
      company: meta(doc, 'og:site_name') || (tenant ? tenant.charAt(0).toUpperCase() + tenant.slice(1) : ''),
      description: longText(doc, '[data-automation-id="jobPostingDescription"]'),
    };
  },
  prepare: addEntries,
  async fetchDescription(doc) {
    const posting = workdayPosting(doc);
    if (!posting) return '';
    try {
      const res = await fetch(`${doc.location.origin}/wday/cxs/${posting.tenant}/${posting.site}/job/${posting.jobPath}`, {
        headers: { accept: 'application/json' },
        credentials: 'omit',
      });
      const body = await res.json();
      return stripHtml(String(body?.jobPostingInfo?.jobDescription ?? '')).slice(0, 8000);
    } catch {
      return '';
    }
  },
};

export const ADAPTERS: Record<Platform, Adapter> = { greenhouse, lever, ashby, workday, other };
