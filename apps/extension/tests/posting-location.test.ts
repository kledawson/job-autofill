import { describe, expect, it } from 'vitest';
import { postingUrl } from '../lib/platforms';
import { workdayLocation } from '../lib/autofill/adapters';
import { formatLocation } from '../lib/job-details';

describe('postingUrl', () => {
  it('turns a Workday application step into the posting link', () => {
    expect(
      postingUrl('https://centricsoftware.wd501.myworkdayjobs.com/en-US/centric/job/Campbell%2C-CA/Software-Engineer-1_JR396/apply/autofillWithResume'),
    ).toBe('https://centricsoftware.wd501.myworkdayjobs.com/en-US/centric/job/Software-Engineer-1_JR396');
    expect(postingUrl('https://acme.wd5.myworkdayjobs.com/acme/job/Austin-TX/Engineer_R12?source=x')).toBe(
      'https://acme.wd5.myworkdayjobs.com/acme/job/Engineer_R12',
    );
  });
  it('drops the form route on Lever and Ashby and keeps Greenhouse as is', () => {
    expect(postingUrl('https://jobs.lever.co/acme/abc-123/apply')).toBe('https://jobs.lever.co/acme/abc-123');
    expect(postingUrl('https://jobs.ashbyhq.com/acme/abc-123/application#x')).toBe('https://jobs.ashbyhq.com/acme/abc-123');
    expect(postingUrl('https://job-boards.greenhouse.io/acme/jobs/123?gh_jid=123')).toBe('https://job-boards.greenhouse.io/acme/jobs/123?gh_jid=123');
  });
  it('links a company board posting rather than its separate application route', () => {
    expect(postingUrl('https://ats.rippling.com/contoso/jobs/b1af21a2-0000/apply?jobBoardSlug=contoso&jobId=b1af21a2-0000&step=application'))
      .toBe('https://ats.rippling.com/contoso/jobs/b1af21a2-0000');
    expect(postingUrl('https://apply.example.com/contoso/j/ABC123/apply/')).toBe('https://apply.example.com/contoso/j/ABC123');
    // A query that identifies something else stays.
    expect(postingUrl('https://careers.example.com/jobs/42/apply?lang=en')).toBe('https://careers.example.com/jobs/42?lang=en');
  });
  it('keeps a company form that is the posting itself', () => {
    expect(postingUrl('https://careers.example.com/apply?id=42')).toBe('https://careers.example.com/apply?id=42');
    expect(postingUrl('https://careers.example.com/jobs/42')).toBe('https://careers.example.com/jobs/42');
    expect(postingUrl('https://careers.example.com/jobs/42/apply/step-2/review')).toBe('https://careers.example.com/jobs/42/apply/step-2/review');
  });
});

describe('location formatting', () => {
  it('reads Workday location slugs as City, ST', () => {
    expect(workdayLocation('Campbell%2C-CA')).toBe('Campbell, CA');
    expect(workdayLocation('Santa-Clara-CA')).toBe('Santa Clara, CA');
    expect(workdayLocation('US-CA-San-Jose')).toBe('San Jose, CA');
    expect(workdayLocation('London')).toBe('London');
    expect(workdayLocation('Multiple-Locations')).toBe('');
  });
  it('strips country codes and office words from office names', () => {
    expect(formatLocation('US Campbell HQ')).toBe('Campbell');
    expect(formatLocation('US-CA-San Jose')).toBe('San Jose, CA');
    expect(formatLocation('USA - TX - Austin')).toBe('Austin, TX');
  });
});
