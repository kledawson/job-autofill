import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADAPTERS } from '../lib/autofill/adapters';
import { classifyField } from '../lib/autofill/classify';
import { FillSession, type EngineDeps } from '../lib/autofill/engine';
import { timing } from '../lib/autofill/fill';
import { scanFields } from '../lib/autofill/scan';
import type { AnswerRequest } from '../lib/messages';
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
  Object.assign(timing, { menuOpen: 20, search: 30, typeahead: 30, afterUpload: 0, settle: 0 });
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
    expect(byLabel['How did you hear about this job?']).toBe('unknown');
    expect(byLabel['Are you legally authorized to work in the United States for our Company?']).toBe('authorized');
    expect(byLabel['Are you currently located in the US?']).toBe('inUS');
    expect(byLabel['Are you currently based in or willing to relocate to the Bay Area for this position?']).toBe('relocate');
    expect(byLabel['Veteran Status']).toBe('veteran');
    expect(byLabel['Disability Status']).toBe('disability');
    expect(byLabel['Are you Hispanic/Latino?']).toBe('hispanic');
    expect(byLabel['I consider myself a member of the LGBTQ+ community. (optional)']).toBe('declineOnly');
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
