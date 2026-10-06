import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADAPTERS } from '../lib/autofill/adapters';
import { classifyField } from '../lib/autofill/classify';
import { FillSession, type EngineDeps } from '../lib/autofill/engine';
import { timing } from '../lib/autofill/fill';
import { scanFields } from '../lib/autofill/scan';
import type { AnswerRequest } from '../lib/messages';
import { SavedAnswerIndex, selectRememberedMappings, type RememberedMapping } from '../lib/remembered-mappings';
import { questionMeaning } from '../lib/answer-semantics';
import { loadFixture, sampleProfile } from './helpers';

const RESUME = { name: 'resume.pdf', type: 'application/pdf', base64: btoa('%PDF-1.4 test') };

function deps(overrides: Partial<EngineDeps> = {}) {
  const answers: AnswerRequest[] = [];
  const d: EngineDeps = {
    context: { profile: sampleProfile(), resume: RESUME, coverLetter: null, transcript: null, hasGeminiKey: true },
    answer: vi.fn(async (req: AnswerRequest) => {
      answers.push(req);
      return { ok: true as const, answer: `Answer to: ${req.question.slice(0, 20)}` };
    }),
    jobDescription: vi.fn(async () => 'Remote description'),
    ...overrides,
  };
  return { d, answers };
}

function classified(doc: Document, platform: 'greenhouse' | 'lever' | 'ashby') {
  const adapter = ADAPTERS[platform];
  return scanFields(adapter.formRoot(doc)).map((f) => {
    const c = classifyField(f, adapter.keys);
    return { label: f.label, kind: f.kind, required: f.required, cls: c.kind === 'profile' ? c.key : c.kind };
  });
}

let submits = 0;
const countSubmit = (e: Event) => {
  submits++;
  e.preventDefault();
};

beforeEach(() => {
  Object.assign(timing, { menuOpen: 20, search: 30, typeahead: 30, afterUpload: 0, settle: 0, reveal: 400 });
  submits = 0;
  window.addEventListener('submit', countSubmit);
});
afterEach(() => window.removeEventListener('submit', countSubmit));

describe('capture and semantic reuse', () => {
  const answer: RememberedMapping = { id: 44, schemaVersion: 2, updatedAt: 1, question: 'Degree', aliases: [], scope: 'all', target: { kind: 'answer', value: 'BS' }, meaning: questionMeaning('Degree')! };
  function setup(html: string, records: RememberedMapping[] = []) {
    document.body.innerHTML = `<form id="application-form">${html}</form>`;
    const { d } = deps({ matchSavedAnswers: async fields => {
      const index = new SavedAnswerIndex(records, { platform: 'greenhouse', company: 'Contoso', url: 'https://example.com/application' });
      return fields.map(f => index.match(f));
    } });
    d.context.hasGeminiKey = false;
    return new FillSession(document, ADAPTERS.greenhouse, d);
  }
  const choice = '<label for="custom">Education selection*</label><select id="custom" required><option value="">Select…</option><option>BS</option><option>BA</option></select>';
  it('leaves redrawn saved-answer fields empty during watching and keeps them teachable', async () => {
    const mapping = { ...answer, question: 'Education selection', meaning: undefined };
    const session = setup(choice, [mapping]);
    await session.run();
    const oldField = document.querySelector('select') as HTMLSelectElement;
    expect(oldField.value).toBe('BS');
    const redrawn = oldField.cloneNode(true) as HTMLSelectElement;
    redrawn.value = '';
    oldField.replaceWith(redrawn);
    expect(await session.processNew(true)).toBe(0);
    expect(redrawn.value).toBe('');
    const review = session.verify().reviewFields!.find(f => f.label === 'Education selection')!;
    expect(review.token).toEqual(expect.any(String));
    redrawn.value = 'BA';
    expect(session.captureAnswer(review.token, review.label).value).toBe('BA');
    // A new explicit fill still loads saved answers on a blank form.
    await setup(choice, [mapping]).run();
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('BS');
  });
  it('retains manually answered questions and captures only the selected answer', async () => {
    const session = setup(choice + '<label for="other">Unrelated question*</label><input id="other" required>');
    const result = await session.run();
    const review = result.reviewFields![0]!;
    (document.querySelector('select') as HTMLSelectElement).value = 'BS';
    expect(session.verify().reviewFields!.find(f => f.token === review.token)?.answered).toBe(true);
    const capture = session.captureAnswer(review.token, review.label);
    expect(capture.value).toBe('BS');
    expect(capture.options).toEqual(['BS', 'BA']);
    expect(session.verify().reviewFields).not.toEqual(expect.arrayContaining([expect.objectContaining({ value: 'BS' })]));
    expect(await session.applyAnswer(review.token, capture.captureId, { ...answer, question: review.label, meaning: undefined })).toContain('kept');
  });
  it('applies the saved answer to the one captured empty field without rerunning essays', async () => {
    const session = setup(choice + '<label for="other">Other empty field*</label><input id="other" required>');
    const result = await session.run();
    const review = result.reviewFields![0]!;
    const capture = session.captureAnswer(review.token, review.label);
    expect(await session.applyAnswer(review.token, capture.captureId, { ...answer, question: review.label, meaning: undefined })).toContain('applied');
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('BS');
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('');
    expect(submits).toBe(0);
  });
  it.each(['value', 'label', 'element'])('rejects stale %s after capture', async changed => {
    const session = setup(choice);
    const review = (await session.run()).reviewFields![0]!;
    const capture = session.captureAnswer(review.token, review.label);
    if (changed === 'value') (document.querySelector('select') as HTMLSelectElement).value = 'BA';
    if (changed === 'label') document.querySelector('label')!.textContent = 'A different question';
    if (changed === 'element') document.querySelector('select')!.replaceWith(document.querySelector('select')!.cloneNode(true));
    await expect(session.applyAnswer(review.token, capture.captureId, answer)).rejects.toThrow('changed');
  });
  it('rejects captures from disconnected sessions', async () => {
    const session = setup(choice);
    const review = (await session.run()).reviewFields![0]!;
    session.disconnect();
    expect(() => session.captureAnswer(review.token, review.label)).toThrow();
  });
  it.each([false, true])('captures and preserves a single React-select clearance chip (explicit multi-select: %s)', async multi => {
    const session = setup(`<label for="clearance">Active Security Clearance(s)*</label><div class="select__container"><div class="select__control"><input id="clearance" role="combobox" aria-expanded="false" ${multi ? 'aria-multiselectable="true"' : ''} required></div></div>`);
    const review = (await session.run()).reviewFields!.find(f => f.label === 'Active Security Clearance(s)')!;
    document.querySelector('.select__control')!.insertAdjacentHTML('afterbegin', '<div class="select__multi-value"><span class="select__multi-value__label">Never held a clearance</span><span class="select__multi-value__remove" role="button">×</span></div>');
    expect(session.verify().reviewFields!.find(f => f.token === review.token)?.answered).toBe(true);
    const captured = session.captureAnswer(review.token, review.label);
    expect(captured.value).toBe('Never held a clearance');
    const mapping: RememberedMapping = { ...answer, question: review.label, target: { kind: 'answer', value: captured.value }, meaning: questionMeaning(review.label)! };
    expect(await session.applyAnswer(review.token, captured.captureId, mapping)).toContain('kept');
    expect(document.querySelectorAll('.select__multi-value')).toHaveLength(1);
    expect(document.querySelector('.select__multi-value__label')!.textContent).toBe('Never held a clearance');
  });
  it('rejects multiple selected chips and changes to a chip after capture', async () => {
    const session = setup('<label for="q">Active Security Clearance(s)*</label><div class="select__container"><div class="select__control"><input id="q" role="combobox" aria-expanded="false" required></div></div>');
    const review = (await session.run()).reviewFields![0]!;
    const control = document.querySelector('.select__control')!;
    control.insertAdjacentHTML('afterbegin', '<div class="select__multi-value">Secret</div><div class="select__multi-value">DOE Q</div>');
    expect(() => session.captureAnswer(review.token, review.label)).toThrow('several selected');
    Array.from(control.querySelectorAll('.select__multi-value')).find(chip => chip.textContent === 'DOE Q')!.remove();
    const captured = session.captureAnswer(review.token, review.label);
    expect(captured.value).toBe('Secret');
    control.querySelector('.select__multi-value')!.textContent = 'Top Secret';
    await expect(session.applyAnswer(review.token, captured.captureId, answer)).rejects.toThrow('changed');
  });
  it('requires a committed choice instead of remembering React-select search text', async () => {
    const session = setup('<label for="q">Active Security Clearance(s)*</label><div class="select__container"><div class="select__control"><input id="q" role="combobox" aria-expanded="false" required></div></div>');
    const review = (await session.run()).reviewFields![0]!;
    document.querySelector('input')!.value = 'Never held a clearance';
    expect(() => session.captureAnswer(review.token, review.label)).toThrow('Choose an answer');
  });
  it('fills different question and degree wording through the entire engine', async () => {
    const session = setup('<label for="custom">Educational qualification*</label><select id="custom" required><option value="">Select…</option><option>BA</option><option>Bachelor of Science</option></select>', [answer]);
    expect((await session.run()).filledCount).toBe(1);
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('Bachelor of Science');
  });
  it('does not send uncertain saved-answer suggestions to AI field matching', async () => {
    document.body.innerHTML = '<form id="application-form"><label for="q">Which channel brought you to this opening?*</label><input id="q" required></form>';
    const { d } = deps({ mapFields: vi.fn(async () => ({ ok: true as const, keys: ['email'] })), matchSavedAnswers: async () => [{ mapping: null, suggestionId: 44, reason: 'Confirm' }] });
    const result = await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect(d.mapFields).not.toHaveBeenCalled();
    expect(result.reviewFields?.[0]?.suggestionId).toBe(44);
  });
  it('renders a linked profile boolean using the new question polarity', async () => {
    const record: RememberedMapping = { ...answer, question: 'Are you not a US citizen?', meaning: questionMeaning('Are you not a US citizen?')!, target: { kind: 'profile', key: 'usCitizen' } };
    const session = setup('<label for="citizen">Are you not a US citizen?*</label><select id="citizen" required><option value="">Select…</option><option>Yes</option><option>No</option></select>', [record]);
    await session.run();
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('No');
  });
});

describe('remembered mappings', () => {
  const source: RememberedMapping = {
    id: 1, schemaVersion: 1, updatedAt: 1, question: 'Where did you find this opportunity?',
    aliases: ['Which channel led you here?'], scope: 'greenhouse', target: { kind: 'answer', value: 'Company website' },
  };
  function remembered(records: RememberedMapping[] = [source]) {
    return deps({ rememberedMappings: vi.fn(async (questions) => selectRememberedMappings(records, 'greenhouse', questions)) });
  }
  const input = () => document.querySelector('input') as HTMLInputElement;

  it('exposes the full missing question, then reuses a taught answer on another form', async () => {
    document.body.innerHTML = '<form id="application-form"><label for="source">Where did you find this opportunity? *</label><input id="source" required></form>';
    const unknown = await new FillSession(document, ADAPTERS.greenhouse, deps().d).run();
    expect(unknown.missingQuestions).toEqual([source.question]);
    expect(input().value).toBe('');
    document.querySelector('label')!.textContent = 'WHICH CHANNEL LED YOU HERE? *';
    const { d, answers } = remembered();
    const summary = await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect(input().value).toBe('Company website');
    expect(summary.missingLabels).toEqual([]);
    expect(summary.filledCount).toBe(1);
    expect(answers).toEqual([]);
  });
  it('uses current profile values and the existing degree alias matching for linked fields', async () => {
    document.body.innerHTML = '<form id="application-form"><label for="qual">Qualification held*</label><select id="qual" required><option value="">Select…</option><option>Bachelor\'s Degree</option><option>Master\'s Degree</option></select></form>';
    const { d } = remembered([{ ...source, question: 'Qualification held', aliases: [], target: { kind: 'profile', key: 'degree' } }]);
    d.context.profile.education[0]!.degree = 'BS';
    await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe("Bachelor's Degree");
    document.querySelector('select')!.value = '';
    d.context.profile.education[0]!.degree = 'Master of Science';
    await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe("Master's Degree");
  });
  it('fills remembered facts before AI and preserves user edits across repeated fills', async () => {
    document.body.innerHTML = '<form id="application-form"><label for="essay">Tell us about a project*</label><textarea id="essay" required></textarea><label for="source">Where did you find this opportunity?*</label><input id="source" required></form>';
    const { d, answers } = remembered();
    d.answer = vi.fn(async () => {
      expect(input().value).toBe('Company website');
      return { ok: true as const, answer: 'Synthetic project response' };
    });
    await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect(d.answer).toHaveBeenCalledOnce();
    input().value = 'A friend';
    await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect(input().value).toBe('A friend');
    expect(d.answer).toHaveBeenCalledOnce();
    expect(answers).toEqual([]);
    expect(submits).toBe(0);
  });
  it('does not reuse old authored dropdown labels after a linked profile answer changes', async () => {
    document.body.innerHTML = '<form id="application-form"><label for="citizen">Are you a US citizen?*</label><select id="citizen" required><option value="">Select…</option><option>Yes, I am a citizen</option><option>No</option></select></form>';
    const m: RememberedMapping = { ...source, schemaVersion: 2, question: 'Are you a US citizen?', scope: 'all', aliases: [],
      target: { kind: 'profile', key: 'usCitizen' }, meaning: questionMeaning('Are you a US citizen?')!, answerAliases: ['Yes, I am a citizen'] };
    const { d } = deps({ matchSavedAnswers: async fields => {
      const index = new SavedAnswerIndex([m], { platform: 'greenhouse', company: 'Contoso', url: 'https://example.com/application' });
      return fields.map(f => index.match(f));
    } });
    d.context.hasGeminiKey = false;
    await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect(document.querySelector('select')!.value).toBe('Yes, I am a citizen');
    document.querySelector('select')!.value = '';
    d.context.profile.workAuth.status = 'H-1B';
    await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect(document.querySelector('select')!.value).toBe('No');
  });
  it('does not invoke AI for a remembered free response', async () => {
    document.body.innerHTML = '<form id="application-form"><label for="essay">Tell us about a project*</label><textarea id="essay" required></textarea></form>';
    const { d } = remembered([{ ...source, question: 'Tell us about a project', aliases: [], target: { kind: 'answer', value: 'My approved response' } }]);
    expect((await new FillSession(document, ADAPTERS.greenhouse, d).run()).aiAnswers).toBe(0);
    expect(d.answer).not.toHaveBeenCalled();
    expect(document.querySelector('textarea')!.value).toBe('My approved response');
  });
  it('selects remembered dropdown text rather than typing an uncommitted value', async () => {
    document.body.innerHTML = '<form id="application-form"><label for="source">Where did you find this opportunity?*</label><div class="select__container"><div class="select__control"><input id="source" role="combobox" aria-expanded="false" required></div></div></form>';
    const el = input();
    el.addEventListener('mousedown', () => {
      const menu = document.createElement('div');
      menu.setAttribute('role', 'listbox');
      for (const text of ['Company website', 'Referral']) {
        const option = document.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = text;
        option.onclick = () => {
          menu.remove();
          el.value = '';
          el.setAttribute('aria-expanded', 'false');
          const selected = document.createElement('div');
          selected.className = 'select__single-value';
          selected.textContent = text;
          el.parentElement!.appendChild(selected);
        };
        menu.appendChild(option);
      }
      el.setAttribute('aria-expanded', 'true');
      el.parentElement!.appendChild(menu);
    });
    const summary = await new FillSession(document, ADAPTERS.greenhouse, remembered().d).run();
    expect(document.querySelector('.select__single-value')?.textContent).toBe('Company website');
    expect(summary.filledCount).toBe(1);
    expect(el.value).toBe('');
  });
  it('loads mappings for conditional fields before continuing to free responses', async () => {
    document.body.innerHTML = '<form id="application-form"><label for="h">Are you Hispanic/Latino?*</label><select id="h" required><option value="">Select…</option><option>No</option><option>Yes</option></select></form>';
    document.querySelector('select')!.onchange = () => {
      const followup = document.createElement('div');
      followup.innerHTML = '<label for="followup">Which channel led you here?*</label><input id="followup" required>';
      document.querySelector('form')!.appendChild(followup);
    };
    const { d } = remembered();
    d.context.profile.eeo.hispanic = 'No';
    const summary = await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect((document.getElementById('followup') as HTMLInputElement).value).toBe('Company website');
    expect(summary.missingLabels).toEqual([]);
  });
  it('does not teach or fill files, challenges or consent boxes, even if matching entries exist', async () => {
    document.body.innerHTML = '<form id="application-form"><label for="bot">Prove you are human*</label><input id="bot" required><label for="file">Academic Transcript*</label><input id="file" type="file" required><label><input type="checkbox" required>I agree to the privacy policy</label></form>';
    const records = ['Prove you are human', 'Academic Transcript', 'I agree to the privacy policy'].map((question, i) => ({ ...source, id: i + 1, question, aliases: [] }));
    const { d } = remembered(records);
    const summary = await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect(input().value).toBe('');
    expect(summary.missingQuestions).toEqual([null, null, null]);
    expect(d.rememberedMappings).not.toHaveBeenCalled();
  });
  it('leaves unmatched options, empty linked facts, and too-long literal answers for the user', async () => {
    document.body.innerHTML = '<form id="application-form"><label for="source">Where did you find this opportunity?*</label><select id="source" required><option value="">Select…</option><option>Company social media</option><option>Referral</option></select></form>';
    const { d } = remembered();
    const summary = await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('');
    expect(summary.missingQuestions).toEqual([source.question]);
    document.body.innerHTML = '<form id="application-form"><label for="short">Where did you find this opportunity?*</label><input id="short" maxlength="3" required></form>';
    await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect(input().value).toBe('');
    const linked = remembered([{ ...source, target: { kind: 'profile', key: 'firstName' } }]);
    linked.d.context.profile.firstName = '';
    await new FillSession(document, ADAPTERS.greenhouse, linked.d).run();
    expect(input().value).toBe('');
  });
  it('preserves an existing native select answer at index zero', async () => {
    document.body.innerHTML = '<form id="application-form"><label for="source">Where did you find this opportunity?</label><select id="source"><option>Referral</option><option>Company website</option></select></form>';
    await new FillSession(document, ADAPTERS.greenhouse, remembered().d).run();
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('Referral');
  });
  it('revalidates a question that changes while its remembered answer is being loaded', async () => {
    document.body.innerHTML = '<form id="application-form"><label for="source">Where did you find this opportunity?*</label><input id="source" required></form>';
    const { d } = deps({ rememberedMappings: async () => {
      document.querySelector('label')!.textContent = 'Which certification do you hold?*';
      return [source];
    } });
    const summary = await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect(input().value).toBe('');
    expect(summary.missingQuestions).toEqual(['Which certification do you hold?']);
  });
  it('does not erase an existing page value when a linked employer fact is empty', async () => {
    document.body.innerHTML = '<form id="application-form"><label for="source">Where did you find this opportunity?</label><input id="source" value="A friend"></form>';
    const { d } = remembered([{ ...source, target: { kind: 'profile', key: 'currentCompany' } }]);
    d.context.profile.currentCompany = '';
    await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect(input().value).toBe('A friend');
  });
});

describe('Greenhouse', () => {
  it.each([
    ['BS', ["Associate's Degree", "Bachelor's Degree", "Master's Degree"], "Bachelor's Degree"],
    ['B.S.', ["Bachelor's Degree", "Master's Degree"], "Bachelor's Degree"],
    ['BSc', ["Bachelor's Degree", "Master's Degree"], "Bachelor's Degree"],
    ['Bachelor of Science', ["Associate's Degree", "Bachelor's Degree", "Master's Degree"], "Bachelor's Degree"],
    ['Bachelors Degree', ["Bachelor's Degree", "Master's Degree"], "Bachelor's Degree"],
    ['B.B.A.', ["Associate's Degree", "Bachelor's Degree", "Master's Degree"], "Bachelor's Degree"],
    ['Baccalaureate', ["Bachelor's Degree", "Master's Degree"], "Bachelor's Degree"],
    ["Bachelor's Degree", ['BS', 'MS', 'PhD'], 'BS'],
    ['BS', ['Bachelor of Arts', 'Bachelor of Science', 'Master of Science'], 'Bachelor of Science'],
    ['BA', ['Bachelor of Science', 'Bachelor of Arts'], 'Bachelor of Arts'],
    ['BS', ['BA', 'MS'], ''],
    ["Bachelor's Degree", ['BA', 'BS', 'MS'], ''],
    ['BS', ["Associate's Degree", "Master's Degree"], ''],
    ["Bachelor's Degree", ['International Baccalaureate Diploma', "Master's Degree"], ''],
    ['', ["Bachelor's Degree", "Master's Degree"], ''],
  ] as const)('maps saved degree %s to equivalent degree options %j', async (degree, options, expected) => {
    document.body.innerHTML = '<form id="application-form"><label for="degree--0">Degree*</label><select id="degree--0"><option value="">Select…</option></select></form>';
    const select = document.getElementById('degree--0') as HTMLSelectElement;
    for (const text of options) {
      const option = document.createElement('option');
      option.value = option.textContent = text;
      select.appendChild(option);
    }
    const { d } = deps();
    d.context.profile.education[0]!.degree = degree;
    const summary = await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect(select.value).toBe(expected);
    expect(summary.filledCount).toBe(expected ? 1 : 0);
    expect(submits).toBe(0);
  });

  it.each([
    ['BS', ["Associate's Degree", "Bachelor's Degree", "Master's Degree"], "Bachelor's Degree"],
    ["Bachelor's Degree", ['AS', 'BS', 'MS'], 'BS'],
    ['BS', ['Bachelor of Arts', 'Bachelor of Science'], 'Bachelor of Science'],
  ] as const)('clicks and retains the matching custom degree option for %s', async (degree, options, expected) => {
    document.body.innerHTML = '<form id="application-form"><label for="degree--0">Degree*</label><div class="select__container"><div class="select__control"><input id="degree--0" role="combobox" aria-expanded="false"></div></div></form>';
    const input = document.getElementById('degree--0') as HTMLInputElement;
    const control = input.parentElement!;
    input.addEventListener('mousedown', () => {
      const menu = document.createElement('div');
      menu.id = 'degree-menu';
      menu.setAttribute('role', 'listbox');
      for (const text of options) {
        const option = document.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = text;
        option.addEventListener('click', () => {
          menu.remove();
          input.value = '';
          input.setAttribute('aria-expanded', 'false');
          const selected = document.createElement('div');
          selected.className = 'select__single-value';
          selected.textContent = text;
          control.appendChild(selected);
        });
        menu.appendChild(option);
      }
      input.setAttribute('aria-controls', menu.id);
      input.setAttribute('aria-expanded', 'true');
      control.appendChild(menu);
    });
    const { d } = deps();
    d.context.profile.education[0]!.degree = degree;
    const summary = await new FillSession(document, ADAPTERS.greenhouse, d).run();
    expect(control.querySelector('.select__single-value')?.textContent).toBe(expected);
    expect(input.value).toBe('');
    expect(summary.filledCount).toBe(1);
    expect(submits).toBe(0);
  });

  it('classifies the real form', () => {
    const doc = loadFixture('greenhouse.html', 'https://job-boards.greenhouse.io/northwind/jobs/8806482002');
    const byLabel = Object.fromEntries(classified(doc, 'greenhouse').map((f) => [f.label, f.cls]));
    expect(byLabel['First Name']).toBe('firstName');
    expect(byLabel['Last Name']).toBe('lastName');
    expect(byLabel['Preferred First Name']).toBe('preferredName');
    expect(byLabel['Email']).toBe('email');
    expect(byLabel['Phone']).toBe('phone');
    expect(byLabel['Location (City)']).toBe('location');
    expect(byLabel['Why do you want to work at Northwind?']).toBe('free_response');
    expect(byLabel['LinkedIn Profile']).toBe('linkedin');
    expect(byLabel['How did you hear about this job?']).toBe('unknown');
    expect(byLabel['Are you legally authorized to work in the United States for our Company?']).toBe('authorized');
    expect(byLabel['Are you currently located in the US?']).toBe('inUS');
    expect(byLabel['Are you currently based in or willing to relocate to the Bay Area for this position?']).toBe('relocate');
    expect(byLabel['Veteran Status']).toBe('veteran');
    expect(byLabel['Disability Status']).toBe('disability');
    expect(byLabel['Are you Hispanic/Latino?']).toBe('hispanic');
    expect(byLabel['I consider myself a member of the LGBTQ+ community']).toBe('declineOnly');
  });

  it('reads company and role', () => {
    const doc = loadFixture('greenhouse.html', 'https://job-boards.greenhouse.io/northwind/jobs/8806482002');
    const info = ADAPTERS.greenhouse.jobInfo(doc);
    expect(info.company).toBe('Northwind');
    expect(info.role).toBe('Commercial Policy Lead');
    expect(info.description.length).toBeGreaterThan(50);
  });

  it('fills text fields and react-select dropdowns, writes the free response, never submits', async () => {
    const doc = loadFixture('greenhouse.html', 'https://job-boards.greenhouse.io/northwind/jobs/8806482002');
    // Minimal react-select stand-in: opening the control renders options into a listbox.
    const menus: Record<string, string[]> = {
      question_38318892002: ['Yes', 'No'],
      gender: ['Male', 'Female', 'Decline To Self Identify'],
      veteran_status: ['I am a veteran', 'I am not a protected veteran', "I don't wish to answer"],
    };
    for (const [id, options] of Object.entries(menus)) {
      const input = doc.getElementById(id) as HTMLInputElement;
      input.addEventListener('mousedown', () => {
        if (doc.getElementById(`${id}-menu`)) return;
        const menu = doc.createElement('div');
        menu.id = `${id}-menu`;
        menu.setAttribute('role', 'listbox');
        options.forEach((text) => {
          const opt = doc.createElement('div');
          opt.setAttribute('role', 'option');
          opt.textContent = text;
          opt.addEventListener('click', () => {
            menu.remove();
            const single = doc.createElement('div');
            single.className = 'select__single-value';
            single.textContent = text;
            input.parentElement!.appendChild(single);
          });
          menu.appendChild(opt);
        });
        input.setAttribute('aria-controls', menu.id);
        input.parentElement!.appendChild(menu);
      });
    }

    const { d, answers } = deps();
    const session = new FillSession(doc, ADAPTERS.greenhouse, d);
    const summary = await session.run();

    expect((doc.getElementById('first_name') as HTMLInputElement).value).toBe('Jordan');
    expect((doc.getElementById('preferred_name') as HTMLInputElement).value).toBe('Jo');
    expect((doc.getElementById('email') as HTMLInputElement).value).toBe('jordan@example.com');
    expect((doc.getElementById('question_38318889002') as HTMLInputElement).value).toContain('linkedin.com');
    expect(doc.getElementById('question_38318892002')!.parentElement!.textContent).toContain('Yes');
    expect(doc.getElementById('gender')!.parentElement!.textContent).toContain('Female');
    expect(doc.getElementById('veteran_status')!.parentElement!.textContent).toContain('I am not a protected veteran');

    expect(answers).toHaveLength(1);
    expect(answers[0]!.question).toBe('Why do you want to work at Northwind?');
    expect(answers[0]!.company).toBe('Northwind');
    expect((doc.getElementById('question_38318888002') as HTMLTextAreaElement).value).toMatch(/^Answer to:/);

    expect(summary.aiAnswers).toBe(1);
    expect(summary.filledCount).toBeGreaterThanOrEqual(8);
    // Dropdowns with no menu in this static page stay empty and are flagged.
    expect(summary.missingLabels).toContain('Disability Status');
    expect(doc.getElementById('first_name')!.getAttribute('data-jaf-state')).toBe('filled');
    expect(doc.getElementById('question_38318888002')!.getAttribute('data-jaf-state')).toBe('ai');
    expect(submits).toBe(0);
  });
});

describe('Lever', () => {
  it('classifies the real form, including card questions', () => {
    const doc = loadFixture('lever.html', 'https://jobs.lever.co/contoso/6ed76ce8-4156-4b60-b120-403538bd66cd/apply');
    const fields = classified(doc, 'lever');
    const byLabel = Object.fromEntries(fields.map((f) => [f.label, f.cls]));
    expect(byLabel['Full name']).toBe('fullName');
    expect(byLabel['Current location']).toBe('location');
    expect(byLabel['Current company']).toBe('currentCompany');
    expect(byLabel['GitHub URL']).toBe('github');
    expect(byLabel['Preferred Name | What would you like us to call you?']).toBe('preferredName');
    expect(byLabel['Name Pronunciation | How do you pronounce your name?']).toBe('unknown');
    expect(byLabel['Are you legally authorized to work in the country for which you are applying?']).toBe('authorized');
    expect(byLabel['Will you now or in the future require sponsorship for employment visa status (e.g., H-1B, etc.)?']).toBe('sponsorship');
    expect(byLabel['Please tell us how you heard about this opportunity.']).toBe('unknown');
    expect(byLabel['Why do you want to work at Contoso?']).toBe('free_response');
    const resume = fields.find((f) => f.kind === 'file');
    expect(resume?.cls).toBe('resume');
    expect(resume?.required).toBe(true);
  });

  it('fills radios, selects, and EEO dropdowns', async () => {
    const doc = loadFixture('lever.html', 'https://jobs.lever.co/contoso/6ed76ce8-4156-4b60-b120-403538bd66cd/apply');
    const { d, answers } = deps();
    const summary = await new FillSession(doc, ADAPTERS.lever, d).run();

    const val = (sel: string) => (doc.querySelector(sel) as HTMLInputElement).value;
    expect(val('input[name="name"]')).toBe('Jordan Rivera');
    expect(val('input[name="org"]')).toBe('Acme Corp');
    expect(val('input[name="location"]')).toBe('San Francisco, CA');
    const checked = (name: string) =>
      (doc.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement | null)?.value;
    const radios = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    const groups = [...new Set(radios.map((r) => r.name))];
    expect(checked(groups[0]!)).toBe('Yes'); // authorized
    expect(checked(groups[1]!)).toBe('No'); // sponsorship
    expect(val('select[name="eeo[gender]"]')).toBe('Female');
    expect(val('select[name="eeo[race]"]')).toBe('Decline to self-identify');
    expect(val('select[name="eeo[veteran]"]')).toBe('I am not a veteran');

    // Two textareas are free responses; the description comes from the Lever API when not on the page.
    expect(answers.map((a) => a.question)).toEqual([
      'What has been your favorite project or proudest accomplishment? Why?',
      'Why do you want to work at Contoso?',
    ]);
    expect(answers[0]!.company).toBe('Contoso Labs');
    expect(answers[0]!.role).toBe('Administrative Business Partner');
    expect(summary.missingLabels).toContain('Language Skill(s) (Check all that apply)');
    expect(submits).toBe(0);
  });
});

describe('Ashby', () => {
  it('clicks Yes/No buttons, skips anti-bot puzzles, and flags unknown questions', async () => {
    const doc = loadFixture('ashby.html', 'https://jobs.ashbyhq.com/example/abc-123/application');
    for (const btn of Array.from(doc.querySelectorAll('button[data-option]'))) {
      btn.addEventListener('click', () => {
        btn.parentElement!.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      });
    }
    const { d, answers } = deps();
    const summary = await new FillSession(doc, ADAPTERS.ashby, d).run();

    expect((doc.getElementById('_systemfield_name') as HTMLInputElement).value).toBe('Jordan Rivera');
    expect((doc.getElementById('dc915b3a-linkedin') as HTMLInputElement).value).toContain('linkedin');
    const auth = doc.querySelector('[data-field-path="3080cfba-auth"] button[data-option="yes"]')!;
    expect(auth.getAttribute('aria-pressed')).toBe('true');
    expect((doc.querySelector('input[name="_systemfield_eeoc_gender"][value="Female"]') as HTMLInputElement).checked).toBe(true);
    // Text-message consent follows the saved choice; the sample profile has not opted in.
    expect((doc.querySelector('input[name="communicationConsent"][value="notGiven"]') as HTMLInputElement).checked).toBe(true);
    expect(doc.querySelectorAll('input[name="communicationConsent"][value="given"]:checked')).toHaveLength(0);

    expect(answers).toHaveLength(1);
    expect(answers[0]!.question).toContain('Why are you interested in Example Co?');
    expect(answers[0]!.characterLimit).toBe(600);
    expect(answers[0]!.jobDescription).toBe('Remote description');

    expect(summary.missingLabels).toEqual(
      expect.arrayContaining([
        'Do you have a minimum of 7 years of experience building software?',
        expect.stringContaining("Here's some text encoded"),
      ]),
    );
    expect(submits).toBe(0);
  });

  it('always agrees to "Acknowledge, confirm, and agree" as a dropdown or a checkbox', async () => {
    const doc = loadFixture('lever.html', 'https://jobs.lever.co/contoso/abc/apply');
    doc.body.innerHTML = `<form><label for="a">Acknowledge, confirm, and agree to the following statements. *</label>
      <select id="a"><option value="">Select…</option><option>Yes, I acknowledge, agree, and confirm.</option><option>No, I do not acknowledge, agree, or confirm.</option></select>
      <label><input type="checkbox" id="c" name="c"> Acknowledge, confirm, and agree to the following statements</label></form>`;
    const { d } = deps();
    await new FillSession(doc, ADAPTERS.lever, d).run();
    expect((doc.getElementById('a') as HTMLSelectElement).selectedIndex).toBe(1);
    expect((doc.getElementById('c') as HTMLInputElement).checked).toBe(true);
  });

  it('always answers Yes to "essential functions with or without reasonable accommodations"', async () => {
    const doc = loadFixture('lever.html', 'https://jobs.lever.co/contoso/abc/apply');
    doc.body.innerHTML = `<form><label for="e">Can you perform all of the essential functions of this role with or without reasonable accommodations? *</label>
      <select id="e"><option value="">Select…</option><option>No</option><option>Yes</option></select></form>`;
    const { d } = deps();
    await new FillSession(doc, ADAPTERS.lever, d).run();
    expect((doc.getElementById('e') as HTMLSelectElement).value).toBe('Yes');
  });

  it('answers Yes to text-message consent when the profile opts in, and classifies a lone consent box', async () => {
    const doc = loadFixture('ashby.html', 'https://jobs.ashbyhq.com/example/abc-123/application');
    const profile = { ...sampleProfile(), textConsent: true };
    const { d } = deps({ context: { profile, resume: RESUME, coverLetter: null, transcript: null, hasGeminiKey: false } });
    await new FillSession(doc, ADAPTERS.ashby, d).run();
    expect((doc.querySelector('input[name="communicationConsent"][value="given"]') as HTMLInputElement).checked).toBe(true);

    const box = loadFixture('ashby.html', 'https://jobs.ashbyhq.com/example/abc-123/application');
    box.body.innerHTML = '<form><label><input type="checkbox" name="sms"> I consent to receive text messages</label><label><input type="checkbox" name="t"> I agree to the terms and receive text messages</label></form>';
    const [lone, bundled] = scanFields(box.body).map((f) => classifyField(f).kind === 'profile' ? 'textConsent' : classifyField(f).kind);
    expect(lone).toBe('textConsent');
    expect(bundled).toBe('consent');
  });

  it('flags free responses when no Gemini key is set, and fills everything else', async () => {
    const doc = loadFixture('ashby.html', 'https://jobs.ashbyhq.com/example/abc-123/application');
    const { d } = deps();
    d.context.hasGeminiKey = false;
    const summary = await new FillSession(doc, ADAPTERS.ashby, d).run();
    expect(d.answer).not.toHaveBeenCalled();
    expect(summary.missingLabels.some((l) => l.startsWith('Why are you interested'))).toBe(true);
    expect(summary.aiNote).toMatch(/Gemini API key/);
    expect((doc.getElementById('_systemfield_email') as HTMLInputElement).value).toBe('jordan@example.com');
  });

  it('flags a free response when Gemini fails, without blocking the rest', async () => {
    const doc = loadFixture('ashby.html', 'https://jobs.ashbyhq.com/example/abc-123/application');
    const { d } = deps({ answer: vi.fn(async () => ({ ok: false as const, error: 'Gemini rate limit' })) });
    const summary = await new FillSession(doc, ADAPTERS.ashby, d).run();
    expect(summary.aiAnswers).toBe(0);
    expect(summary.aiNote).toBe('Gemini rate limit');
    expect((doc.getElementById('0086e069-why') as HTMLTextAreaElement).value).toBe('');
    expect(doc.getElementById('0086e069-why')!.getAttribute('data-jaf-state')).toBe('missing');
  });
});

describe('Ashby EEO section outside the first container', () => {
  it('fills the multiple choice EEO questions', async () => {
    const doc = loadFixture('ashby.html', 'https://jobs.ashbyhq.com/example/abc-123/application');
    const group = (key: string, title: string, options: string[]) =>
      `<fieldset class="ashby-application-form-input-radio-group"><label class="ashby-application-form-question-title" for="_systemfield_eeoc_${key}">${title}</label>${options
        .map(
          (o, i) =>
            `<div class="opt"><span><input type="radio" id="u__systemfield_eeoc_${key}-${i}" name="u__systemfield_eeoc_${key}"></span><label for="u__systemfield_eeoc_${key}-${i}" class="opt-label">${o}</label></div>`,
        )
        .join('')}</fieldset>`;
    doc.body.innerHTML = `<div class="ashby-application-form-container"><div class="ashby-application-form-section-container"><div class="ashby-application-form-field-entry"><label for="_systemfield_name">Name</label><input id="_systemfield_name" type="text"></div></div></div>
      <div><div class="ashby-application-form-section-container">${group('gender', 'Gender', ['Male', 'Female', 'Decline to self-identify'])}${group('race', 'Race', ['Hispanic or Latino', 'White (Not Hispanic or Latino)', 'Decline to self-identify'])}${group('veteran_status', 'Veteran Status', ['I am not a protected veteran', 'I decline to self-identify for protected veteran status'])}</div></div>`;
    const eeo = { gender: 'Decline to answer', race: 'Decline to answer', hispanic: 'Decline to answer', veteran: 'Decline to answer', disability: 'Decline to answer' };
    const { d } = deps({ context: { profile: { ...sampleProfile(), eeo }, resume: RESUME, coverLetter: null, transcript: null, hasGeminiKey: false } });
    await new FillSession(doc, ADAPTERS.ashby, d).run();
    const picked = (n: string) => (doc.querySelector(`input[name="u__systemfield_eeoc_${n}"]:checked`)?.id ?? '');
    expect(picked('gender')).toBe('u__systemfield_eeoc_gender-2');
    expect(picked('race')).toBe('u__systemfield_eeoc_race-2');
    expect(picked('veteran_status')).toBe('u__systemfield_eeoc_veteran_status-1');
  });
});

describe('open dropdowns', () => {
  it('closes a dropdown left open after a question it could not answer', async () => {
    const doc = loadFixture('lever.html', 'https://jobs.lever.co/contoso/abc/apply');
    doc.body.innerHTML = '<form><label for="q">Are you open to working 4 days onsite in one of our offices?</label><input id="q" role="combobox" aria-expanded="false" type="text"></form>';
    const input = doc.getElementById('q') as HTMLInputElement;
    // Opens on focus and only closes on Escape, like a react-select menu.
    input.addEventListener('focus', () => input.setAttribute('aria-expanded', 'true'));
    input.addEventListener('keydown', (e) => e.key === 'Escape' && input.setAttribute('aria-expanded', 'false'));
    input.addEventListener('mousedown', () => input.setAttribute('aria-expanded', 'true'));
    const profile = { ...sampleProfile(), preferences: { ...sampleProfile().preferences, workMode: 'onsite' as const } };
    const { d } = deps({ context: { profile, resume: RESUME, coverLetter: null, transcript: null, hasGeminiKey: false } });
    await new FillSession(doc, ADAPTERS.lever, d).run();
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('conditional questions', () => {
  it('fills a race question that only appears after Hispanic/Latino is answered', async () => {
    const doc = loadFixture('lever.html', 'https://jobs.lever.co/contoso/abc/apply');
    doc.body.innerHTML = `<form><label for="h">Are you Hispanic/Latino?</label>
      <select id="h"><option value="">Select…</option><option>Yes</option><option>No</option><option>Decline To Self Identify</option></select></form>`;
    const hispanic = doc.getElementById('h') as HTMLSelectElement;
    hispanic.addEventListener('change', () => {
      setTimeout(() => {
        doc.querySelector('form')!.insertAdjacentHTML(
          'beforeend',
          `<label for="r">Please identify your race</label><select id="r"><option value="">Select…</option><option>White</option><option>Decline To Self Identify</option></select>`,
        );
      }, 0);
    });
    const profile = { ...sampleProfile(), eeo: { ...sampleProfile().eeo, hispanic: 'No' } };
    const { d } = deps({ context: { profile, resume: RESUME, coverLetter: null, transcript: null, hasGeminiKey: false } });
    await new FillSession(doc, ADAPTERS.lever, d).run();
    expect(hispanic.value).toBe('No');
    expect((doc.getElementById('r') as HTMLSelectElement).value).toBe('Decline To Self Identify');
  });
});

describe('conditional question order', () => {
  it('fills the race question revealed by Hispanic/Latino before moving on to veteran status', async () => {
    const doc = loadFixture('lever.html', 'https://jobs.lever.co/contoso/abc/apply');
    doc.body.innerHTML = `<form><div id="h-wrap"><label for="h">Are you Hispanic/Latino?</label>
      <select id="h"><option value="">Select…</option><option>Yes</option><option>No</option><option>Decline To Self Identify</option></select></div>
      <label for="v">Veteran Status</label>
      <select id="v"><option value="">Select…</option><option>I am not a protected veteran</option><option>Decline To Self Identify</option></select></form>`;
    const order: string[] = [];
    doc.querySelector('form')!.addEventListener('change', (e) => order.push((e.target as HTMLElement).id));
    const hispanic = doc.getElementById('h') as HTMLSelectElement;
    // Like Greenhouse: the race question renders a moment after "No", directly under Hispanic/Latino.
    hispanic.addEventListener('change', () => {
      if (hispanic.value !== 'No') return;
      setTimeout(() => {
        doc.getElementById('h-wrap')!.insertAdjacentHTML(
          'afterend',
          `<label for="r">Please identify your race</label><select id="r"><option value="">Select…</option><option>White</option><option>Decline To Self Identify</option></select>`,
        );
      }, 150);
    });
    const profile = { ...sampleProfile(), eeo: { ...sampleProfile().eeo, hispanic: 'No' } };
    const { d } = deps({ context: { profile, resume: RESUME, coverLetter: null, transcript: null, hasGeminiKey: false } });
    await new FillSession(doc, ADAPTERS.lever, d).run();
    expect((doc.getElementById('r') as HTMLSelectElement).value).toBe('Decline To Self Identify');
    expect(order).toEqual(['h', 'r', 'v']);
  });
});

describe('Lever resume prefill', () => {
  it('clears an employer the site prefilled when the profile has no current company and the field is optional', async () => {
    const doc = loadFixture('lever.html', 'https://jobs.lever.co/contoso/6ed76ce8-4156-4b60-b120-403538bd66cd/apply');
    const org = doc.querySelector('input[name="org"]') as HTMLInputElement;
    org.value = 'Apple';
    const { d } = deps();
    d.context.profile.currentCompany = '';
    await new FillSession(doc, ADAPTERS.lever, d).run();
    expect(org.value).toBe('');
  });
});

describe('Lever late resume prefill', () => {
  it('clears an employer the parser fills after the fill pass, unless the person has started typing', async () => {
    const doc = loadFixture('lever.html', 'https://jobs.lever.co/contoso/6ed76ce8-4156-4b60-b120-403538bd66cd/apply');
    const org = doc.querySelector('input[name="org"]') as HTMLInputElement;
    const { d } = deps();
    d.context.profile.currentCompany = '';
    await new FillSession(doc, ADAPTERS.lever, d).run();
    org.value = 'Apple';
    await new Promise((r) => setTimeout(r, 700));
    expect(org.value).toBe('');
    org.dispatchEvent(new Event('keydown'));
    org.value = 'Mine';
    await new Promise((r) => setTimeout(r, 700));
    expect(org.value).toBe('Mine');
  });
});

describe('Lever location typeahead', () => {
  it('re-searches and picks the first suggestion when the box was prefilled without choosing one', async () => {
    const doc = loadFixture('lever.html', 'https://jobs.lever.co/contoso/6ed76ce8-4156-4b60-b120-403538bd66cd/apply');
    const loc = doc.querySelector('input[name="location"]') as HTMLInputElement;
    const hidden = doc.querySelector('input[name="selectedLocation"]') as HTMLInputElement;
    loc.value = 'Berkeley, CA';
    loc.addEventListener('keydown', () => {
      setTimeout(() => {
        const results = doc.querySelector('.dropdown-results')!;
        results.innerHTML = '<div class="dropdown-location" id="location-0">San Francisco, CA, USA</div><div class="dropdown-location" id="location-1">San Francisco, Campeche, MEX</div>';
      }, 5);
    });
    doc.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement;
      if (t.classList?.contains('dropdown-location')) {
        loc.value = t.textContent ?? '';
        hidden.value = '{"id":"x"}';
      }
    });
    const { d } = deps();
    await new FillSession(doc, ADAPTERS.lever, d).run();
    expect(loc.value).toBe('San Francisco, CA, USA');
    expect(hidden.value).not.toBe('');
    // The site's resume parser resets the hidden choice after the fact; it gets restored.
    hidden.value = '';
    await new Promise((r) => setTimeout(r, 700));
    expect(hidden.value).toBe('{"id":"x"}');
    hidden.value = '{"name":""}';
    await new Promise((r) => setTimeout(r, 700));
    expect(hidden.value).toBe('{"id":"x"}');
    // Also restored right when a submit is attempted.
    hidden.value = '';
    doc.dispatchEvent(new Event('click', { bubbles: true }));
    expect(hidden.value).toBe('{"id":"x"}');
  });
});
