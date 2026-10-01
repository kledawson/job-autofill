import { describe, expect, it } from 'vitest';
import { classifyField } from '../lib/autofill/classify';
import { bestOption } from '../lib/autofill/match';
import { scanFields } from '../lib/autofill/scan';
import { usCitizenshipAnswer, valueFor } from '../lib/autofill/values';
import { emptyProfile } from '../lib/types';
import { FillSession } from '../lib/autofill/engine';
import { ADAPTERS } from '../lib/autofill/adapters';

function form(questions: [string, string[]][]) {
  const doc = document.implementation.createHTMLDocument();
  questions.forEach(([label, options], i) => {
    const wrapper = doc.createElement('div');
    const title = doc.createElement('label');
    title.htmlFor = `field${i}`;
    title.textContent = label;
    const select = doc.createElement('select');
    select.id = title.htmlFor;
    select.required = true;
    ['', ...options].forEach(text => {
      const option = doc.createElement('option');
      option.text = text || 'Select…';
      option.value = text;
      select.append(option);
    });
    wrapper.append(title, select);
    doc.body.append(wrapper);
  });
  return doc;
}

describe('saved eligibility answers', () => {
  it('reuses an explicit citizen status but never infers citizenship from work authorization, residence, or visa', () => {
    const p = emptyProfile();
    p.workAuth.authorizedUS = 'yes';
    p.workAuth.status = 'Permanent Resident (Green Card)';
    expect(usCitizenshipAnswer(p)).toBe('');
    p.workAuth.status = 'US Citizen';
    expect(usCitizenshipAnswer(p)).toBe('yes');
    p.workAuth.status = '';
    p.workAuth.exportStatus = 'US Citizen';
    expect(usCitizenshipAnswer(p)).toBe('yes');
    p.workAuth.usCitizen = 'no';
    expect(usCitizenshipAnswer(p)).toBe('no');
  });
  it('never confuses protected and non-protected veteran answers', () => {
    expect(bestOption(['I am not a protected veteran'], ['I identify as a protected veteran'])).toBe(-1);
    expect(bestOption(['I identify as a protected veteran'], ['I am not a protected veteran'])).toBe(-1);
  });
  it('fills the requested saved self-identification choices only when enabled, preserving user edits', async () => {
    const doc = form([
      ['Gender', ['Female', 'Male']], ['Are you Hispanic/Latino?', ['Yes', 'No']],
      ['Veteran Status', ['Protected veteran', 'I am not a protected veteran']],
      ['Race', ['Asian', 'White']], ['Disability Status', ['Yes', 'No']],
    ]);
    const p = emptyProfile();
    Object.assign(p.eeo, { autofillSaved: true, gender: 'Male', hispanic: 'No', veteran: 'I am not a protected veteran', race: 'Asian' });
    const deps = { context: { profile: p, resume: null, coverLetter: null, hasGeminiKey: false },
      answer: async () => ({ ok: false as const, error: 'Disabled' }), jobDescription: async () => '' };
    const summary = await new FillSession(doc, ADAPTERS.generic, deps).run();
    const selects = Array.from(doc.querySelectorAll('select'));
    expect(selects.map(s => s.value)).toEqual(['Male', 'No', 'I am not a protected veteran', 'Asian', '']);
    expect(summary.missingLabels).toEqual(['Disability Status']);
    selects[0]!.value = 'Female';
    selects[3]!.value = 'White';
    await new FillSession(doc, ADAPTERS.generic, deps).run();
    expect(selects[0]!.value).toBe('Female');
    expect(selects[3]!.value).toBe('White');
    p.eeo.gender = '';
    expect(valueFor('gender', p)).toBeNull();
  });
  it('recognizes the reported race wording only with saved-answer filling enabled and skips a blank answer', () => {
    const field = scanFields(form([['Please identify your race', ['Asian', 'White']]]))[0]!;
    expect(classifyField(field)).toEqual({ kind: 'manual' });
    expect(classifyField(field, {}, true)).toEqual({ kind: 'profile', key: 'race', source: 'rule' });
    const p = emptyProfile();
    p.eeo.race = '';
    expect(valueFor('race', p)).toBeNull();
  });
  it('recognizes aliases without confusing export control, clearance, and citizenship', () => {
    const labels = ['Are you a US Citizen?', 'U.S. citizenship', 'Country of citizenship',
      'Clearance Eligibility', 'Active Security Clearance(s)',
      'This job requires a US Q security clearance. Can you confirm that you are currently a US Citizen?',
      'Export-controlled information: are you a US Citizen, Lawful Permanent Resident, or Qualifying Asylee?',
      'Citizenship'];
    const fields = scanFields(form(labels.map(l => [l, ['Yes', 'No']])));
    expect(fields.map(f => { const c = classifyField(f); return c.kind === 'profile' ? c.key : c.kind; }))
      .toEqual(['usCitizen', 'usCitizen', 'citizenshipCountry', 'clearanceEligible', 'activeClearance', 'usCitizen', 'exportStatus', 'unknown']);
  });
  it('requires explicit scope and never picks a contradictory category', () => {
    const p = emptyProfile();
    p.workAuth.authorizedUS = 'yes';
    const options = ['I am not authorized to work in the United States', 'I am authorized to work in the United States for any employer'];
    expect(bestOption(valueFor('authorized', p)!, options)).toBe(-1);
    p.workAuth.authorizationScope = 'any-employer';
    expect(bestOption(valueFor('authorized', p)!, options)).toBe(1);
    p.workAuth.authorizedUS = 'no';
    expect(bestOption(valueFor('authorized', p)!, options)).toBe(0);
    expect(bestOption(['US Citizen'], ['Not a US Citizen'])).toBe(-1);
    expect(bestOption(['Never held a clearance'], ['No active clearance', 'Secret'])).toBe(-1);
    expect(bestOption(['Secret'], ['Top Secret'])).toBe(-1);
  });
  it('fills explicit saved facts while leaving EEO and transcript manual', async () => {
    const doc = form([
      ['Active Security Clearance(s)', ['Never held a clearance', 'Secret']],
      ['Are you legally authorized to work in the United States?', ['I am not authorized to work in the United States', 'I am authorized to work in the United States for any employer']],
      ['Clearance Eligibility', ['Yes', 'No']],
      ['Are you a US Citizen?', ['No, I am not a US Citizen', 'Yes, I am currently a US Citizen']],
      ['Export-controlled information: US person status', ['US Citizen', 'Lawful Permanent Resident', 'Qualifying Asylee']],
      ['Gender', ['Male', 'Female']],
    ]);
    const p = emptyProfile();
    Object.assign(p.workAuth, { authorizedUS: 'yes', authorizationScope: 'any-employer', activeClearance: 'Never held a clearance', clearanceEligible: 'no', usCitizen: 'yes', exportStatus: 'US Citizen' });
    p.eeo.gender = 'Male';
    const summary = await new FillSession(doc, ADAPTERS.generic, {
      context: { profile: p, resume: null, coverLetter: null, hasGeminiKey: false },
      answer: async () => ({ ok: false, error: 'Disabled' }), jobDescription: async () => '',
    }).run();
    expect(Array.from(doc.querySelectorAll('select')).map(s => s.value)).toEqual([
      'Never held a clearance', 'I am authorized to work in the United States for any employer', 'No',
      'Yes, I am currently a US Citizen', 'US Citizen', '',
    ]);
    expect(summary.filledCount).toBe(5);
    expect(summary.missingLabels).toEqual(['Gender']);
  });
});
