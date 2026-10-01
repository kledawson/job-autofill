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
