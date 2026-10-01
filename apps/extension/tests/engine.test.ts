import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADAPTERS } from '../lib/autofill/adapters';
import { classifyField } from '../lib/autofill/classify';
import { FillSession, type EngineDeps } from '../lib/autofill/engine';
import { timing } from '../lib/autofill/fill';
import { scanFields } from '../lib/autofill/scan';
import type { AnswerRequest } from '../lib/messages';
import { readFieldIssues } from '../lib/types';
import { loadFixture, sampleProfile } from './helpers';

const RESUME = { name: 'resume.pdf', type: 'application/pdf', base64: btoa('%PDF-1.4 test') };

function deps(overrides: Partial<EngineDeps> = {}) {
  const answers: AnswerRequest[] = [];
  const d: EngineDeps = {
    context: { profile: sampleProfile(), resume: RESUME, coverLetter: null, hasGeminiKey: true },
    answer: vi.fn(async (req: AnswerRequest) => {
      answers.push(req);
      return { ok: true as const, answer: `Answer to: ${req.question.slice(0, 20)}` };
    }),
    jobDescription: vi.fn(async () => 'Remote description'),
    ...overrides,
  };
  return { d, answers };
}

function classified(doc: Document, platform: 'greenhouse' | 'lever' | 'ashby' | 'generic') {
  const adapter = ADAPTERS[platform];
  return scanFields(adapter.formRoot(doc)).map((f) => {
    const c = classifyField(f, adapter.keys);
    return { label: f.label, kind: f.kind, required: f.required, cls: c.kind === 'profile' ? c.key : c.kind };
  });
}

describe('Other websites', () => {
  it('reads old label-only results and discards malformed diagnostics from messages or storage', () => {
    expect(readFieldIssues(undefined)).toEqual([]);
    expect(readFieldIssues({ label: 'School', reason: 'Missing answer' })).toEqual([]);
    expect(readFieldIssues([
      null, { label: 123, reason: 'Invalid' }, { label: 'School', reason: 'x'.repeat(601) },
      { label: 'Degree', reason: 'Missing saved answer', applicantValue: 'do not persist this' },
    ])).toEqual([{ label: 'Degree', reason: 'Missing saved answer' }]);
  });
  it('uses general field labels to fill a standard application form', async () => {
    const doc = loadFixture('generic.html', 'https://careers.example.test/apply');
    const adapter = ADAPTERS.generic;
    expect(classified(doc, 'generic').map((f) => f.cls)).toContain('email');

    const { d } = deps();
    const summary = await new FillSession(doc, adapter, d).run();

    expect((doc.querySelector('#email') as HTMLInputElement).value).toBe('jordan@example.com');
    expect((doc.querySelector('#first-name') as HTMLInputElement).value).toBe('Jordan');
    expect(summary.filledCount).toBe(2);
  });

  it('does not count an unselected dropdown search query as a completed answer', async () => {
    const doc = loadFixture('generic.html', 'https://careers.example.test/apply');
    doc.querySelector('form')!.innerHTML = `
      <label for="school">School</label>
      <div><input id="school" role="combobox" aria-autocomplete="list" aria-expanded="false" required></div>
    `;
    const { d } = deps();
    d.context.profile.education[0]!.school = 'UC Berkeley';
    const summary = await new FillSession(doc, ADAPTERS.generic, d).run();

    expect((doc.querySelector('#school') as HTMLInputElement).value).toBe('');
    expect(summary.missingLabels).toContain('School');
  });

  it.each([
    ['UC Berkeley', 'University of California, Berkeley', 'University of California, Berkeley'],
    ['SJSU', 'San José State University', 'San Jose State University'],
  ])('searches an official name when Greenhouse does not recognize %s', async (school, optionLabel, query) => {
    const doc = loadFixture('generic.html', 'https://careers.example.test/apply');
    doc.querySelector('form')!.innerHTML = `
      <label for="school">School</label>
      <div class="school-control"><input id="school" role="combobox" aria-autocomplete="list" aria-expanded="false"></div>
    `;
    const input = doc.querySelector<HTMLInputElement>('#school')!;
    const menu = doc.createElement('div');
    menu.id = 'school-options';
    menu.setAttribute('role', 'listbox');
    menu.innerHTML = '<div role="option">Start typing to search</div>';
    input.setAttribute('aria-controls', menu.id);
    const queries: string[] = [];
    input.addEventListener('mousedown', () => input.parentElement!.appendChild(menu));
    input.addEventListener('input', () => {
      queries.push(input.value);
      setTimeout(() => {
        menu.innerHTML = '';
        // Abbreviated queries can return no options on Greenhouse.
        if (input.value === school) return;
        const option = doc.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = optionLabel;
        option.addEventListener('click', () => {
          input.value = '';
          const selected = doc.createElement('span');
          selected.className = 'select__single-value';
          selected.textContent = option.textContent;
          input.parentElement!.appendChild(selected);
          menu.remove();
        });
        menu.appendChild(option);
      }, 10);
    });

    const { d } = deps();
    d.context.profile.education[0]!.school = school;
    const summary = await new FillSession(doc, ADAPTERS.generic, d).run();

    expect(input.parentElement!.textContent).toContain(optionLabel);
    expect(input.value).toBe('');
    expect(summary.filledCount).toBe(1);
    expect(queries).toContain(query);
  });

  it('explains missing profile answers separately from unsupported questions and dropdown failures', async () => {
    const doc = loadFixture('generic.html', 'https://careers.example.test/apply');
    doc.querySelector('form')!.innerHTML = `
      <label for="degree">Degree</label><input id="degree" role="combobox" required>
      <label for="school">School</label><input id="school" role="combobox" required>
      <label for="auth">Are you legally authorized to work in the United States?</label><select id="auth" required><option value="">Select</option><option>Yes</option><option>No</option></select>
      <label for="clearance">Active Security Clearance(s)</label><input id="clearance" role="combobox" required>
      <label for="transcript">Academic Transcript</label><input id="transcript" type="file" required>
      <label for="gender">Gender</label><select id="gender"><option value="">Select</option><option>Female</option></select>
    `;
    const { d } = deps();
    d.context.profile.education[0]!.degree = '';
    d.context.profile.workAuth.authorizedUS = '';
    const summary = await new FillSession(doc, ADAPTERS.generic, d).run();
    const reasons = Object.fromEntries(summary.missingFields.map(f => [f.label, f.reason]));
    expect(reasons.Degree).toContain('Settings → Education → Degree');
    expect(reasons.School).toContain('No matching dropdown option');
    expect(reasons['Are you legally authorized to work in the United States?']).toContain('Settings → Work authorization');
    expect(reasons['Active Security Clearance(s)']).toContain('Active security clearance / history');
    expect(reasons['Academic Transcript']).toContain('Upload this document');
    expect(reasons.Gender).toContain('Voluntary self-identification');
    expect(JSON.stringify(summary.missingFields)).not.toContain('jordan@example.com');
  });

  it('fills controls recreated during an earlier field selection before reporting results', async () => {
    const doc = loadFixture('generic.html', 'https://careers.example.test/apply');
    const form = doc.querySelector('form')!;
    form.innerHTML = '<label for="first-name">First name</label><input id="first-name" required><label for="school">School</label><input id="school" required>';
    doc.querySelector('#first-name')!.addEventListener('input', () => {
      form.querySelector('#school')!.outerHTML = '<input id="school" required>';
    });
    const { d } = deps();
    const summary = await new FillSession(doc, ADAPTERS.generic, d).run();
    expect((doc.querySelector('#school') as HTMLInputElement).value).toBe('University of California, Berkeley');
    expect(summary.missingLabels).not.toContain('School');
    expect(summary.filledCount).toBe(2);
  });

  it('fills race revealed by a saved dropdown answer before requesting any AI draft', async () => {
    const doc = loadFixture('generic.html', 'https://careers.example.test/apply');
    const form = doc.querySelector('form')!;
    form.innerHTML = `<label for="hispanic">Are you Hispanic/Latino?</label>
      <select id="hispanic"><option value="">Select</option><option>Yes</option><option>No</option></select>
      <label for="essay">Tell us about your proudest accomplishment</label><textarea id="essay" required></textarea>`;
    doc.querySelector('#hispanic')!.addEventListener('change', () => {
      if (!doc.querySelector('#race')) form.insertAdjacentHTML('beforeend',
        '<label for="race">Please identify your race</label><select id="race"><option value="">Select</option><option>Asian</option><option>White</option></select>');
    });
    const { d } = deps();
    Object.assign(d.context.profile.eeo, { autofillSaved: true, hispanic: 'No', race: 'Asian' });
    d.answer = vi.fn(async () => {
      expect((doc.querySelector('#race') as HTMLSelectElement).value).toBe('Asian');
      return { ok: true as const, answer: 'Synthetic accomplishment draft.' };
    });
    const summary = await new FillSession(doc, ADAPTERS.generic, d).run();
    expect(d.answer).toHaveBeenCalledTimes(1);
    expect(summary.filledCount).toBe(2);
    expect(summary.aiAnswers).toBe(1);
  });

  it('focuses fields without requesting browser scrolling', async () => {
    const doc = loadFixture('generic.html', 'https://careers.example.test/apply');
    doc.querySelector('form')!.innerHTML = '<label for="first">First name</label><input id="first"><label for="race">Race</label><select id="race"><option value="">Select</option><option>Asian</option></select>';
    const focusText = vi.spyOn(doc.querySelector<HTMLInputElement>('#first')!, 'focus');
    const focusSelect = vi.spyOn(doc.querySelector<HTMLSelectElement>('#race')!, 'focus');
    const { d } = deps();
    Object.assign(d.context.profile.eeo, { autofillSaved: true, race: 'Asian' });
    await new FillSession(doc, ADAPTERS.generic, d).run();
    expect(focusText).toHaveBeenCalledWith({ preventScroll: true });
    expect(focusSelect).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('selects a phone country calling code when the profile country is the United States', async () => {
    const doc = loadFixture('generic.html', 'https://careers.example.test/apply');
    doc.querySelector('form')!.id = 'application-form';
    doc.querySelector('form')!.innerHTML = `
      <label for="country">Country</label>
      <div class="select-control"><input id="country" role="combobox" aria-autocomplete="list" aria-expanded="false"></div>
    `;
    const input = doc.querySelector<HTMLInputElement>('#country')!;
    input.addEventListener('mousedown', () => {
      const menu = doc.createElement('div');
      menu.setAttribute('role', 'listbox');
      for (const text of ['+44', '+1']) {
        const option = doc.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = text;
        option.addEventListener('click', () => {
          const selected = doc.createElement('span');
          selected.className = 'select__single-value';
          selected.textContent = text;
          input.parentElement!.appendChild(selected);
          menu.remove();
        });
        menu.appendChild(option);
      }
      input.setAttribute('aria-controls', 'country-options');
      menu.id = 'country-options';
      input.parentElement!.appendChild(menu);
    });

    const { d } = deps();
    const summary = await new FillSession(doc, ADAPTERS.greenhouse, d).run();

    expect(input.parentElement!.textContent).toContain('+1');
    expect(summary.filledCount).toBe(1);
  });

  it('selects matching degree and discipline options', async () => {
    const doc = loadFixture('generic.html', 'https://careers.example.test/apply');
    doc.querySelector('form')!.innerHTML = `
      <label for="degree">Degree</label><div class="select-control"><input id="degree" role="combobox" aria-autocomplete="list"></div>
      <label for="discipline">Discipline</label><div class="select-control"><input id="discipline" role="combobox" aria-autocomplete="list"></div>
    `;
    const dropdowns: [string, string][] = [['degree', "Bachelor's Degree"], ['discipline', 'Computer Science']];
    for (const [id, optionText] of dropdowns) {
      const input = doc.querySelector<HTMLInputElement>(`#${id}`)!;
      input.addEventListener('mousedown', () => {
        const menu = doc.createElement('div');
        const option = doc.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = optionText;
        option.addEventListener('click', () => {
          const selected = doc.createElement('span');
          selected.className = 'select__single-value';
          selected.textContent = optionText;
          input.parentElement!.appendChild(selected);
          menu.remove();
        });
        menu.appendChild(option);
        input.parentElement!.appendChild(menu);
      });
    }

    const { d } = deps();
    const summary = await new FillSession(doc, ADAPTERS.generic, d).run();

    expect(doc.querySelector('#degree')!.parentElement!.textContent).toContain("Bachelor's Degree");
    expect(doc.querySelector('#discipline')!.parentElement!.textContent).toContain('Computer Science');
    expect(summary.filledCount).toBe(2);
  });

  it('selects a matching Google Places suggestion rendered outside the location field', async () => {
    const doc = loadFixture('generic.html', 'https://careers.example.test/apply');
    doc.querySelector('form')!.id = 'application-form';
    doc.querySelector('form')!.innerHTML = `
      <label for="candidate-location">Location (City)</label>
      <div class="field-wrapper"><input id="candidate-location" required></div>
    `;
    const input = doc.querySelector<HTMLInputElement>('#candidate-location')!;
    input.addEventListener('input', () => {
      const menu = doc.createElement('div');
      menu.className = 'pac-container';
      const option = doc.createElement('div');
      option.className = 'pac-item';
      option.textContent = 'San Jose, California, United States';
      option.addEventListener('click', () => {
        input.value = option.textContent ?? '';
        menu.remove();
      });
      menu.appendChild(option);
      doc.body.appendChild(menu);
    });
    const { d } = deps();
    d.context.profile.city = 'San Jose';
    d.context.profile.state = 'CA';

    const summary = await new FillSession(doc, ADAPTERS.greenhouse, d).run();

    expect(input.value).toBe('San Jose, California, United States');
    expect(summary.filledCount).toBe(1);
  });
});

let submits = 0;
const countSubmit = (e: Event) => {
  submits++;
  e.preventDefault();
};

beforeEach(() => {
  Object.assign(timing, { menuOpen: 20, search: 30, selection: 30, settle: 0, typeahead: 30, afterUpload: 0 });
  submits = 0;
  window.addEventListener('submit', countSubmit);
});
afterEach(() => window.removeEventListener('submit', countSubmit));

describe('Greenhouse', () => {
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
    expect(byLabel['How did you hear about this job?']).toBe('howHeard');
    expect(byLabel['Are you legally authorized to work in the United States for our Company?']).toBe('authorized');
    expect(byLabel['Are you currently located in the US?']).toBe('inUS');
    expect(byLabel['Are you currently based in or willing to relocate to the Bay Area for this position?']).toBe('relocate');
    expect(byLabel['Veteran Status']).toBe('manual');
    expect(byLabel['Disability Status']).toBe('manual');
    expect(byLabel['Are you Hispanic/Latino?']).toBe('manual');
    expect(byLabel['I consider myself a member of the LGBTQ+ community. (optional)']).toBe('manual');
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
    expect(doc.getElementById('gender')!.parentElement!.textContent).not.toContain('Female');
    expect(doc.getElementById('veteran_status')!.parentElement!.textContent).not.toContain('I am not a protected veteran');

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
    expect(byLabel['Please tell us how you heard about this opportunity.']).toBe('howHeard');
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
    expect(val('select[name="eeo[gender]"]')).toBe('');
    expect(val('select[name="eeo[race]"]')).toBe('');
    expect(val('select[name="eeo[veteran]"]')).toBe('');

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
    expect((doc.querySelector('input[name="_systemfield_eeoc_gender"][value="Female"]') as HTMLInputElement).checked).toBe(false);
    // Text-message consent is left to the user.
    expect(doc.querySelectorAll('input[name="communicationConsent"]:checked')).toHaveLength(0);

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
