import { bestOption } from '../lib/autofill/match';
import { searchQueries } from '../lib/autofill/fill';
import { findPayRange, salaryAnswer } from '../lib/autofill/salary';
import { classifyField } from '../lib/autofill/classify';
import { describe, expect, it } from 'vitest';
import { clampToLimit, DEFAULT_PROMPT_TEMPLATE, profileForPrompt, renderPrompt } from '../lib/prompt';
import { jobKey, toApplicationUrl } from '../lib/platforms';
import { sampleProfile } from './helpers';
import { valueFor } from '../lib/autofill/values';

describe('prompt', () => {
  it('fills every placeholder and leaves out voluntary disclosures and contact details', () => {
    const p = sampleProfile();
    p.eeo.race = 'Asian';
    const out = renderPrompt(
      DEFAULT_PROMPT_TEMPLATE,
      { question: 'Why Acme?', jobDescription: 'Build things', company: 'Acme', role: 'SWE', characterLimit: 500 },
      p,
    );
    expect(out).not.toMatch(/\{(question|jobDescription|company|role|profile|characterLimit)\}/);
    expect(out).toContain('Why Acme?');
    expect(out).toContain('under 500 characters');
    const profileText = profileForPrompt(p);
    expect(profileText).toContain('Acme Corp');
    expect(profileText).not.toMatch(/Female|Asian|veteran|disability/i);
    expect(profileText).not.toContain('jordan@example.com');
    expect(profileText).not.toContain('415-555-0100');
  });

  it('clamps answers at a sentence boundary', () => {
    const text = 'First sentence here. Second sentence is longer and goes on. Third.';
    expect(clampToLimit(text, 40)).toBe('First sentence here.');
    expect(clampToLimit('Answer: Short.', 100)).toBe('Short.');
  });
});

describe('current position', () => {
  it('answers N/A when Current position is empty', () => {
    const p = sampleProfile();
    p.experience[0]!.current = true;
    expect(valueFor('currentTitle', p)).toEqual(['N/A']);
    p.currentTitle = 'Teaching Assistant';
    expect(valueFor('currentTitle', p)).toEqual(['Teaching Assistant']);
    expect(profileForPrompt(p)).toContain('Current position: Teaching Assistant');
  });
});

describe('links', () => {
  it('routes Lever and Ashby postings to their application form', () => {
    expect(toApplicationUrl('https://jobs.lever.co/acme/123')).toBe('https://jobs.lever.co/acme/123/apply');
    expect(toApplicationUrl('https://jobs.ashbyhq.com/acme/abc')).toBe('https://jobs.ashbyhq.com/acme/abc/application');
    expect(toApplicationUrl('https://job-boards.greenhouse.io/acme/jobs/1')).toBe('https://job-boards.greenhouse.io/acme/jobs/1');
  });

  it('treats a posting and its form as the same job', () => {
    expect(jobKey('https://jobs.lever.co/acme/123/apply?lever-source=x')).toBe(jobKey('https://jobs.lever.co/acme/123'));
  });
});

describe('phone and country code', () => {
  it('leaves the code off unless the form asks for it', () => {
    const p = sampleProfile();
    p.phone = '+1 (415) 555-0100';
    expect(valueFor('phone', p)).toEqual(['(415) 555-0100']);
    expect(valueFor('phone', p, { phoneWithCode: true })).toEqual(['+1 (415) 555-0100']);
    p.phone = '415-555-0100';
    p.countryCode = '+44';
    expect(valueFor('phone', p, { phoneWithCode: true })).toEqual(['+44 415-555-0100']);
    expect(valueFor('phoneCountryCode', p)).toContain('+44');
    expect(valueFor('age', { ...p, age: '24' })).toEqual(['24']);
  });
});

describe('start date, work arrangement, survey answers', () => {
  it('defaults the earliest start date to two weeks out', () => {
    const p = sampleProfile();
    p.preferences.startDate = '';
    const v = valueFor('startDate', p, { now: new Date(2026, 9, 1) })!;
    expect(v.slice(0, 3)).toEqual(['10/15/2026', 'October 15, 2026', '2026-10-15']);
    p.preferences.startDate = 'June 2026';
    expect(valueFor('startDate', p)).toEqual(['June 2026']);
  });
  it('answers Yes to every arrangement question when flexible', () => {
    const p = sampleProfile();
    p.preferences.workMode = 'flexible';
    expect(valueFor('workMode', p, { yesNo: true })).toEqual(['Yes']);
    p.preferences.workMode = 'remote';
    expect(valueFor('workMode', p, { yesNo: true })).toBeNull();
  });
  it('knows other wordings for survey answers', () => {
    const p = sampleProfile();
    p.eeo.gender = 'Male';
    expect(valueFor('gender', p)).toContain('Man');
  });
});

describe('combined and location questions', () => {
  it('answers authorized-without-sponsorship from both saved answers', () => {
    const p = sampleProfile();
    p.workAuth = { authorizedUS: 'yes', needsSponsorship: 'no', status: '' };
    expect(valueFor('authorizedNoSponsor', p)).toEqual(['Yes']);
    p.workAuth.needsSponsorship = 'yes';
    expect(valueFor('authorizedNoSponsor', p)).toEqual(['No']);
  });
  it('recognizes Bay Area residence and onsite questions', () => {
    const p = sampleProfile();
    p.city = 'San Jose';
    expect(valueFor('livesIn', p, { label: 'Are you currently living in the San Francisco Bay Area?' })).toEqual(['Yes']);
    p.city = 'Austin';
    expect(valueFor('livesIn', p, { label: 'Are you currently living in the San Francisco Bay Area?' })).toEqual(['No']);
    p.preferences.workMode = 'onsite';
    expect(valueFor('workMode', p, { yesNo: true, label: 'Are you able to work onsite in our Mountain View, CA office?' })).toEqual(['Yes']);
    expect(valueFor('workMode', p, { yesNo: true, label: 'Are you open to remote work?' })).toBeNull();
  });
  it('classifies the three questions', () => {
    const f = (label: string) => ({ kind: 'combobox', label, id: '', name: '', path: '', autocomplete: '', required: true, options: [], members: [] }) as never;
    const k = (label: string) => (classifyField(f(label)) as { key?: string }).key;
    expect(k('Are you legally authorized to work in the United States without requiring visa sponsorship now or in the future?*')).toBe('authorizedNoSponsor');
    expect(k('Are you currently living in the San Francisco Bay Area?')).toBe('livesIn');
    expect(k('Are you able to work onsite in our Mountain View, CA office? (5 days in-office required)')).toBe('workMode');
  });
});

describe('age threshold questions', () => {
  it('compares the saved age to the number asked', () => {
    const p = sampleProfile();
    p.age = '24';
    const k = (label: string) =>
      (classifyField({ kind: 'combobox', label, id: '', name: '', path: '', autocomplete: '', required: true, options: [], members: [] } as never) as { key?: string }).key;
    expect(k('Are you over 18 years of age?')).toBe('ageAtLeast');
    expect(k('Are you 21 years of age or older?')).toBe('ageAtLeast');
    expect(k('Age')).toBe('age');
    expect(valueFor('ageAtLeast', p, { label: 'Are you over 18 years of age?' })).toEqual(['Yes']);
    expect(valueFor('ageAtLeast', p, { label: 'Are you at least 25 years old?' })).toEqual(['No']);
    p.age = '';
    expect(valueFor('ageAtLeast', p, { label: 'Are you over 18 years of age?' })).toBeNull();
  });
});

describe('combined address lines', () => {
  it('fills City, State Zip as one value', () => {
    const p = sampleProfile();
    p.city = 'San Francisco'; p.state = 'CA'; p.zip = '94158';
    const k = (label: string) =>
      (classifyField({ kind: 'text', label, id: '', name: '', path: '', autocomplete: '', required: true, options: [], members: [] } as never) as { key?: string }).key;
    expect(k('City, State Zip code (e.g. San Francisco, CA 94158)')).toBe('cityStateZip');
    expect(k('City, State')).toBe('cityState');
    expect(k('ZIP')).toBe('zip');
    expect(valueFor('cityStateZip', p)![0]).toBe('San Francisco, CA 94158');
    expect(valueFor('cityState', p)![0]).toBe('San Francisco, CA');
  });
});

describe('salary and other people names', () => {
  const desc = 'The base salary range for this role is $100,000 - $120,000 per year.';
  it('uses the posted range, a figure above the midpoint, or the saved amount', () => {
    expect(salaryAnswer('$90,000', desc, 'Salary expectations')).toEqual(['$115,000']);
    expect(salaryAnswer('$90,000', desc, 'What is your expected salary range?')).toEqual(['$100,000 - $120,000']);
    expect(
      salaryAnswer('', 'Annual Base Pay Range\n\n$135,000 - $155,000 USD\n\nPrivacy', 'What are your salary expectations? Please state a range.'),
    ).toEqual(['$135,000 - $155,000 USD']);
    expect(salaryAnswer('$90,000', 'No pay listed', 'Salary expectations')).toEqual(['$90,000']);
    expect(salaryAnswer('$100k-$120k', 'No pay listed', 'Salary expectations')).toEqual(['$100,000']);
    expect(salaryAnswer('$100k-$120k', '', 'Salary range')).toEqual(['$100k-$120k']);
    expect(salaryAnswer('', '', 'Salary')).toBeNull();
    expect(findPayRange('Pay is $100-120k depending on experience')).toMatchObject({ low: 100000, high: 120000 });
    expect(findPayRange('Pay is $55 - $65 per hour')).toMatchObject({ low: 55, high: 65, hourly: true });
  });
  it('does not put your name in a question about someone else', () => {
    const k = (label: string) =>
      (classifyField({ kind: 'text', label, id: '', name: '', path: '', autocomplete: '', required: false, options: [], members: [] } as never) as { kind: string; key?: string });
    expect(k("If you answered yes to the question above, please provide the Golden State Warriors employee's first and last name.").kind).toBe('unknown');
    expect(k('Referral name').kind).toBe('unknown');
    expect(k('Please enter your first and last name').key).toBe('fullName');
    expect(k('Last Name').key).toBe('lastName');
  });
});

describe('degree and school wording', () => {
  it('splits a degree that includes the major', () => {
    const p = sampleProfile();
    p.education[0]!.degree = 'B.S. Computer Science';
    p.education[0]!.major = '';
    expect(valueFor('degree', p)).toContain("Bachelor's Degree");
    expect(valueFor('major', p)).toEqual(['Computer Science']);
    p.education[0]!.degree = 'Bachelor of Science in Computer Science';
    expect(valueFor('degree', p)![0]).toBe('Bachelor of Science');
    expect(valueFor('major', p)).toEqual(['Computer Science']);
  });
  it('matches schools despite commas and hyphens, and builds fallback searches', () => {
    expect(bestOption(['University of California, Santa Cruz'], ['University of California - Santa Cruz', 'University of California - Davis'])).toBe(0);
    expect(searchQueries(['University of California, Santa Cruz']).slice(0, 3)).toEqual([
      'University of California, Santa Cruz',
      'University of California Santa Cruz',
      'University of California Santa',
    ]);
  });
});
