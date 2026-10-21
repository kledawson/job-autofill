import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADAPTERS } from '../lib/autofill/adapters';
import { classifyField } from '../lib/autofill/classify';
import { FillSession, type EngineDeps } from '../lib/autofill/engine';
import { timing } from '../lib/autofill/fill';
import { scanFields } from '../lib/autofill/scan';
import { sampleProfile } from './helpers';

const RESUME = { name: 'resume.pdf', type: 'application/pdf', base64: btoa('%PDF-1.4 test') };
const URL = 'https://ats.rippling.com/contoso/jobs/b1af21a2-0000-0000-0000-000000000000/apply?step=application';

// Shaped like Rippling's application step: a drop zone label that names its question by reference,
// a location search that keeps the chosen place as the box's text, and Yes/No rows drawn over hidden radios.
const FORM = `<form>
<div data-testid="field"><div><span id="resume-label">Résumé</span><span>*</span></div>
  <div><div data-testid="screen-reader-only" id="resume-count">Total 0 file selected</div>
  <label data-testid="resume" tabindex="-1" aria-labelledby="resume-count resume-label"><input accept=".doc,.docx,.pdf" data-testid="input-resume" type="File">
    <button type="button"><span>Drop or select (.doc / .docx / .pdf)</span></button></label></div></div>
<div data-testid="field"><div><span id="first-label">First name</span><span>*</span></div>
  <div><input id="first" aria-required="true" autocomplete="off" placeholder="First name" aria-labelledby="first-label"></div></div>
<div data-testid="field"><div><span id="location-label">Location</span><span>*</span></div>
  <div data-testid="location"><div class="css-1mlcsw"><input id="location" aria-required="true" autocomplete="off" aria-label="textbox" aria-labelledby="location-label" aria-autocomplete="list" aria-haspopup="listbox"></div></div></div>
<p>Check <strong>Yes</strong> or <strong>No</strong> to indicate your agreement to receive text message updates from Contoso regarding your job application. Reply STOP to opt out of future messaging.</p>
<div data-testid="field"><div role="radiogroup" id="sms">
  <div role="radio" aria-checked="false"><input aria-labelledby="sms-yes" type="radio" style="display:none" value="true" name="sms_opt_in"><div id="sms-yes"><p>Yes - I consent to receiving text messages</p></div></div>
  <div role="radio" aria-checked="false"><input aria-labelledby="sms-no" type="radio" style="display:none" value="false" name="sms_opt_in"><div id="sms-no"><p>No - I do not consent to receiving text messages</p></div></div>
</div></div>
</form>`;

/** Rippling's location search: typing lists places; choosing one writes its label into the box and closes the list. */
function wireLocation() {
  const input = document.getElementById('location') as HTMLInputElement;
  input.addEventListener('input', () => {
    document.getElementById('location-list')?.remove();
    if (!input.value) return;
    const list = document.createElement('ul');
    list.id = 'location-list';
    list.setAttribute('role', 'listbox');
    for (const place of ['San Francisco, CA, USA', 'South San Francisco, CA, USA']) {
      const option = document.createElement('li');
      option.setAttribute('role', 'option');
      option.innerHTML = `<p>${place}</p>`;
      option.addEventListener('click', () => {
        input.value = place;
        list.remove();
      });
      list.appendChild(option);
    }
    input.closest('[data-testid="location"]')!.appendChild(list);
  });
}

function deps(textConsent: boolean): EngineDeps {
  return {
    context: { profile: { ...sampleProfile(), textConsent }, resume: RESUME, coverLetter: null, transcript: null, hasGeminiKey: false },
    answer: vi.fn(async () => ({ ok: true as const, answer: '' })),
    jobDescription: vi.fn(async () => ''),
    mapFields: vi.fn(async (fields: unknown[]) => ({ ok: true as const, keys: fields.map(() => null) })),
  };
}

const radios = () => [...document.querySelectorAll<HTMLInputElement>('input[name="sms_opt_in"]')].map((r) => r.checked);

beforeEach(() => {
  Object.assign(timing, { menuOpen: 20, search: 60, typeahead: 30, afterUpload: 0, settle: 0, reveal: 50 });
  (window as any).happyDOM.setURL(URL);
  document.body.innerHTML = FORM;
  wireLocation();
});

describe('Rippling application step', () => {
  it('names the drop zone by its question and reads choices hidden under drawn radio rows', () => {
    const fields = scanFields(document.body);
    const resume = fields.find((f) => f.kind === 'file')!;
    expect(resume.label).toBe('Résumé');
    expect(classifyField(resume, ADAPTERS.other.keys)).toMatchObject({ kind: 'profile', key: 'resume' });
    const sms = fields.find((f) => f.kind === 'radio')!;
    expect(sms.options).toEqual(['Yes - I consent to receiving text messages', 'No - I do not consent to receiving text messages']);
    expect(classifyField(sms, ADAPTERS.other.keys)).toMatchObject({ kind: 'profile', key: 'textConsent' });
  });

  it('uploads the resume, answers text consent and verifies the location kept as the search box text', async () => {
    const summary = await new FillSession(document, ADAPTERS.other, deps(true)).run();
    expect((document.querySelector('[data-testid="input-resume"]') as HTMLInputElement).files?.length).toBe(1);
    expect((document.getElementById('location') as HTMLInputElement).value).toBe('San Francisco, CA, USA');
    expect(radios()).toEqual([true, false]);
    const status = Object.fromEntries((summary.fieldFeedback ?? []).map((f) => [f.label.slice(0, 20), f.status]));
    expect(status).toMatchObject({ 'Résumé': 'verified', Location: 'verified', 'First name': 'verified' });
    expect(summary.fieldFeedback?.find((f) => /text message/.test(f.label))?.status).toBe('verified');
    expect(summary.missingLabels).toEqual([]);
  });

  it('declines text messages when the profile says no', async () => {
    await new FillSession(document, ADAPTERS.other, deps(false)).run();
    expect(radios()).toEqual([false, true]);
  });
});
