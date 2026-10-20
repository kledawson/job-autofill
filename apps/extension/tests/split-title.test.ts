// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ADAPTERS, employerName, splitTitle } from '@/lib/autofill/adapters';

describe('splitTitle', () => {
  it('reads "Role at Company | Handshake"', () => {
    expect(splitTitle('Software Engineer Intern at Acme Corp | Handshake')).toEqual({ role: 'Software Engineer Intern', company: 'Acme Corp' });
  });
  it('reads "Role - Company - Handshake"', () => {
    expect(splitTitle('Analyst - Acme - Handshake')).toEqual({ role: 'Analyst', company: 'Acme' });
  });
  it('drops "Careers at" from the company', () => {
    expect(splitTitle('Account Manager - Careers at Airbnb')).toEqual({ role: 'Account Manager', company: 'Airbnb' });
  });
  it('leaves the company blank when the title only has a role', () => {
    expect(splitTitle('Analyst | Careers')).toEqual({ role: 'Analyst', company: '' });
  });
  it('does not mistake a class year, region or job ID for the company', () => {
    expect(splitTitle('Software Development Engineer, Early Career - 2027 (US)').company).toBe('');
    expect(splitTitle('Software Development Engineer, Early Career - 2027 (US) - Job ID: 10583340 | Amazon.jobs').company).toBe('Amazon');
    expect(splitTitle('Data Analyst - Austin, TX - Northwind').company).toBe('Northwind');
    expect(splitTitle('Designer - Remote - Fabrikam Careers').company).toBe('Fabrikam');
    expect(splitTitle('Engineer - Summer Internship - R12345').company).toBe('');
  });
  it('never names a job board as the company', () => {
    expect(splitTitle('Analyst | Indeed').company).toBe('');
    expect(splitTitle('Analyst - Contoso | Glassdoor').company).toBe('Contoso');
  });
});

describe('employerName', () => {
  it('cleans site names and keeps real names intact', () => {
    expect(employerName('Amazon.jobs')).toBe('Amazon');
    expect(employerName('Stripe Careers')).toBe('Stripe');
    expect(employerName('IBM')).toBe('IBM');
    expect(employerName('Workday, Inc.')).toBe('Workday, Inc.');
    expect(employerName('3M')).toBe('3M');
    expect(employerName('Handshake')).toBe('');
    expect(employerName('2027 (US)')).toBe('');
  });
});

describe('any careers site company', () => {
  it('reads the employer from the tab title when og:title only names the job', () => {
    (window as any).happyDOM.setURL('https://www.amazon.jobs/en/jobs/10583340/software-development-engineer-early-career-2027-us');
    document.head.innerHTML = `<title>Software Development Engineer, Early Career - 2027 (US) - Job ID: 10583340 | Amazon.jobs</title>
      <meta property="og:site_name" content="Amazon.jobs">
      <meta property="og:title" content="Software Development Engineer, Early Career - 2027 (US)">`;
    document.body.innerHTML = '<h1 class="title">Software Development Engineer, Early Career - 2027 (US)</h1>';
    const info = ADAPTERS.other.jobInfo(document);
    expect(info.company).toBe('Amazon');
    expect(info.role).toBe('Software Development Engineer, Early Career - 2027 (US)');
  });
  it('falls back to the site name, then the host, when no title part names the employer', () => {
    (window as any).happyDOM.setURL('https://careers.contoso.com/jobs/1');
    document.head.innerHTML = '<title>Analyst - 2026 (US)</title><meta property="og:site_name" content="Contoso Careers">';
    document.body.innerHTML = '<h1>Analyst</h1>';
    expect(ADAPTERS.other.jobInfo(document).company).toBe('Contoso');
    document.head.innerHTML = '<title>Analyst - 2026 (US)</title><meta property="og:site_name" content="Handshake">';
    expect(ADAPTERS.other.jobInfo(document).company).toBe('Contoso');
  });
});
