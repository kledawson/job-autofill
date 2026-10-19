import { describe, expect, it } from 'vitest';
import { valueFor } from '../lib/autofill/values';
import { sampleProfile } from './helpers';

describe('fill only if required', () => {
  const base = { ...sampleProfile(), address: '1 Main St' };
  const only = { address: true, gpa: true, schoolDates: true };

  it('always fills saved items when the box is unchecked', () => {
    expect(valueFor('address', base)).toEqual(['1 Main St']);
    expect(valueFor('gpa', base)).toEqual(['3.8']);
    expect(valueFor('eduStartYear', base)).not.toBeNull();
    expect(valueFor('gradDate', base)).not.toBeNull();
  });

  it('skips optional fields when the box is checked', () => {
    const p = { ...base, fillOnlyIfRequired: only };
    for (const key of ['address', 'gpa', 'eduStartMonth', 'eduStartYear', 'eduEndMonth', 'eduEndYear', 'gradDate'] as const) {
      expect(valueFor(key, p)).toBeNull();
      expect(valueFor(key, p, { required: false })).toBeNull();
      expect(valueFor(key, p, { required: true })).not.toBeNull();
    }
  });

  it('gates each item independently', () => {
    const p = { ...base, fillOnlyIfRequired: { address: true, gpa: false, schoolDates: false } };
    expect(valueFor('address', p)).toBeNull();
    expect(valueFor('gpa', p)).toEqual(['3.8']);
    expect(valueFor('eduEndYear', p)).not.toBeNull();
  });
});
