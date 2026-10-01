import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emptyProfile, type Profile } from '../lib/types';

export function sampleProfile(): Profile {
  const p = emptyProfile();
  return {
    ...p,
    firstName: 'Jordan',
    lastName: 'Rivera',
    preferredName: 'Jo',
    email: 'jordan@example.com',
    phone: '415-555-0100',
    city: 'San Francisco',
    state: 'CA',
    zip: '94110',
    country: 'United States',
    linkedin: 'https://linkedin.com/in/jordanrivera',
    github: 'https://github.com/jordanrivera',
    portfolio: 'https://jordan.dev',
    workAuth: { ...emptyProfile().workAuth, authorizedUS: 'yes', needsSponsorship: 'no', status: 'US Citizen' },
    education: [
      {
        school: 'University of California, Berkeley',
        degree: 'Bachelor of Science',
        major: 'Computer Science',
        gpa: '3.8',
        startDate: '2022-08',
        endDate: '2026-05',
        honors: "Dean's List",
      },
    ],
    experience: [
      {
        title: 'Software Engineering Intern',
        company: 'Acme Corp',
        location: 'San Francisco, CA',
        startDate: '2025-06',
        endDate: '2025-08',
        current: false,
        bullets: 'Built a billing dashboard in React used by 40 support agents\nCut API p95 latency 30% by adding caching',
      },
    ],
    skills: ['TypeScript', 'React', 'Python', 'SQL'],
    preferences: { salary: '$120,000', startDate: 'June 2026', relocate: 'yes', workMode: 'hybrid', howHeard: 'LinkedIn' },
    eeo: { autofillSaved: false, gender: 'Female', race: 'Decline to answer', hispanic: 'Decline to answer', veteran: 'I am not a protected veteran', disability: 'Decline to answer' },
  };
}

/** Loads a fixture into the test document at the given URL. */
export function loadFixture(name: string, url: string): Document {
  const html = readFileSync(resolve(__dirname, '../../../tests/fixtures', name), 'utf8');
  (window as any).happyDOM.setURL(url);
  document.documentElement.innerHTML = html.replace(/^<!doctype html>\s*<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
  return document;
}
