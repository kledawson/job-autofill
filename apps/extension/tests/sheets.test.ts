import { describe, expect, it } from 'vitest';
import { columnLetter, firstEmptyRow, parseSheetUrl, planRow, rowFor } from '../lib/sheets';
import type { Application } from '../lib/types';

const app: Application = {
  url: 'https://boards.greenhouse.io/acme/jobs/1',
  jobKey: 'k',
  company: 'Acme',
  role: '=HYPERLINK("http://evil")',
  platform: 'greenhouse',
  status: 'Submitted',
  filledAt: new Date(2026, 9, 5, 9, 30).getTime(),
  submittedAt: new Date(2026, 9, 6, 14, 5).getTime(),
  aiAnswers: 2,
  location: 'Austin, TX',
  workMode: 'Hybrid',
  basePay: '$120,000 - $150,000',
  filledCount: 10,
  missingCount: 0,
  missingLabels: [],
};

describe('parseSheetUrl', () => {
  it('extracts the spreadsheet ID from common link shapes', () => {
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/1aB_c-D/edit#gid=0')).toBe('1aB_c-D');
    expect(parseSheetUrl('  https://docs.google.com/spreadsheets/u/1/d/abc123/edit?usp=sharing ')).toBe('abc123');
  });
  it('rejects other links and text', () => {
    expect(parseSheetUrl('https://docs.google.com/document/d/abc/edit')).toBeNull();
    expect(parseSheetUrl('https://evil.example/spreadsheets/d/abc')).toBeNull();
    expect(parseSheetUrl('http://docs.google.com/spreadsheets/d/abc')).toBeNull();
    expect(parseSheetUrl('not a link')).toBeNull();
  });
});

describe('rowFor', () => {
  it('writes only the selected details in order, using the submit date as date applied', () => {
    expect(rowFor(app, ['company', 'dateApplied', 'jobUrl'])).toEqual(['Acme', '2026-10-06', app.url]);
  });
  it('writes location and work model, blank when the posting did not say', () => {
    expect(rowFor(app, ['location', 'workModel'])).toEqual(['Austin, TX', 'Hybrid']);
    expect(rowFor({ ...app, location: undefined, workMode: undefined }, ['location', 'workModel'])).toEqual(['', '']);
  });
  it('links the job posting, not a separate application form', () => {
    const form = { ...app, platform: 'other' as const, url: 'https://ats.rippling.com/contoso/jobs/b1af21a2-0000/apply?jobBoardSlug=contoso&jobId=b1af21a2-0000&step=application' };
    expect(rowFor(form, ['jobUrl'])).toEqual(['https://ats.rippling.com/contoso/jobs/b1af21a2-0000']);
  });
  it('neutralizes formulas from page text', () => {
    expect(rowFor(app, ['role'])).toEqual(["'=HYPERLINK(\"http://evil\")"]);
  });
});

describe('planRow', () => {
  const headers = ['Company Name', 'Position', 'Location', 'Date Applied', 'Status', 'Referral', 'Link', 'Application Portal'];
  const plain = { ...app, role: 'Engineer' };
  const place = (h: string[]) => Object.fromEntries(planRow(h, plain).map((c) => [c.index, c.value]));

  it('puts each detail under the header that names it, whatever the order', () => {
    expect(place(headers)).toEqual({ 0: 'Acme', 1: 'Engineer', 2: 'Austin, TX', 3: '2026-10-06', 4: 'Applied', 6: plain.url });
  });
  it('never touches unrelated columns (Referral, Notes, ...) and skips details the sheet has no column for', () => {
    const cells = planRow(['Company', 'Referral', 'Notes'], plain);
    expect(cells.map((c) => [c.index, c.key])).toEqual([[0, 'company']]);
  });
  it('matches other wording and lets closer names win over looser ones', () => {
    expect(place(['Employer', 'Job Title', 'Date', 'Date Applied', 'Job Posting URL'])).toEqual({
      0: 'Acme',
      1: 'Engineer',
      3: '2026-10-06',
      4: plain.url,
    });
  });
  it('handles a wide tracker with many unrelated columns', () => {
    const wide = ['ID', 'Found', 'Company', 'Role', 'Track', 'Location', 'Work model', 'Base pay', 'Fit', 'Review lane', 'Application status', 'Why it fits', 'Gap / check', 'Posting URL', 'Source check', 'Resume version', 'Applied date', 'Last status update', 'Next action', 'Email evidence'];
    const cells = planRow(wide, plain);
    expect(cells.map((c) => [wide[c.index], c.key, c.value])).toEqual([
      ['Company', 'company', 'Acme'],
      ['Role', 'role', 'Engineer'],
      ['Applied date', 'dateApplied', '2026-10-06'],
      ['Posting URL', 'jobUrl', plain.url],
      ['Location', 'location', 'Austin, TX'],
      ['Work model', 'workModel', 'Hybrid'],
      ['Base pay', 'basePay', '$120,000 - $150,000'],
      ['Application status', 'status', 'Applied'],
      ['Found', 'found', '2026-10-06'],
    ]);
    expect(cells.some((c) => ['Next action', 'Last status update'].includes(wide[c.index]!))).toBe(false);
  });
  it('only treats an exact "Status" header as the status, never "Last status update"', () => {
    expect(planRow(['Company', 'Last status update'], plain).map((c) => c.key)).toEqual(['company']);
    expect(planRow(['Company', 'Status'], plain).map((c) => c.key)).toEqual(['company', 'status']);
  });
  it('finds nothing in unrelated headers', () => {
    expect(planRow(['Foo', 'Bar'], plain)).toEqual([]);
  });
});

describe('columnLetter', () => {
  it('converts indexes to letters', () => {
    expect([0, 25, 26, 27, 51, 52].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
});

describe('firstEmptyRow', () => {
  it('uses the first row with nothing in the target columns, even between filled rows', () => {
    const rows = [['A', 'x'], ['B', 'y'], [], ['C', 'z']];
    expect(firstEmptyRow(rows, [0, 1], 0)).toBe(2);
  });
  it('ignores other columns such as a prefilled status', () => {
    const rows = [['A', 'x', 'Applied'], ['', '', 'Applied'], ['', '', '']];
    expect(firstEmptyRow(rows, [0, 1], 0)).toBe(1);
  });
  it('appends after the last row when none is free, and accounts for a table that starts after column A', () => {
    expect(firstEmptyRow([['A'], ['B']], [0], 0)).toBe(2);
    expect(firstEmptyRow([['', 'A'], ['', '']], [0], 1)).toBe(1);
    expect(firstEmptyRow([], [0], 0)).toBe(0);
  });
});
