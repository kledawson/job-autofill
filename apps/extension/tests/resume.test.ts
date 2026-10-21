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

describe('re-importing an updated resume', () => {
  const oldJob = { title: 'Data Analyst', company: 'Northwind', location: 'Remote', startDate: '2024-01', endDate: '', current: true, bullets: 'My own bullet' };
  const updated = () => {
    const p = sampleProfile();
    p.currentTitle = 'Data Analyst';
    p.currentCompany = 'Northwind';
    p.previousTitle = '';
    p.previousCompany = '';
    p.experience = [oldJob];
    p.skills = ['Python'];
    return p;
  };
  const draft = sanitizeDraft({
    experience: [
      { title: 'Data Engineer', company: 'Contoso', startDate: '2026-08', endDate: 'Present', bullets: 'Built pipelines' },
      { title: 'Data Analyst', company: 'Northwind', startDate: '2024-01', endDate: '2026-07', bullets: 'Their bullet' },
    ],
    education: [{ school: 'Example State University', degree: 'M.S.', major: 'Data Science', startDate: '2026-09' }],
    skills: ['python', 'SQL', 'Airflow'],
  });

  it('adds the new job first and ends the old current one without touching its typed details', () => {
    const { profile, filled } = mergeResumeDraft(updated(), draft);
    expect(profile.experience.map((x) => x.company)).toEqual(['Contoso', 'Northwind']);
    expect(profile.experience[0]).toMatchObject({ title: 'Data Engineer', current: true, bullets: 'Built pipelines' });
    expect(profile.experience[1]).toMatchObject({ current: false, endDate: '2026-07', bullets: 'My own bullet' });
    expect(profile).toMatchObject({ currentTitle: 'Data Engineer', currentCompany: 'Contoso', previousTitle: 'Data Analyst', previousCompany: 'Northwind' });
    expect(filled).toEqual(expect.arrayContaining(['1 job', 'job details', 'current position', 'previous employer']));
  });

  it('adds skills and schools that are not saved yet, ignoring case', () => {
    const { profile, filled } = mergeResumeDraft(updated(), draft);
    expect(profile.skills).toEqual(['Python', 'SQL', 'Airflow']);
    expect(profile.education.map((e) => e.school)).toContain('Example State University');
    expect(profile.education.length).toBe(sampleProfile().education.length + 1);
    expect(filled).toEqual(expect.arrayContaining(['2 skills', '1 school']));
  });

  it('adds nothing the second time', () => {
    const once = mergeResumeDraft(updated(), draft).profile;
    const twice = mergeResumeDraft(once, draft);
    expect(twice.profile).toEqual(once);
    expect(twice.filled).toEqual([]);
  });

  it('keeps a current position the resume does not show has ended', () => {
    const p = updated();
    p.currentCompany = 'Fabrikam';
    p.currentTitle = 'Consultant';
    const { profile } = mergeResumeDraft(p, draft);
    expect(profile).toMatchObject({ currentCompany: 'Fabrikam', currentTitle: 'Consultant', previousCompany: 'Northwind' });
  });
});

describe('a company saved with its location attached', () => {
  it('is split when the resume is read again', () => {
    const p = sampleProfile();
    p.currentCompany = 'Majorly, Remote';
    p.currentTitle = 'AI Enablement Engineer Intern';
    p.experience = [{ title: 'AI Enablement Engineer Intern', company: 'Majorly, Remote', location: '', startDate: '2026-09', endDate: '', current: true, bullets: 'Mine' }];
    const draft = sanitizeDraft({ experience: [{ title: 'AI Enablement Engineer Intern', company: 'Majorly', location: 'Remote', startDate: '2026-09', endDate: 'Present' }] });
    const { profile } = mergeResumeDraft(p, draft);
    expect(profile.experience).toHaveLength(1);
    expect(profile.experience[0]).toMatchObject({ company: 'Majorly', location: 'Remote', bullets: 'Mine' });
    expect(profile.currentCompany).toBe('Majorly');
  });
});
