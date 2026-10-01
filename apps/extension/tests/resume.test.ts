import { describe, expect, it } from 'vitest';
import { mergeResumeDraft, sanitizeDraft } from '../lib/resume';
import { emptyProfile } from '../lib/types';
import { sampleProfile } from './helpers';

const reply = {
  firstName: '  Jordan ',
  lastName: 'Rivera',
  email: 'jordan@example.com',
  phone: '(415) 555-0100',
  city: 'San Francisco',
  state: 'CA',
  country: 'United States',
  linkedin: 'linkedin.com/in/jordanrivera',
  github: 'not a url at all',
  currentTitle: 'Teaching Assistant',
  education: [
    { school: 'University of California, Berkeley', degree: 'B.S.', major: 'Computer Science', startDate: '2022', endDate: 'May 2026' },
    { school: '', degree: 'orphan' },
  ],
  experience: [
    { title: 'Teaching Assistant', company: 'UC Berkeley', current: true, endDate: '2026-05', bullets: '• Led weekly sections\n- Graded 200 exams\n\n' },
  ],
  skills: ['Python', 'Python', '  SQL ', 42],
  eeo: { gender: 'Female' },
  workAuth: { authorizedUS: 'yes' },
};

describe('resume draft validation', () => {
  it('cleans strings, dates, links, and lists from the model reply', () => {
    const d = sanitizeDraft(reply);
    expect(d.firstName).toBe('Jordan');
    expect(d.linkedin).toBe('https://linkedin.com/in/jordanrivera');
    expect(d.github).toBe('');
    expect(d.education).toHaveLength(1);
    expect(d.education[0]).toMatchObject({ startDate: '2022-01', endDate: '2026-05' });
    expect(d.experience[0]).toMatchObject({ current: true, endDate: '', bullets: 'Led weekly sections\nGraded 200 exams' });
    expect(d.skills).toEqual(['Python', 'SQL']);
  });

  it('ignores anything a resume should not decide, and survives garbage', () => {
    const d = sanitizeDraft(reply) as unknown as Record<string, unknown>;
    expect(d.eeo).toBeUndefined();
    expect(d.workAuth).toBeUndefined();
    expect(sanitizeDraft('nonsense').education).toEqual([]);
    expect(sanitizeDraft({ email: 'not-an-email' }).email).toBe('');
  });
});

describe('merging a resume into the profile', () => {
  it('fills an empty profile', () => {
    const { profile, filled } = mergeResumeDraft(emptyProfile(), sanitizeDraft(reply));
    expect(profile.firstName).toBe('Jordan');
    expect(profile.currentTitle).toBe('Teaching Assistant');
    expect(profile.education[0]?.school).toBe('University of California, Berkeley');
    expect(profile.experience[0]?.company).toBe('UC Berkeley');
    expect(profile.skills).toEqual(['Python', 'SQL']);
    expect(profile.eeo.gender).toBe('Decline to answer');
    expect(filled).toEqual(expect.arrayContaining(['first name', 'email', 'current position', 'education', 'experience', 'skills']));
  });

  it('never overwrites what the user already entered', () => {
    const mine = sampleProfile();
    mine.phone = '';
    const { profile, filled } = mergeResumeDraft(mine, sanitizeDraft({ ...reply, firstName: 'Someone', city: 'Boston' }));
    expect(profile.firstName).toBe('Jordan');
    expect(profile.city).toBe('San Francisco');
    expect(profile.education[0]?.degree).toBe('Bachelor of Science');
    expect(profile.experience[0]?.company).toBe('Acme Corp');
    expect(profile.phone).toBe('(415) 555-0100');
    expect(filled).toContain('phone');
    expect(filled).not.toContain('first name');
  });
});

describe('asking Gemini for only what is missing', () => {
  it('limits the schema and prompt to the requested sections', async () => {
    const { sectionRequest } = await import('../lib/resume');
    const { schema, prompt } = sectionRequest(['experience']);
    expect(Object.keys(schema.properties)).toEqual(['experience']);
    expect(prompt).toContain('Only extract these sections: experience.');
    expect(Object.keys(sectionRequest(undefined).schema.properties)).toContain('firstName');
  });
});

describe('model date wording', () => {
  it('accepts month names and slashes as well as YYYY-MM', () => {
    const d = sanitizeDraft({
      education: [{ school: 'UCSC', startDate: 'Sep 2022', endDate: 'June 2026' }],
      experience: [{ title: 'Intern', company: 'Acme', startDate: '06/2025', endDate: 'Present' }],
    });
    expect([d.education[0]!.startDate, d.education[0]!.endDate]).toEqual(['2022-09', '2026-06']);
    expect([d.experience[0]!.startDate, d.experience[0]!.endDate, d.experience[0]!.current]).toEqual(['2025-06', '', true]);
  });
});

describe('re-importing into a profile that already has entries', () => {
  it('fills the empty dates and details without touching what is there', () => {
    const p = sampleProfile();
    p.experience = [{ title: 'Data Operations Technician', company: 'Meta Platforms (via QualityAI)', location: '', startDate: '', endDate: '', current: false, bullets: 'My own bullet' }];
    p.education = [{ school: 'University of California, Santa Cruz', degree: "Bachelor's Degree", major: 'Computer Science', gpa: '', startDate: '', endDate: '', honors: '' }];
    const draft = sanitizeDraft({
      experience: [{ title: 'Data Operations Technician', company: 'Meta Platforms (via QualityAI)', location: 'Remote', startDate: '2026-04', endDate: '2026-06', current: false, bullets: 'Their bullet' }],
      education: [{ school: 'University of California - Santa Cruz', degree: 'B.S.', major: 'CS', startDate: '2022-09', endDate: '2026-06' }],
    });
    const { profile, filled } = mergeResumeDraft(p, draft);
    expect(profile.experience[0]).toMatchObject({ startDate: '2026-04', endDate: '2026-06', location: 'Remote', bullets: 'My own bullet' });
    expect(profile.education[0]).toMatchObject({ startDate: '2022-09', endDate: '2026-06', degree: "Bachelor's Degree", major: 'Computer Science' });
    expect(filled).toEqual(expect.arrayContaining(['education details', 'job details']));
  });
});
