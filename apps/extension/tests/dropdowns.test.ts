import { describe, expect, it } from 'vitest';
import { classifyField } from '../lib/autofill/classify';
import { fillSelect } from '../lib/autofill/fill';
import { scanFields } from '../lib/autofill/scan';
import { bestOption } from '../lib/autofill/match';
import { valueFor } from '../lib/autofill/values';
import { sampleProfile } from './helpers';

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

describe('work authorization and clearance answers', () => {
  const key = (label: string) => (classifyField({ label, kind: 'select', id: '', name: '', path: '', options: [], autocomplete: '' } as any) as any).key;
  const pick = (k: any, opts: string[], extra = {}, p = sampleProfile()) => opts[bestOption(valueFor(k, p, { options: opts, ...extra })!, opts)];

  it('picks "any employer" for a citizen who needs no sponsorship', () => {
    const opts = [
      'I am authorized to work in the United States for any employer',
      'I am authorized to work in the United States for my present employer only',
      'I require sponsorship to work in the United States',
      'I am not authorized to work in the United States',
      'My status to work in the United States in unknown',
    ];
    expect(key('Are you legally authorized to work in the United States?')).toBe('authorized');
    expect(pick('authorized', opts)).toBe(opts[0]);
    expect(pick('authorized', ['Yes', 'No'])).toBe('Yes');
  });
  it('answers US citizen, US person and clearance eligibility questions', () => {
    const q = 'This job requires a US Q security clearance—a minimum requirement of which is to be a US Citizen. Can you confirm that you are currently a US Citizen?';
    expect(key(q)).toBe('usCitizen');
    expect(key('This job requires access to export-controlled information. Please confirm whether you are a (1) US Citizen, (2) Lawful Permanent Resident, or (3) Qualifying Asylee.')).toBe('usPerson');
    for (const l of ['Clearance Eligibility', 'Are you eligible to obtain a security clearance?']) expect(key(l)).toBe('clearanceEligible');
    expect(pick('usCitizen', ['Yes', 'No'])).toBe('Yes');
    expect(pick('usPerson', ['Yes', 'No'])).toBe('Yes');
    expect(pick('usPerson', ['US Citizen', 'Lawful Permanent Resident', 'Qualifying Asylee', 'None of the above'])).toBe('US Citizen');
    expect(pick('clearanceEligible', ['Yes', 'No'])).toBe('Yes');
    const gc = sampleProfile();
    gc.workAuth.status = 'Permanent Resident (Green Card)';
    expect(pick('usCitizen', ['Yes', 'No'], {}, gc)).toBe('No');
    expect(pick('usPerson', ['Yes', 'No'], {}, gc)).toBe('Yes');
    expect(pick('clearanceEligible', ['Yes', 'No'], {}, gc)).toBe('No');
    gc.workAuth.status = '';
    expect(valueFor('usCitizen', gc)).toBeNull();
  });
  it('maps the saved clearance onto the form options', () => {
    const opts = ['Top Secret SCI with Polygraph', 'Top Secret SCI/SAP', 'Top Secret', 'DOE Level Q', 'Secret', 'Expired Clearance', 'Never held a clearance', 'Do not wish to disclose'];
    expect(key('Active Security Clearance(s)')).toBe('clearance');
    const at = (level: string) => {
      const p = sampleProfile();
      p.workAuth.clearance = level;
      return pick('clearance', opts, {}, p);
    };
    expect(at('None / never held')).toBe('Never held a clearance');
    expect(at('Secret')).toBe('Secret');
    expect(at('Top Secret')).toBe('Top Secret');
    expect(at('Top Secret SCI')).toBe('Top Secret');
    expect(at('Top Secret SCI with Polygraph')).toBe('Top Secret SCI with Polygraph');
    expect(at('DOE Q')).toBe('DOE Level Q');
    expect(at('Expired')).toBe('Expired Clearance');
    expect(at('Prefer not to disclose')).toBe('Do not wish to disclose');
    const p = sampleProfile();
    expect(valueFor('clearance', p)).toBeNull();
    p.workAuth.clearance = 'Secret';
    expect(valueFor('clearance', p, { yesNo: true, label: 'Do you hold an active Top Secret clearance?' })).toEqual(['No']);
    expect(valueFor('clearance', p, { yesNo: true, label: 'Do you have an active security clearance?' })).toEqual(['Yes']);
  });
});
