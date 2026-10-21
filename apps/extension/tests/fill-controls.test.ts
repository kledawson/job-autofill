import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FillSession, type EngineDeps } from '../lib/autofill/engine';
import { ADAPTERS } from '../lib/autofill/adapters';
import { timing, uploadedAlready } from '../lib/autofill/fill';
import { classifyField } from '../lib/autofill/classify';
import { scanFields } from '../lib/autofill/scan';
import { startDateValues, valueFor } from '../lib/autofill/values';
import { sampleProfile } from './helpers';

const priorTiming = { ...timing };
const resume = { name: 'Fictional_Resume.pdf', type: 'application/pdf', base64: btoa('%PDF-1.4 fictional') };
const sessions: FillSession[] = [];
beforeEach(() => { Object.assign(timing, { settle: 0, reveal: 0, menuOpen: 20, afterUpload: 0 }); });
afterEach(() => { sessions.forEach(s => s.disconnect()); sessions.length = 0; document.body.innerHTML = ''; Object.assign(timing, priorTiming); vi.restoreAllMocks(); });
function session(overrides: Partial<EngineDeps> = {}) {
  const s = new FillSession(document, ADAPTERS.other, {
    context: { profile: sampleProfile(), resume, coverLetter: null, transcript: null, hasGeminiKey: false },
    answer: async () => ({ ok: false, error: 'Not enabled' }), jobDescription: async () => '', ...overrides,
  });
  sessions.push(s); return s;
}

it('uploads once when a widget empties and replaces its input with a new ID/path after every upload', async () => {
  document.body.innerHTML = '<form><div id="rows"></div><div id="upload"></div><label>Cover letter<input type="file"></label></form>';
  let uploads = 0;
  const widget = () => {
    document.querySelector('#upload')!.innerHTML = `<label>Resume<input type="file" id="resume-${uploads}" data-field-path="resume-${uploads}"></label>`;
    document.querySelector('#upload input')!.addEventListener('change', () => {
      if (++uploads > 4) throw new Error('Runaway upload');
      document.querySelector('#rows')!.insertAdjacentHTML('beforeend', '<table><tr><td>Fictional_Resume.pdf</td><td><button type="button">Remove</button></td></tr></table>');
      widget();
    });
  };
  widget();
  const first = session(); await first.run(); expect(uploads).toBe(1);
  // A manual repeat must also avoid replaying an upload when the site leaves the file input empty.
  first.disconnect(); await session().run(); expect(uploads).toBe(1);
  expect(document.querySelectorAll('#rows tr')).toHaveLength(1);
});

it('does not dispatch a second upload event to an input replaced by its input handler', async () => {
  document.body.innerHTML = '<form><label>Resume<input type="file"></label></form>';
  const input = document.querySelector('input')!;
  const change = vi.fn(); input.addEventListener('change', change);
  input.addEventListener('input', () => input.replaceWith(input.cloneNode()));
  await session().run(); expect(change).not.toHaveBeenCalled();
});

it('recognizes an existing attachment table above a nested Upload menu without confusing Cover Letter', () => {
  document.body.innerHTML = '<form><h3>Resume</h3><table><tr><td>Fictional_Resume.pdf</td></tr></table><div><div><div><input id="resume" type="file"></div></div></div><h3>Cover Letter</h3><div><input id="cover" type="file"></div></form>';
  expect(uploadedAlready(document.querySelector('#resume')!)).toBe(true);
  expect(uploadedAlready(document.querySelector('#cover')!)).toBe(false);
});

it('stops delayed dropdown writers before they can select an answer, then allows read-only review', async () => {
  timing.menuOpen = 100;
  document.body.innerHTML = '<form><label>Degree<input role="combobox" aria-expanded="true" aria-controls="choices"></label><div id="choices" role="listbox"></div><label>First name<input id="first"></label></form>';
  const s = session(), pending = s.run();
  await vi.waitFor(() => expect(s.summary().fieldFeedback?.some(f => f.label === 'Degree')).toBe(true));
  expect(s.processing).toBe(true);
  s.disconnect();
  const option = document.createElement('div'); option.setAttribute('role', 'option'); option.textContent = "Bachelor's Degree";
  const selected = vi.fn(); option.addEventListener('mousedown', selected); document.querySelector('#choices')!.append(option);
  await pending; expect(selected).not.toHaveBeenCalled(); expect(document.querySelector<HTMLInputElement>('#first')!.value).toBe('');
  const review = s.enterReview(); expect(review.fieldFeedback?.length).toBeGreaterThan(0);
});

it('lets Show field locate a known field even while the writer is processing another widget', async () => {
  timing.menuOpen = 100;
  document.body.innerHTML = '<form><label>Degree<input role="combobox" aria-expanded="true" aria-controls="choices"></label><div id="choices" role="listbox"></div><label>Fictional reference<input id="reference" required></label></form>';
  const s = session(), pending = s.run();
  await vi.waitFor(() => expect(s.summary().fieldFeedback?.some(f => f.label === 'Fictional reference')).toBe(true));
  expect(s.processing).toBe(true);
  const row = s.summary().fieldFeedback!.find(f => f.label === 'Fictional reference')!;
  const input = document.querySelector<HTMLInputElement>('#reference')!; input.scrollIntoView = vi.fn();
  s.showField(row.token, row.label);
  expect(input.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'center', inline: 'nearest' });
  expect(document.activeElement).toBe(input); expect(input.value).toBe('');
  s.disconnect(); await pending;
});

it('drains a later conditional-field writer before resetting the cancellation guard for review', async () => {
  document.body.innerHTML = '<form><label>First name<input></label></form>';
  const s = session(); await s.run(); timing.menuOpen = 100;
  document.querySelector('form')!.insertAdjacentHTML('beforeend', '<label>Degree<input role="combobox" aria-expanded="true" aria-controls="choices"></label><div id="choices" role="listbox"></div>');
  const pending = s.processNew(true);
  await vi.waitFor(() => expect(s.summary().fieldFeedback?.some(f => f.label === 'Degree')).toBe(true));
  expect(s.processing).toBe(true); s.disconnect();
  expect(() => s.enterReview()).toThrow('widget writer');
  await s.whenIdle(); expect(s.processing).toBe(false); s.enterReview(); await pending;
});

it('keeps employer contact and address fields blank despite personal autocomplete and adapter hints', async () => {
  document.body.innerHTML = `<form><section><h2>Personal information</h2><label>Phone<input id="personal" autocomplete="tel"></label><label>Address<input id="home" autocomplete="street-address"></label></section>
    <fieldset><legend>Work history</legend>${['Phone', 'Address', 'City', 'State', 'ZIP', 'Country', 'Email'].map((label, i) => `<label>${label}<input id="employer-${i}" ${i === 0 ? 'autocomplete="tel"' : ''}></label>`).join('')}</fieldset>
    <label>Company Phone<input id="company" autocomplete="tel"></label></form>`;
  const fields = scanFields(document);
  for (const f of fields.filter(f => f.id.startsWith('employer-') || f.id === 'company')) expect(classifyField(f, { [f.id]: 'phone' })).toMatchObject({ kind: 'unknown', askAi: false });
  const mapFields = vi.fn(async () => ({ ok: true as const, keys: ['phone'] }));
  const profile = { ...sampleProfile(), address: '100 Fictional Lane' };
  const s = session({ context: { profile, resume: null, coverLetter: null, transcript: null, hasGeminiKey: true }, mapFields });
  await s.run();
  expect(document.querySelector<HTMLInputElement>('#personal')!.value).toBe(sampleProfile().phone);
  expect(document.querySelector<HTMLInputElement>('#home')!.value).toBe(profile.address);
  for (const input of document.querySelectorAll<HTMLInputElement>('[id^="employer-"], #company')) expect(input.value).toBe('');
  expect(mapFields).not.toHaveBeenCalled();
});

it('resolves relative availability each fill using calendar days, preserving fixed and legacy dates', () => {
  expect(startDateValues('today', new Date(2026, 9, 20, 23, 59))![2]).toBe('2026-10-20');
  expect(startDateValues('tomorrow', new Date(2026, 11, 31, 23, 59))![2]).toBe('2027-01-01');
  expect(startDateValues('tomorrow', new Date(2028, 1, 28))![2]).toBe('2028-02-29');
  expect(startDateValues('today', new Date(2026, 10, 1, 1))![2]).toBe('2026-11-01');
  expect(startDateValues('', new Date(2026, 9, 20))![2]).toBe('2026-11-03');
  const p = sampleProfile(); p.preferences.startDate = 'tomorrow';
  expect(valueFor('startDate', p, { now: new Date(2026, 9, 20) })![2]).toBe('2026-10-21');
  expect(valueFor('startDate', p, { now: new Date(2026, 9, 21) })![2]).toBe('2026-10-22');
  expect(startDateValues('2027-02-01')![2]).toBe('2027-02-01');
  expect(startDateValues('June 2027')).toEqual(['June 2027']);
});
