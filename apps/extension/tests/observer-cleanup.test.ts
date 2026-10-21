import { afterEach, expect, it, vi } from 'vitest';
import { FillSession } from '../lib/autofill/engine';
import { ADAPTERS } from '../lib/autofill/adapters';
import { sampleProfile } from './helpers';
import { clearOutline, outline } from '../lib/autofill/highlight';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

it('replaces review observers and removes pending edit work on disconnect', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<form id="application-form"><label>Fictional reference<input id="reference"></label></form>';
  const progress = vi.fn();
  const session = new FillSession(document, ADAPTERS.greenhouse, {
    context: { profile: sampleProfile(), resume: null, coverLetter: null, transcript: null, hasGeminiKey: false },
    answer: async () => ({ ok: false, error: 'No AI in this fixture.' }), jobDescription: async () => '', onProgress: progress,
  });
  try {
    session.observe(false); session.observe(false);
    document.querySelector('input')!.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1250);
    expect(progress).toHaveBeenCalledTimes(1);
    document.querySelector('input')!.dispatchEvent(new Event('input', { bubbles: true }));
    session.disconnect(); session.disconnect();
    document.querySelector('form')!.insertAdjacentHTML('beforeend', '<label>Another reference<input></label>');
    await vi.advanceTimersByTimeAsync(2000);
    expect(progress).toHaveBeenCalledTimes(1);
  } finally { session.disconnect(); }
});

it('removes the overlay and its periodic work once no labels remain', async () => {
  vi.useFakeTimers(); document.body.innerHTML = '<input id="pending">';
  const input = document.querySelector<HTMLInputElement>('input')!;
  outline(input, 'pending'); await vi.advanceTimersByTimeAsync(50);
  expect(document.querySelector('[data-jaf="overlay"]')).not.toBeNull();
  clearOutline(input); await vi.advanceTimersByTimeAsync(50);
  expect(document.querySelector('[data-jaf="overlay"]')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
