import { describe, expect, it } from 'vitest';
import { isJobLocation, splitJobLocation } from '../lib/job-location';

describe('job locations', () => {
  it.each([
    ['Majorly, Remote', 'Majorly', 'Remote'],
    ['Majorly, Fully Remote', 'Majorly', 'Fully Remote'],
    ['Majorly, Remote (US)', 'Majorly', 'Remote (US)'],
    ['Acme Corp, San Francisco, CA', 'Acme Corp', 'San Francisco, CA'],
    ['Acme Corp, Austin, TX 78701', 'Acme Corp', 'Austin, TX 78701'],
    ['Acme, Inc., New York, NY, USA', 'Acme, Inc.', 'New York, NY, USA'],
    ['Acme Corp, Austin, Texas', 'Acme Corp', 'Austin, Texas'],
    ['Globex, London, United Kingdom', 'Globex', 'London, United Kingdom'],
    ['Globex, California', 'Globex', 'California'],
    ['Acme Corp (Hybrid)', 'Acme Corp', 'Hybrid'],
    ['Acme Corp (Seattle, WA)', 'Acme Corp', 'Seattle, WA'],
    ['Majorly – Remote', 'Majorly', 'Remote'],
    ['Acme, On-site', 'Acme', 'On-site'],
  ])('splits %s', (text, name, location) => {
    expect(splitJobLocation(text)).toEqual({ name, location });
  });

  it.each(['Acme, Inc.', 'Acme, LLC', 'Acme, Co', 'University of California, Santa Cruz', 'Meta Platforms (via QualityAI)', 'Remote Year', 'Texas Instruments'])(
    'leaves %s whole',
    (text) => {
      expect(splitJobLocation(text)).toEqual({ name: text, location: '' });
    },
  );

  it('recognizes a location on its own', () => {
    expect(isJobLocation('Remote')).toBe(true);
    expect(isJobLocation('San Francisco, CA')).toBe(true);
    expect(isJobLocation('Majorly')).toBe(false);
    expect(isJobLocation('California')).toBe(false);
  });
});
