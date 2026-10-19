import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCapture, parseMappingDraft, parseSelections, parseStoredMapping, SavedAnswerIndex, type MappingDraft, type RememberedMapping } from '../lib/remembered-mappings';
import { resolveRememberedSelections, sameSelections } from '../lib/selection-matching';
import { fillRememberedSelections, selectedValues, selectionMode, reacquireSelectionField } from '../lib/autofill/selections';
import { scanFields } from '../lib/autofill/scan';
import { timing } from '../lib/autofill/fill';
import { FillSession, type EngineDeps } from '../lib/autofill/engine';
import { ADAPTERS } from '../lib/autofill/adapters';
import { sampleProfile } from './helpers';
import { previewSavedAnswer } from '../lib/saved-answer-preview';

const list = (values: string[]) => values.map(value => ({ value, aliases: [] }));
const draft: MappingDraft = { question: 'Tools used professionally', aliases: [], scope: 'all', target: { kind: 'answers', selections: [{ value: 'TypeScript', aliases: ['TS'] }, { value: 'Python', aliases: [] }] } };
const record: RememberedMapping = { ...draft, id: 72, schemaVersion: 3, updatedAt: 1 };
const context = { platform: 'greenhouse' as const, company: 'Example', url: 'https://example.com/apply' };

describe('saved selection contracts and pure resolution', () => {
  it('validates lists without changing legacy scalar answers', () => {
    expect(parseMappingDraft(draft)).toEqual(draft);
    expect(parseStoredMapping(record)).toEqual(record);
    expect(parseStoredMapping({ ...record, schemaVersion: 2 })).toBeNull();
    const legacy = { ...record, schemaVersion: 2, target: { kind: 'answer', value: 'Python, SQL' } };
    expect(parseStoredMapping(legacy)?.target).toEqual(legacy.target);
  });
  it.each([[], list(Array.from({ length: 21 }, (_, i) => `Choice ${i}`)), list(['Python', ' python ']), [{ value: 'Python', aliases: ['Python'] }], [{ value: 'Python', aliases: ['TS'] }, { value: 'TypeScript', aliases: ['ts'] }], list(['None of the above', 'Python']), [{ value: '', aliases: [] }]].map(values => ({ values })))('rejects malformed or contradictory selection list $values', ({ values }) => {
    expect(() => parseSelections(values)).toThrow();
  });
  it('matches reordered choices and individual approved labels', () => {
    expect(resolveRememberedSelections(draft.target.kind === 'answers' ? draft.target.selections : [], ['SQL', 'Python', 'TS'])).toMatchObject({ ok: true, indices: [2, 1], labels: ['TS', 'Python'] });
    expect(sameSelections(['TS', 'Python'], [' python ', 'ts'])).toBe(true);
  });
  it.each([[['Python']], [['Python', 'TS', 'TS']], [['Python', 'JavaScript']]])('requires every unambiguous option for %j', options => {
    expect(resolveRememberedSelections(draft.target.kind === 'answers' ? draft.target.selections : [], options).ok).toBe(false);
  });
  it('rejects disabled choices and collisions between saved selections', () => {
    expect(resolveRememberedSelections(list(['Python']), ['Python'], [0]).ok).toBe(false);
    expect(resolveRememberedSelections([{ value: 'One', aliases: ['Same'] }, { value: 'Two', aliases: ['Same'] }], ['Same']).ok).toBe(false);
    expect(() => parseSelections(list(['Never held a clearance', 'Secret']))).toThrow('exclusive');
  });
  it('does not bypass an incompatible narrow scope with a wider record', () => {
    const scoped = { ...record, id: 73, scope: 'company:example' as const };
    const broad = { ...record, target: { kind: 'answer' as const, value: 'Python' } };
    expect(new SavedAnswerIndex([scoped, broad], context).match({ label: draft.question, kind: 'select', selectionMode: 'single', options: ['Python', 'TypeScript'] }).mapping).toBeNull();
  });
  it('previews the same set resolver and requires a multi-select example', () => {
    expect(previewSavedAnswer(draft, draft.question, ['Python', 'TS'], context, undefined, [], undefined, true)).toMatchObject({ outcome: 'fill', answers: ['TS', 'Python'] });
    expect(previewSavedAnswer(draft, draft.question, ['Python', 'TS'], context, undefined, []).outcome).toBe('skip');
  });
  it('validates captured list payloads rather than trusting runtime message types', () => {
    const capture = { token: 'token-1', captureId: 'capture-1', label: draft.question, kind: 'select', options: ['Python'], selectionMode: 'multiple', value: '', values: ['Python'] };
    expect(parseCapture(capture).values).toEqual(['Python']);
    expect(() => parseCapture({ ...capture, values: ['Python', 'Python'] })).toThrow();
    expect(() => parseCapture({ ...capture, selectionMode: 'single' })).toThrow();
  });
});

function setup(html: string, records: RememberedMapping[] = []) {
  document.body.innerHTML = `<form id="application-form">${html}</form>`;
  const deps: EngineDeps = { context: { profile: sampleProfile(), resume: null, coverLetter: null, transcript: null, hasGeminiKey: false },
    answer: vi.fn(), jobDescription: vi.fn(async () => ''), matchSavedAnswers: async fields => fields.map(field => new SavedAnswerIndex(records, context).match(field)) };
  return new FillSession(document, ADAPTERS.greenhouse, deps);
}
const native = `<label for="tools">Tools used professionally*</label><select id="tools" multiple required><option>Python</option><option>SQL</option><option>TS</option></select>`;
const group = `<fieldset><legend>Tools used professionally*</legend><label><input type="checkbox" name="tools" value="Python" required>Python</label><label><input type="checkbox" name="tools" value="TS">TS</label><label><input type="checkbox" name="tools" value="SQL">SQL</label></fieldset>`;
beforeEach(() => Object.assign(timing, { menuOpen: 10, search: 10, settle: 0, afterUpload: 0 }));

describe('multi-select capture, verified writes and batch snapshots', () => {
  it('fills a remembered set before an earlier free-response question invokes AI', async () => {
    document.body.innerHTML = `<form id="application-form"><label for="essay">Why are you interested in this role?*</label><textarea id="essay" required></textarea>${native}</form>`;
    const answer = vi.fn(async () => {
      expect(selectedValues(scanFields(document).find(f => f.kind === 'select')!).sort()).toEqual(['Python', 'TS']);
      return { ok: true as const, answer: 'Synthetic response', source: 'ai' as const };
    });
    const session = new FillSession(document, ADAPTERS.greenhouse, {
      context: { profile: sampleProfile(), resume: null, coverLetter: null, transcript: null, hasGeminiKey: true },
      answer, jobDescription: async () => '', matchSavedAnswers: async fields => fields.map(f => new SavedAnswerIndex([record], context).match(f)),
    });
    expect((await session.run()).filledCount).toBe(1);
    expect(answer).toHaveBeenCalledOnce();
    expect((document.getElementById('essay') as HTMLTextAreaElement).value).toBe('Synthetic response');
  });
  it.each([native, group])('fills and verifies all choices, and preserves repeated manual edits', async html => {
    const session = setup(html, [record]);
    const summary = await session.run();
    expect(summary.filledCount, JSON.stringify(summary)).toBe(1);
    const field = scanFields(document)[0]!;
    expect(selectedValues(field).sort()).toEqual(['Python', 'TS']);
    if (field.kind === 'select') { (field.el as HTMLSelectElement).options[1]!.selected = true; }
    else (field.members[2] as HTMLInputElement).checked = true;
    const again = new FillSession(document, ADAPTERS.greenhouse, { context: { profile: sampleProfile(), resume: null, coverLetter: null, transcript: null, hasGeminiKey: false }, answer: vi.fn(), jobDescription: vi.fn(), matchSavedAnswers: async fields => fields.map(f => new SavedAnswerIndex([record], context).match(f)) });
    await again.run();
    expect(selectedValues(scanFields(document)[0]!).sort()).toEqual(['Python', 'SQL', 'TS']);
    // A later manual change is preserved and identified as the user's answer;
    // it is different from a writer that failed to commit the requested set.
    expect(session.verify().missingLabels).not.toContain(draft.question);
    expect(session.verify().fieldFeedback?.find(f => f.label === draft.question)).toMatchObject({ status: 'entered', source: 'page' });
  });
  it('does not select a subset when a native option is unavailable', async () => {
    const session = setup(native.replace('<option>TS</option>', ''), [record]);
    const summary = await session.run();
    expect(selectedValues(scanFields(document)[0]!)).toEqual([]);
    expect(summary.filledCount).toBe(0);
    expect(summary.reviewFields?.[0]?.reason).toMatch(/unavailable/);
    (document.querySelector('select') as HTMLSelectElement).options[0]!.selected = true;
    const review = summary.reviewFields![0]!;
    const capture = session.captureAnswer(review.token, review.label);
    session.finishRemembering([capture]);
    expect(session.verify().reviewFields).toEqual([]);
    expect(session.verify().missingLabels).toEqual([]);
    expect(session.verify().usedMappingIds).toEqual([]);
  });
  it('captures multiple answers and rejects changed checkbox member identities', async () => {
    const session = setup(group);
    const review = (await session.run()).reviewFields![0]!;
    document.querySelectorAll<HTMLInputElement>('input').forEach((input, i) => input.checked = i < 2);
    const capture = session.captureAnswer(review.token, review.label);
    expect(capture.values).toEqual(['Python', 'TS']);
    document.querySelectorAll('input')[1]!.replaceWith(document.querySelectorAll('input')[1]!.cloneNode(true));
    expect(() => session.validateCaptures([{ token: review.token, captureId: capture.captureId }])).toThrow('changed');
  });
  it('captures only requested review questions and keeps batch snapshots valid together', async () => {
    const session = setup(`${native}<label for="custom">Custom project code*</label><input id="custom" required><label for="empty">Untouched question*</label><input id="empty" required><label for="name">First Name</label><input id="name">`);
    const reviews = (await session.run()).reviewFields!;
    (document.querySelector('select') as HTMLSelectElement).options[0]!.selected = true;
    (document.getElementById('custom') as HTMLInputElement).value = 'Example answer';
    const batch = session.captureAnswers(reviews.map(({ token, label }) => ({ token, label })));
    expect(batch.captures.map(c => c.label)).toEqual([draft.question, 'Custom project code']);
    expect(batch.skipped).toHaveLength(1);
    const entries = batch.captures.map(({ token, captureId }) => ({ token, captureId }));
    expect(() => session.validateCaptures(entries)).not.toThrow();
    session.finishRemembering(entries);
    expect(session.verify().reviewFields?.map(f => f.label)).toEqual(['Untouched question']);
  });
  it('rejects stale batch captures before marking any question remembered', async () => {
    const session = setup(`${native}<label for="code">Custom project code*</label><input id="code" required>`);
    const reviews = (await session.run()).reviewFields!;
    (document.querySelector('select') as HTMLSelectElement).options[0]!.selected = true;
    (document.getElementById('code') as HTMLInputElement).value = 'First';
    const batch = session.captureAnswers(reviews);
    (document.getElementById('code') as HTMLInputElement).value = 'Changed';
    expect(() => session.validateCaptures(batch.captures)).toThrow('changed');
    expect(session.verify().reviewFields).toHaveLength(2);
  });
  it('excludes ambiguous checkbox groups and bundled consent', async () => {
    const ambiguous = setup('<label><input type="checkbox" name="same">First question</label><label><input type="checkbox" name="same">Second question</label>');
    await ambiguous.run();
    expect(selectionMode(scanFields(document)[0]!)).toBe('unknown');
    const consent = setup(group.replace('Tools used professionally', 'I agree to privacy terms'));
    expect((await consent.run()).reviewFields).toEqual([]);
  });
  it('marks partial native writes incomplete and blocks event-triggered submission', async () => {
    const session = setup(native, [record]);
    let submits = 0;
    document.querySelector('form')!.addEventListener('submit', () => submits++);
    document.querySelector('select')!.addEventListener('change', () => {
      (document.querySelector('select') as HTMLSelectElement).options[2]!.selected = false;
      document.querySelector('form')!.requestSubmit();
    });
    const summary = await session.run();
    expect(summary.filledCount).toBe(0);
    expect(summary.missingLabels).toContain(draft.question);
    expect(submits).toBe(0);
    expect(summary.usedMappingIds).toEqual([]);
  });
});

function reactChoices(options = ['Python', 'TS'], rejectSecond = false, rerender = false) {
  document.body.innerHTML = `<form><label for="tools">Tools used professionally*</label><div class="select__container"><div class="select__control"><div class="select__multi-value-container"></div><input id="tools" role="combobox" aria-controls="tool-options" aria-expanded="false" aria-multiselectable="true" required></div></div></form>`;
  const control = document.querySelector('.select__control')!;
  const open = () => {
    if (document.getElementById('tool-options')) return;
    const menu = document.createElement('div'); menu.id = 'tool-options'; menu.setAttribute('role', 'listbox');
    for (const value of options) {
      const option = document.createElement('div'); option.setAttribute('role', 'option'); option.textContent = value;
      option.onclick = () => {
        if (!(rejectSecond && value === 'TS')) control.querySelector('.select__multi-value-container')!.insertAdjacentHTML('beforeend', `<div class="select__multi-value"><span class="select__multi-value__label">${value}</span><span class="select__multi-value__remove" role="button">×</span></div>`);
        menu.remove();
        let input = document.getElementById('tools')!;
        if (rerender) { const next = input.cloneNode(true) as HTMLElement; input.replaceWith(next); input = next; bind(next); }
        input.setAttribute('aria-expanded', 'false');
      };
      menu.append(option);
    }
    document.body.append(menu); document.getElementById('tools')!.setAttribute('aria-expanded', 'true');
  };
  const bind = (input: HTMLElement) => input.addEventListener('mousedown', open);
  bind(document.getElementById('tools')!);
  const initial = scanFields(document)[0]!;
  return () => reacquireSelectionField(document, initial);
}

describe('scoped React multi-select writes', () => {
  it('commits every label across input rerenders without collapsing nested chips', async () => {
    const get = reactChoices(undefined, false, true);
    const result = await fillRememberedSelections(get, [{ value: 'Python', aliases: [] }, { value: 'TypeScript', aliases: ['TS'] }]);
    expect(result).toMatchObject({ outcome: 'filled', labels: ['Python', 'TS'] });
    expect(selectedValues(get()!)).toEqual(['Python', 'TS']);
  });
  it('preflights every choice and ignores an unrelated menu elsewhere on the page', async () => {
    const get = reactChoices(['Python']);
    document.body.insertAdjacentHTML('beforeend', '<div role="listbox"><div role="option">TS</div></div>');
    expect((await fillRememberedSelections(get, list(['Python', 'TS']), 300)).outcome).toBe('nomatch');
    expect(selectedValues(get()!)).toEqual([]);
    expect((get()!.el as HTMLInputElement).value).toBe('');
  });
  it('reports incomplete writes when a widget rejects a later chip', async () => {
    const get = reactChoices(undefined, true);
    expect((await fillRememberedSelections(get, list(['Python', 'TS']), 500)).outcome).toBe('failed');
    expect(selectedValues(get()!)).toEqual(['Python']);
  });
  it('preserves existing chips instead of adding a saved set to manual answers', async () => {
    const get = reactChoices();
    document.querySelector('.select__multi-value-container')!.insertAdjacentHTML('beforeend', '<div class="select__multi-value">SQL</div>');
    expect((await fillRememberedSelections(get, list(['Python', 'TS']))).outcome).toBe('already');
    expect(selectedValues(get()!)).toEqual(['SQL']);
  });
});
