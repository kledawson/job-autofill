import { describe, expect, it } from 'vitest';
import { applyProfileConfirmation, proposeProfileUpdate, proposeConfirmedProfileUpdate } from '../lib/profile-learning';
import { parseCapture, type CapturedAnswer, type RememberedMapping } from '../lib/remembered-mappings';
import { valueFor } from '../lib/autofill/values';
import { emptyEducation } from '../lib/types';
import { sampleProfile } from './helpers';
const capture = (label: string, value: string): CapturedAnswer => ({ label, value, token: 'token', captureId: 'capture', kind: 'select', options: [], selectionMode: 'single' });
describe('confirmed profile learning', () => {
  it('routes exact GPA to the profile without changing other facts', () => {
    const p = sampleProfile(); p.education[0]!.gpa = '';
    const c = capture('GPA', '3.5 out of 4.0'), expected = proposeProfileUpdate(c, p)!;
    expect(expected).toMatchObject({ key: 'gpa', value: '3.5', previous: '', index: 0 });
    expect(() => applyProfileConfirmation(p, c, { value: '3.9', expected: { ...expected, value: '3.9' }, replace: false })).toThrow('Capture it again');
    const next = applyProfileConfirmation(p, c, { value: expected.value, expected, replace: false });
    expect(next.education[0]!.gpa).toBe('3.5'); expect(p.education[0]!.gpa).toBe('');
    expect(valueFor('gpa', next, { label: 'Undergraduate GPA' })).toEqual(['3.5']);
  });
  it.each(['3.0–3.5', '3.5 / 5.0', '4.5', 'Not applicable', '3.5 or above'])('does not invent an exact GPA from %s', value => {
    expect(proposeProfileUpdate(capture('GPA', value), sampleProfile())).toBeNull();
  });
  it('identifies education level and skips absent or ambiguous entries', () => {
    const p = sampleProfile(); p.education.push({ ...emptyEducation(), school: 'Fictional Graduate University', degree: 'Master of Science', gpa: '3.7' });
    expect(proposeProfileUpdate(capture('GPA (Graduate)', '3.9'), p)).toMatchObject({ index: 1, previous: '3.7' });
    expect(proposeProfileUpdate(capture('GPA (Doctorate)', '3.9'), p)).toBeNull();
    expect(proposeProfileUpdate(capture('GPA', '3.9'), p)).toBeNull();
    expect(valueFor('gpa', p, { label: 'Graduate GPA' })).toEqual(['3.7']);
    expect(valueFor('gpa', p, { label: 'Doctorate GPA' })).toBeNull();
    expect(valueFor('gpa', p, { label: 'GPA' })).toBeNull();
  });
  it('checks numbered entries against the education qualifier', () => {
    const p = sampleProfile(), c = { ...capture('Graduate GPA', '3.6'), section: { kind: 'education' as const, index: 0 } };
    expect(proposeProfileUpdate(c, p)).toBeNull();
    expect(valueFor('gpa', p, { label: c.label, index: 0 })).toBeNull();
  });
  it('requires confirmation before replacement and rejects concurrent edits', () => {
    const p = sampleProfile(), c = capture('GPA', '3.5'), expected = proposeProfileUpdate(c, p)!;
    expect(() => applyProfileConfirmation(p, c, { value: expected.value, expected, replace: false })).toThrow('Confirm replacing');
    expect(applyProfileConfirmation(p, c, { value: expected.value, expected, replace: true }).education[0]!.gpa).toBe('3.5');
    p.education[0]!.school = 'Changed University';
    expect(() => applyProfileConfirmation(p, c, { value: expected.value, expected, replace: true })).toThrow('profile changed');
  });
  it('keeps contextual commute, negative, third-party and compound questions as memories', () => {
    for (const q of ['Can you commute to Cupertino?', 'Are you willing to relocate to Seattle?', 'Your spouse GPA', 'GPA if you have a graduate degree', 'Are you not authorized to work in the US?', 'Do you need sponsorship in Canada?', 'Do you need sponsorship in the future?']) expect(proposeProfileUpdate(capture(q, 'Yes'), sampleProfile())).toBeNull();
  });
  it('saves explicit US authorization and sponsorship booleans separately', () => {
    expect(proposeProfileUpdate(capture('Are you legally authorized to work in the United States?', 'Yes'), sampleProfile())).toMatchObject({ key: 'authorizedUS', value: 'yes' });
    expect(proposeProfileUpdate(capture('Do you need sponsorship now or in the future?', 'No'), sampleProfile())).toMatchObject({ key: 'needsSponsorship', value: 'no' });
  });
  it('leaves multi-select values as memories unless one explicit clearance maps to a scalar', () => {
    const c = { ...capture('Active Security Clearance(s)', ''), selectionMode: 'multiple' as const, values: ['Never held a clearance'] };
    expect(proposeProfileUpdate(c, sampleProfile())).toMatchObject({ key: 'clearance', value: 'None / never held' });
    expect(proposeProfileUpdate({ ...c, values: ['Secret', 'DOE Q'] }, sampleProfile())).toBeNull();
    expect(proposeProfileUpdate(capture('Active Security Clearance', 'No active clearance'), sampleProfile())).toBeNull();
  });
  it('explicitly relinks only the winning fixed Memory and rejects concurrent changes', () => {
    const p = sampleProfile(), c = capture('GPA', '3.5');
    const context = { platform: 'lever' as const, company: 'Fictional', url: 'https://example.test/apply' };
    const records: RememberedMapping[] = [
      { id: 1, schemaVersion: 3, updatedAt: 1, question: 'GPA', aliases: ['Grade point average'], scope: 'all', target: { kind: 'answer', value: '3.8' }, lastUsed: 4 },
      { id: 2, schemaVersion: 3, updatedAt: 2, question: 'GPA', aliases: [], scope: 'company:fictional', target: { kind: 'answer', value: '3.7' } },
    ];
    const expected = proposeConfirmedProfileUpdate(c, p, records, context)!;
    expect(expected.memoryLink).toMatchObject({ id: 2, key: 'gpa' });
    expect(applyProfileConfirmation(p, c, { value: '3.5', expected, replace: true }, records, context).education[0]!.gpa).toBe('3.5');
    records[1]!.target = { kind: 'answer', value: '3.6' };
    expect(() => applyProfileConfirmation(p, c, { value: '3.5', expected, replace: true }, records, context)).toThrow('matching Memory changed');
    expect(proposeConfirmedProfileUpdate(capture('Email', 'fixture@example.com'), p, records, context)?.memoryLink).toBeUndefined();
  });
  it('rejects untrusted sections and profile paths', () => {
    expect(() => parseCapture({ ...capture('GPA', '3.5'), section: { kind: 'education', index: -1 } })).toThrow();
    const p = sampleProfile(), c = capture('GPA', '3.5'), expected = proposeProfileUpdate(c, p)!;
    expect(() => applyProfileConfirmation(p, c, { value: '3.5', expected: { ...expected, key: '__proto__' } as any, replace: true })).toThrow();
  });
});
