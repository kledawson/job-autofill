import { describe, expect, it } from 'vitest';
import { bestOption, characterLimitFor, similarity } from '../lib/autofill/match';
import { DECLINE_VARIANTS } from '../lib/autofill/values';

describe('option matching', () => {
  it('never confuses Male and Female', () => {
    expect(bestOption(['Male'], ['Select...', 'Female', 'Male'])).toBe(2);
    expect(bestOption(['Female'], ['Male', 'Female', 'Decline to self-identify'])).toBe(1);
  });

  it('maps any decline wording to the form’s decline option', () => {
    const options = ['Yes', 'No', "I don't wish to answer"];
    expect(bestOption(DECLINE_VARIANTS, options)).toBe(2);
    expect(bestOption(DECLINE_VARIANTS, ['Asian', 'White', 'Decline To Self Identify'])).toBe(2);
  });

  it('respects yes/no polarity in long options', () => {
    const options = [
      'Yes, I have a disability (or previously had a disability)',
      'No, I do not have a disability and have not had one in the past',
      'I do not want to answer',
    ];
    expect(bestOption(['No, I do not have a disability'], options)).toBe(1);
    expect(bestOption(['Yes'], ['No', 'Yes'])).toBe(1);
    expect(similarity('Yes', 'No, I will not require sponsorship')).toBe(0);
  });

  it('matches degree variants', () => {
    const options = ["Associate's Degree", "Bachelor's Degree", "Master's Degree", 'Doctor of Philosophy (Ph.D.)'];
    expect(bestOption(['Bachelor of Science', "Bachelor's Degree"], options)).toBe(1);
  });

  it('matches months by name or number', () => {
    expect(bestOption(['May', 'May', '05', '5'], ['01', '02', '03', '04', '05'])).toBe(4);
  });

  it('returns -1 rather than guessing', () => {
    expect(bestOption(['Stanford University'], ['Aalborg University', 'Aalto University'])).toBe(-1);
  });

  it('reads character and word limits from labels', () => {
    expect(characterLimitFor('Why us? (max 600 characters)')).toBe(600);
    expect(characterLimitFor('In 150 words or fewer, describe…')).toBe(900);
    expect(characterLimitFor('Tell us about yourself', 400)).toBe(400);
    expect(characterLimitFor('Tell us about yourself')).toBe(1500);
  });
});
