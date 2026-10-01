import { describe, expect, it } from 'vitest';
import { classifyField } from '../lib/autofill/classify';
import { fillSelect } from '../lib/autofill/fill';
import { scanFields } from '../lib/autofill/scan';

function scan(html: string) {
  document.body.innerHTML = html;
  return scanFields(document.body);
}

describe('dropdowns', () => {
  it('picks the top real option when nothing matches', () => {
    const [f] = scan('<label for="l">Location</label><select id="l"><option value="">Select…</option><option value="a">San Jose, CA, United States</option><option value="b">Austin, TX</option></select>');
    expect(fillSelect(f!, ['Palo Alto, CA'], { topOption: true })).toBe('filled');
    expect((f!.el as HTMLSelectElement).value).toBe('a');
  });
  it('leaves it empty when top-option guessing is off', () => {
    const [f] = scan('<select id="l"><option value="">Select…</option><option value="a">Yes</option></select>');
    expect(fillSelect(f!, ['Palo Alto'], {})).toBe('nomatch');
  });
});

describe('survey multiple choice', () => {
  it('groups unnamed radios inside a fieldset', () => {
    const fields = scan(
      '<fieldset><legend>Gender</legend><label><input type="radio"> Man</label><label><input type="radio"> Woman</label><label><input type="radio"> Decline to self-identify</label></fieldset>',
    );
    expect(fields).toHaveLength(1);
    expect(fields[0]!.kind).toBe('radio');
    expect(fields[0]!.options).toHaveLength(3);
    expect(classifyField(fields[0]!)).toMatchObject({ key: 'gender' });
  });
  it('groups checkboxes that each have their own name', () => {
    const fields = scan(
      '<fieldset><legend>Race</legend><label><input type="checkbox" name="a"> Asian</label><label><input type="checkbox" name="b"> White</label></fieldset>',
    );
    expect(fields).toHaveLength(1);
    expect(fields[0]!.kind).toBe('checkboxGroup');
  });
});
