import { describe, expect, it } from 'vitest';
import { splitTitle } from '@/lib/autofill/adapters';

describe('splitTitle', () => {
  it('reads "Role at Company | Handshake"', () => {
    expect(splitTitle('Software Engineer Intern at Acme Corp | Handshake')).toEqual({ role: 'Software Engineer Intern', company: 'Acme Corp' });
  });
  it('reads "Role - Company - Handshake"', () => {
    expect(splitTitle('Analyst - Acme - Handshake')).toEqual({ role: 'Analyst', company: 'Acme' });
  });
  it('drops "Careers at" from the company', () => {
    expect(splitTitle('Account Manager - Careers at Airbnb')).toEqual({ role: 'Account Manager', company: 'Airbnb' });
  });
  it('leaves the company blank when the title only has a role', () => {
    expect(splitTitle('Analyst | Careers')).toEqual({ role: 'Analyst', company: '' });
  });
});
