import { describe, expect, it } from 'vitest';
import { missingSections, parseResumeText, toMonth } from '../lib/resume-text';

// Layout A: right-aligned dates (tabs), bullet glyphs, labeled skills.
const RESUME_A = [
  'JORDAN RIVERA',
  'San Francisco, CA 94110 | (415) 555-0100 | jordan@example.com | linkedin.com/in/jordanrivera | github.com/jordanrivera',
  'EDUCATION',
  'University of California, Berkeley\tBerkeley, CA',
  'Bachelor of Science in Computer Science, Minor in Data Science\tAug 2022 – May 2026',
  'GPA: 3.8/4.0, Dean’s List',
  'EXPERIENCE',
  'Software Engineering Intern\tJun 2025 – Present',
  'Acme Corp\tSan Francisco, CA',
  '• Built a billing dashboard in React used by 40 support agents, cutting ticket time',
  'by 25%.',
  '• Cut API p95 latency 30% by adding caching.',
  'Teaching Assistant\tAug 2023 – May 2024',
  'UC Berkeley EECS\tBerkeley, CA',
  '• Led weekly sections for 30 students.',
  'PROJECTS',
  'Budget App\t2024',
  '• Side project.',
  'TECHNICAL SKILLS',
  'Languages: Python, TypeScript, SQL, Java',
  'Frameworks: React, Node.js',
];

// Layout B: pipes, "Title at Company", no bullet glyphs, expected graduation.
const RESUME_B = [
  'Sam Lee',
  'sam.lee@example.org · 212-555-0199 · Brooklyn, NY · samlee.dev',
  'Work Experience',
  'Data Analyst at Northwind Traders | 06/2024 - Present',
  'Built weekly revenue reports in SQL and Tableau for the finance team.',
  'Automated data cleaning with Python, saving 5 hours per week.',
  'Education',
  'New York University — B.A., Economics',
  'Expected May 2026',
  'Skills',
  'Excel, SQL, Python, Tableau',
];

describe('local resume reader', () => {
  it('reads contact details, links, and location', () => {
    const d = parseResumeText(RESUME_A);
    expect(d).toMatchObject({
      firstName: 'Jordan',
      lastName: 'Rivera',
      email: 'jordan@example.com',
      phone: '(415) 555-0100',
      city: 'San Francisco',
      state: 'CA',
      zip: '94110',
      linkedin: 'https://linkedin.com/in/jordanrivera',
      github: 'https://github.com/jordanrivera',
    });
  });

  it('reads education with degree, major, dates, and GPA', () => {
    const [edu] = parseResumeText(RESUME_A).education;
    expect(edu).toMatchObject({
      school: 'University of California, Berkeley',
      degree: 'Bachelor of Science',
      major: 'Computer Science',
      gpa: '3.8',
      startDate: '2022-08',
      endDate: '2026-05',
    });
  });

  it('reads jobs, joins wrapped bullets, and finds the current position', () => {
    const d = parseResumeText(RESUME_A);
    expect(d.experience).toHaveLength(2);
    expect(d.experience[0]).toMatchObject({
      title: 'Software Engineering Intern',
      company: 'Acme Corp',
      location: 'San Francisco, CA',
      startDate: '2025-06',
      current: true,
    });
    expect(d.experience[0]!.bullets.split('\n')).toEqual([
      'Built a billing dashboard in React used by 40 support agents, cutting ticket time by 25%.',
      'Cut API p95 latency 30% by adding caching.',
    ]);
    expect(d.experience[1]).toMatchObject({ title: 'Teaching Assistant', company: 'UC Berkeley EECS', endDate: '2024-05' });
    expect(d.currentTitle).toBe('Software Engineering Intern');
    // Projects are not jobs.
    expect(d.experience.some((x) => /budget/i.test(x.title + x.company))).toBe(false);
  });

  it('reads labeled skill lists', () => {
    expect(parseResumeText(RESUME_A).skills).toEqual(['Python', 'TypeScript', 'SQL', 'Java', 'React', 'Node.js']);
  });

  it('handles a pipe-separated layout without bullet glyphs', () => {
    const d = parseResumeText(RESUME_B);
    expect(d).toMatchObject({ firstName: 'Sam', lastName: 'Lee', email: 'sam.lee@example.org', city: 'Brooklyn', state: 'NY' });
    expect(d.portfolio).toBe('https://samlee.dev');
    expect(d.experience[0]).toMatchObject({ title: 'Data Analyst', company: 'Northwind Traders', startDate: '2024-06', current: true });
    expect(d.experience[0]!.bullets.split('\n')).toHaveLength(2);
    expect(d.education[0]).toMatchObject({ school: 'New York University', degree: 'B.A.', major: 'Economics', endDate: '2026-05' });
    expect(d.skills).toEqual(['Excel', 'SQL', 'Python', 'Tableau']);
    expect(missingSections(d)).toEqual([]);
  });

  it('reports sections it could not find', () => {
    const d = parseResumeText(['Jordan Rivera', 'jordan@example.com', 'Some unrecognized text block']);
    expect(d.firstName).toBe('Jordan');
    expect(missingSections(d)).toEqual(['education', 'experience', 'skills']);
  });

  it('converts resume dates', () => {
    expect(toMonth('Sept. 2024')).toBe('2024-09');
    expect(toMonth('Summer 2025')).toBe('2025-06');
    expect(toMonth('3/2023')).toBe('2023-03');
    expect(toMonth('2021')).toBe('2021-01');
  });

  it('keeps a location on the company line out of the company', () => {
    const d = parseResumeText([
      'Sam Lee',
      'sam.lee@example.org',
      'Experience',
      'Data Analyst, Northwind Traders, Seattle, WA | Jun 2024 - Present',
      '• Built weekly reports.',
    ]);
    expect(d.experience[0]).toMatchObject({ title: 'Data Analyst', company: 'Northwind Traders', location: 'Seattle, WA' });
    const e = parseResumeText([
      'Sam Lee',
      'Experience',
      'Data Analyst\tJun 2024 - Present',
      'Northwind Traders, Seattle, WA',
      '• Built weekly reports.',
    ]).experience[0];
    expect(e).toMatchObject({ company: 'Northwind Traders', location: 'Seattle, WA' });
  });

  it('gives a one-month job the same start and end month', () => {
    const d = parseResumeText(['Sam Lee', 'Experience', 'Camp Counselor\tJun 2024', 'Camp Pine, Austin, TX', '• Led activities.']);
    expect(d.experience[0]).toMatchObject({ startDate: '2024-06', endDate: '2024-06', current: false });
  });
});
