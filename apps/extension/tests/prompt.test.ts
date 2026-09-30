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
  it('prefers the Current position field over the current job', () => {
    const p = sampleProfile();
    p.experience[0]!.current = true;
    expect(valueFor('currentTitle', p)).toEqual(['Software Engineering Intern']);
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
