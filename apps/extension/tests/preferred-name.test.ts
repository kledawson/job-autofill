import { describe, expect, it } from 'vitest';
import { valueFor } from '../lib/autofill/values';
import { emptyProfile } from '../lib/types';

const profile = { ...emptyProfile(), firstName: 'Alexander', lastName: 'Yeh', preferredName: 'Alex' };

describe('first name and preferred name', () => {
  it('puts the preferred name in the first-name box when the form has no preferred-name box', () => {
    expect(valueFor('firstName', profile)).toEqual(['Alex']);
  });

  it('keeps the legal first name when the form also asks for a preferred name', () => {
    expect(valueFor('firstName', profile, { hasPreferredNameField: true })).toEqual(['Alexander']);
    expect(valueFor('preferredName', profile, { hasPreferredNameField: true })).toEqual(['Alex']);
  });

  it('uses the first name when no preferred name is saved', () => {
    const plain = { ...profile, preferredName: '' };
    expect(valueFor('firstName', plain)).toEqual(['Alexander']);
  });
});
