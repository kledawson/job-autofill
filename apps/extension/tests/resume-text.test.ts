import { parseDegreeLine } from '../lib/degree';
import { sanitizeDraft } from '../lib/resume';
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
      degree: "Bachelor's Degree",
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
    expect(d.education[0]).toMatchObject({ school: 'New York University', degree: "Bachelor's Degree", major: 'Economics', endDate: '2026-05' });
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

  it('splits degree, field of study, and honors across common degree line styles', () => {
    const cases: [string, { degree: string; major: string; honors: string }][] = [
      ['B.S. Computer Science, Honors in the Major', { degree: 'B.S.', major: 'Computer Science', honors: 'Honors in the Major' }],
      ['Bachelor of Science in Computer Science with Honors', { degree: 'Bachelor of Science', major: 'Computer Science', honors: 'Honors' }],
      ['Bachelor of Arts (B.A.), Economics, magna cum laude', { degree: 'Bachelor of Arts', major: 'Economics', honors: 'magna cum laude' }],
      ['Computer Science, B.S.', { degree: 'B.S.', major: 'Computer Science', honors: '' }],
      ['M.S. in Data Science, Minor in Statistics', { degree: 'M.S.', major: 'Data Science', honors: '' }],
      ['Ph.D. in Physics', { degree: 'Ph.D.', major: 'Physics', honors: '' }],
      ['B.S. in Computer Science and Engineering, GPA: 3.9', { degree: 'B.S.', major: 'Computer Science and Engineering', honors: '' }],
      ["Bachelor's Degree, Biology", { degree: "Bachelor's Degree", major: 'Biology', honors: '' }],
    ];
    for (const [line, want] of cases) expect(parseDegreeLine(line), line).toEqual(want);
  });

  it('keeps honors out of the field of study on a full education entry', () => {
    const d = parseResumeText([
      'Alex Kim',
      'alex@example.com',
      'Education',
      'University of California, Santa Cruz\tSanta Cruz, CA',
      'B.S. Computer Science, Honors in the Major\tSep 2022 – Jun 2026',
      'GPA: 3.8',
    ]);
    expect(d.education[0]).toMatchObject({
      school: 'University of California, Santa Cruz',
      degree: "Bachelor's Degree",
      major: 'Computer Science',
      honors: 'Honors in the Major',
      gpa: '3.8',
    });
  });

  it('repairs a model reply that put honors in the major', () => {
    const d = sanitizeDraft({
      education: [{ school: 'UCSC', degree: 'B.S.', major: 'the Major', honors: 'B.S. Computer Science, Honors in the Major' }],
    });
    expect(d.education[0]).toMatchObject({ degree: "Bachelor's Degree", major: '', honors: 'Honors in the Major' });
    const e = sanitizeDraft({ education: [{ school: 'UCSC', degree: 'B.S. Computer Science, Honors in the Major', major: '' }] });
    expect(e.education[0]).toMatchObject({ degree: "Bachelor's Degree", major: 'Computer Science', honors: 'Honors in the Major' });
  });

  it('reads education and job dates written in many styles', () => {
    const edu: [string, string, string][] = [
      ['B.S. Computer Science\tSeptember 2022 – Expected June 2026', '2022-09', '2026-06'],
      ['B.S. Computer Science\t2022–2026', '2022-01', '2026-01'],
      ['B.S. Computer Science\t09/2022 – 06/2026', '2022-09', '2026-06'],
      ["B.S. Computer Science\tSep '22 – Jun '26", '2022-09', '2026-06'],
      ['B.S. Computer Science\tFall 2022 – Spring 2026', '2022-09', '2026-05'],
      ['B.S. Computer Science, Expected June 2026', '', '2026-06'],
    ];
    for (const [line, start, end] of edu) {
      const d = parseResumeText(['Alex Kim', 'Education', 'University of California, Santa Cruz', line]);
      expect([d.education[0]?.startDate, d.education[0]?.endDate], line).toEqual([start, end]);
    }
    const jobs: [string[], string, string, boolean][] = [
      [['Software Engineering Intern\tMay – August 2025', 'Acme Corp\tSan Francisco, CA'], '2025-05', '2025-08', false],
      [['Software Engineering Intern\tMay-Aug 2025', 'Acme Corp'], '2025-05', '2025-08', false],
      [["Software Engineering Intern\tJun '25 – Aug '25", 'Acme Corp'], '2025-06', '2025-08', false],
      [['Software Engineering Intern', 'Acme Corp, San Francisco, CA', 'June 2025 – August 2025'], '2025-06', '2025-08', false],
      [['Software Engineering Intern\t06/15/2025 – 08/20/2025', 'Acme Corp'], '2025-06', '2025-08', false],
      [['Software Engineering Intern\tJune 15, 2025 – August 20, 2025', 'Acme Corp'], '2025-06', '2025-08', false],
      [['Software Engineering Intern, Acme Corp (June 2025 – August 2025)'], '2025-06', '2025-08', false],
      [['Software Engineering Intern', 'Acme Corp\tJune 2025 – Present'], '2025-06', '', true],
    ];
    for (const [lines, start, end, current] of jobs) {
      const d = parseResumeText(['Alex Kim', 'Experience', ...lines, '• Built things.']);
      const x = d.experience[0]!;
      expect([x.startDate, x.endDate, x.current], lines.join(' / ')).toEqual([start, end, current]);
      expect(x.company, lines.join(' / ')).toBe('Acme Corp');
    }
  });
});

describe('company and location on one line', () => {
  const job = (second: string) =>
    parseResumeText(['Jordan Rivera', 'jordan@example.com', 'Experience', 'AI Enablement Engineer Intern\tSep. 2026 – Present', second, '◦ Develop AI workflows', '◦ Evaluate LLM outputs'])
      .experience[0];

  it.each([
    ['Majorly, Remote', 'Majorly', 'Remote'],
    ['Majorly, San Francisco, CA', 'Majorly', 'San Francisco, CA'],
    ['Majorly\tRemote', 'Majorly', 'Remote'],
    ['Majorly | Austin, Texas', 'Majorly', 'Austin, Texas'],
    ['Majorly (Hybrid)', 'Majorly', 'Hybrid'],
  ])('reads %s as the company and location', (line, company, location) => {
    expect(job(line)).toMatchObject({ title: 'AI Enablement Engineer Intern', company, location, current: true, bullets: 'Develop AI workflows\nEvaluate LLM outputs' });
  });

  it('cleans a Gemini reply that put the location in the company', () => {
    expect(sanitizeDraft({ experience: [{ title: 'Intern', company: 'Majorly, Remote' }] }).experience[0]).toMatchObject({ company: 'Majorly', location: 'Remote' });
  });
});
