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

describe('single full-name box', () => {
  it('uses the preferred name with the last name', () => {
    expect(valueFor('fullName', profile)).toEqual(['Alex Yeh']);
  });

  it('keeps the legal first name when the form also asks for a preferred name', () => {
    expect(valueFor('fullName', profile, { hasPreferredNameField: true })).toEqual(['Alexander Yeh']);
  });

  it('uses the first name when no preferred name is saved', () => {
    expect(valueFor('fullName', { ...profile, preferredName: '' })).toEqual(['Alexander Yeh']);
  });
});

describe('"I have a preferred name" checkbox', () => {
  it('is ticked only when the preferred name differs from the legal first name', () => {
    expect(valueFor('hasPreferredName', profile)).toEqual(['Yes']);
    expect(valueFor('hasPreferredName', { ...profile, preferredName: '' })).toBeNull();
    expect(valueFor('hasPreferredName', { ...profile, preferredName: 'alexander' })).toBeNull();
  });
});
