import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applicantLocationParts, applicantLocationQueries, pickApplicantLocation, valueFor } from '../lib/autofill/values';
import { FillSession } from '../lib/autofill/engine';
import { ADAPTERS } from '../lib/autofill/adapters';
import { timing } from '../lib/autofill/fill';
import { sampleProfile } from './helpers';

const place = { city: 'San Jose', state: 'CA', country: 'United States' };
const correct = 'San Jose, California, United States';
const wrong = 'San José del Castillo, Jalisco, Mexico';
describe('geographic option matching', () => {
  it.each(['San Jose, California', 'San Jose, CA, United States', 'San Jose, California, California'])('does not duplicate qualifiers already saved in City: %s', city => {
    const profile = { ...sampleProfile(), ...place, city };
    expect(applicantLocationParts(profile)).toEqual({ ...place, valid: true });
    expect(applicantLocationQueries(profile)).toEqual([correct, 'San Jose, California', 'San Jose']);
    expect(valueFor('location', profile)?.[0]).toBe('San Jose, CA');
    expect(valueFor('city', profile)).toEqual(['San Jose']);
    expect(pickApplicantLocation([wrong, correct], profile)).toBe(1);
    expect(profile.city).toBe(city); // Do not silently migrate or rewrite saved applicant facts.
  });
  it('does not reinterpret conflicting City qualifiers or search state/country fragments', () => {
    const profile = { ...sampleProfile(), ...place, city: 'San Jose, Jalisco, Mexico' };
    expect(applicantLocationParts(profile).valid).toBe(false);
    expect(applicantLocationQueries(profile)).toEqual([]);
    expect(pickApplicantLocation([correct], profile)).toBe(-1);
    expect(valueFor('location', profile)).toBeNull();
    expect(applicantLocationQueries(place)).not.toEqual(expect.arrayContaining(['CA', 'California', 'United States', 'Jose CA']));
  });
  it('uses complete city, state and country rather than ranking a shared prefix', () => {
    expect(pickApplicantLocation([wrong, 'San José, San José, Costa Rica', correct], place)).toBe(2);
    expect(pickApplicantLocation([wrong], place)).toBe(-1);
    expect(pickApplicantLocation(['San Jose, California, Mexico'], place)).toBe(-1);
    expect(pickApplicantLocation(['San Jose, New Mexico, USA'], place)).toBe(-1);
  });
  it.each(['San José, CA, USA', 'San Jose, California, U.S.', 'San Jose, CA', 'San Jose California United States'])('accepts an unambiguous geographic equivalent: %s', label => {
    expect(pickApplicantLocation([wrong, label], place)).toBe(1);
  });
  it('leaves conflicting, duplicate and insufficient places for review', () => {
    expect(pickApplicantLocation([correct, correct], place)).toBe(-1);
    expect(pickApplicantLocation(['San Jose, United States'], place)).toBe(-1);
    expect(pickApplicantLocation(['San Jose, California, United States', 'San Jose, New Mexico, United States'], { ...place, state: '' })).toBe(-1);
    expect(pickApplicantLocation(['San Jose del Castillo California United States'], place)).toBe(-1);
    expect(pickApplicantLocation(['San Jose, Jalisco, CA'], { ...place, country: '' })).toBe(-1);
  });
  it('keeps broad region questions separate from applicant city questions', () => {
    expect(pickApplicantLocation(['California', 'Texas'], place, true)).toBe(0);
    expect(pickApplicantLocation(['North America', 'Europe'], place, true)).toBe(0);
    expect(pickApplicantLocation(['North America'], place)).toBe(-1);
  });
});

const previous = { ...timing };
beforeEach(() => { Object.assign(timing, { menuOpen: 5, search: 10, typeahead: 20, settle: 0, afterUpload: 0 }); });
afterEach(() => { Object.assign(timing, previous); document.body.innerHTML = ''; });

function form(labels: string[], async = false, committed?: string, profile = { ...sampleProfile(), ...place }) {
  document.body.innerHTML = '<form id="application-form"><label for="location">Location (City)*</label><div class="select__container"><div class="select__control"><input id="location" role="combobox" aria-expanded="false" required></div></div></form>';
  const input = document.querySelector('input')!;
  const control = input.parentElement!;
  const menu = () => {
    document.getElementById('locations')?.remove();
    const list = document.createElement('div'); list.id = 'locations'; list.setAttribute('role', 'listbox');
    labels.forEach(label => {
      const option = document.createElement('div'); option.setAttribute('role', 'option'); option.textContent = label;
      option.addEventListener('click', () => {
        list.remove(); input.value = ''; input.setAttribute('aria-expanded', 'false');
        const selected = document.createElement('div'); selected.className = 'select__single-value'; selected.textContent = committed ?? label; control.appendChild(selected);
      }); list.appendChild(option);
    });
    input.setAttribute('aria-controls', list.id); input.setAttribute('aria-expanded', 'true'); control.appendChild(list);
  };
  if (async) input.addEventListener('input', () => { if (input.value) menu(); });
  else input.addEventListener('mousedown', menu);
  return new FillSession(document, ADAPTERS.greenhouse, { context: { profile, resume: null, coverLetter: null, transcript: null, hasGeminiKey: false }, answer: async () => ({ ok: false, error: 'unused' }), jobDescription: async () => '' });
}
it.each([false, true])('selects the correct place after a misleading first option, including async search=%s', async async => {
  const session = form([wrong, correct], async);
  try {
    const result = await session.run();
    expect(document.querySelector('.select__single-value')?.textContent).toBe(correct);
    expect(result.missingLabels).toEqual([]);
    expect(document.querySelector('[data-jaf-state="filled"]')).not.toBeNull();
  } finally { session.disconnect(); }
});
it('normalizes composite City in the actual fill path before choosing a location', async () => {
  const session = form([wrong, correct], true, undefined, { ...sampleProfile(), ...place, city: 'San Jose, California, United States' });
  try {
    expect((await session.run()).missingLabels).toEqual([]);
    expect(document.querySelector('.select__single-value')?.textContent).toBe(correct);
  } finally { session.disconnect(); }
});

it('waits for the matching delayed response instead of cycling through unrelated old results', async () => {
  timing.search = 150;
  const session = form([wrong], true);
  const input = document.querySelector('input')!;
  const queries: string[] = [];
  let timer: ReturnType<typeof setTimeout>;
  input.addEventListener('input', () => {
    if (!input.value) return;
    clearTimeout(timer); queries.push(input.value);
    const query = input.value;
    timer = setTimeout(() => {
      if (input.value !== query || !input.isConnected) return;
      const option = document.createElement('div'); option.setAttribute('role', 'option'); option.textContent = correct;
      option.addEventListener('click', () => {
        document.getElementById('locations')?.remove(); input.value = ''; input.setAttribute('aria-expanded', 'false');
        const value = document.createElement('div'); value.className = 'select__single-value'; value.textContent = correct; input.parentElement!.appendChild(value);
      }); document.getElementById('locations')?.appendChild(option);
    }, 50);
  });
  try {
    expect((await session.run()).missingLabels).toEqual([]);
    expect(document.querySelector('.select__single-value')?.textContent).toBe(correct);
    expect(queries.at(-1)).toBe(correct);
  } finally { clearTimeout(timer!); session.disconnect(); }
});
it('does not select or mark green an unrelated top search suggestion', async () => {
  const session = form([wrong], true);
  try {
    const result = await session.run();
    expect(document.querySelector('.select__single-value')).toBeNull();
    expect(document.querySelector('input')!.value).toBe('');
    expect(result.missingLabels).toContain('Location (City)');
    expect(document.querySelector('[data-jaf-state="filled"]')).toBeNull();
  } finally { session.disconnect(); }
});
it('does not mark a widget green if it commits a different option from the one clicked', async () => {
  const session = form([correct], false, wrong);
  try {
    const result = await session.run();
    expect(result.missingLabels).toContain('Location (City)');
    expect(document.querySelector('[data-jaf-state="filled"]')).toBeNull();
    document.querySelector('.select__single-value')!.textContent = correct;
    expect(session.verify().missingLabels).not.toContain('Location (City)');
    expect(document.querySelector('[data-jaf-state="filled"]')).toBeNull(); // The correction belongs to the user.
  } finally { session.disconnect(); }
});
