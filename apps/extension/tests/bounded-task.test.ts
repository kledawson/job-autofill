import { afterEach, expect, it, vi } from 'vitest';
import { boundedTask } from '../lib/bounded-task';
afterEach(() => vi.useRealTimers());
it('cancellation releases a stalled dependency and ignores its late result', async () => {
  let resolve!: (v: string) => void;
  const controller = new AbortController();
  const pending = boundedTask(new Promise<string>(r => { resolve = r; }), controller.signal);
  controller.abort(); await expect(pending).rejects.toThrow('cancelled');
  resolve('late');
});
it('times out while queued and still observes a later rejection', async () => {
  vi.useFakeTimers(); let reject!: (e: Error) => void;
  const pending = boundedTask(new Promise<string>((_, r) => { reject = r; }), new AbortController().signal, 50);
  const result = expect(pending).rejects.toThrow('too long');
  await vi.advanceTimersByTimeAsync(50); await result; reject(new Error('late error'));
});
it('returns a completed message and removes its timeout', async () => {
  vi.useFakeTimers(); expect(await boundedTask(Promise.resolve('ready'), new AbortController().signal)).toBe('ready');
  expect(vi.getTimerCount()).toBe(0);
});
