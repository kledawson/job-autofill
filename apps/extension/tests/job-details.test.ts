// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { formatLocation, inferWorkMode, normalizeWorkMode, readJobDetails } from '../lib/job-details';

function page(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe('formatLocation', () => {
  it('drops a trailing country but keeps city and state', () => {
    expect(formatLocation('San Francisco, CA, United States')).toBe('San Francisco, CA');
    expect(formatLocation('  Austin,  TX ')).toBe('Austin, TX');
    expect(formatLocation('Remote - US')).toBe('Remote - US');
    expect(formatLocation('x'.repeat(200))).toBe('');
  });
});

describe('work model', () => {
  it('reads short labels', () => {
    expect(normalizeWorkMode('Hybrid')).toBe('Hybrid');
    expect(normalizeWorkMode('OnSite')).toBe('On-site');
    expect(normalizeWorkMode('Remote - US')).toBe('Remote');
    expect(normalizeWorkMode('unspecified')).toBe('');
  });
  it('needs explicit statements in a description', () => {
    expect(inferWorkMode('This is a hybrid role, three days a week in Austin.')).toBe('Hybrid');
    expect(inferWorkMode('We are a remote-first company.')).toBe('Remote');
    expect(inferWorkMode('Support remote teammates and on-site events.')).toBe('');
  });
});

describe('readJobDetails', () => {
  it('prefers the posting data embedded in the page', () => {
    const doc = page(`<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      jobLocation: { address: { addressLocality: 'Denver', addressRegion: 'CO', addressCountry: 'US' } },
    })}</script>`);
    expect(readJobDetails(doc, 'This is a hybrid position.', 'Engineer')).toEqual({ location: 'Denver, CO', workMode: 'Hybrid', pay: '' });
  });
  it('treats TELECOMMUTE postings as remote', () => {
    const doc = page(`<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', jobLocationType: 'TELECOMMUTE' })}</script>`);
    expect(readJobDetails(doc, '', 'Engineer').workMode).toBe('Remote');
  });
  it('falls back to page elements and returns blanks when nothing is stated', () => {
    expect(readJobDetails(page('<div class="job__location">Boston, MA, United States</div>'), '', 'Designer')).toEqual({
      location: 'Boston, MA',
      workMode: '',
      pay: '',
    });
    expect(readJobDetails(page('<p>Nothing here</p>'), '', 'Designer')).toEqual({ location: '', workMode: '', pay: '' });
  });
});

describe('pay', () => {
  it('uses structured salary data when the page has it', () => {
    const doc = page(`<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      baseSalary: { '@type': 'MonetaryAmount', currency: 'USD', value: { minValue: 120000, maxValue: 150000, unitText: 'YEAR' } },
    })}</script>`);
    expect(readJobDetails(doc, '', 'Engineer').pay).toBe('$120,000 - $150,000');
  });
  it('reads hourly structured pay', () => {
    const doc = page(`<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      baseSalary: { currency: 'USD', value: { minValue: 40, maxValue: 55, unitText: 'HOUR' } },
    })}</script>`);
    expect(readJobDetails(doc, '', 'Tech').pay).toBe('$40/hour - $55/hour');
  });
  it('finds a range stated in the description', () => {
    expect(readJobDetails(page(''), 'The base salary range for this role is $130,000 - $160,000 USD per year.', 'PM').pay).toBe(
      '$130,000 - $160,000 USD',
    );
  });
  it('is blank when no pay is posted', () => {
    expect(readJobDetails(page(''), 'We offer great benefits and a 401k match.', 'PM').pay).toBe('');
  });
});
