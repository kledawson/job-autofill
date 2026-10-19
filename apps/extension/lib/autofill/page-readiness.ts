import type { Adapter } from './adapters';
import { formReady } from './engine';
import { authenticationStep } from './scan';

export type PageReadiness = 'form' | 'login' | 'account' | 'verification' | 'loading';
/** DOM metadata only. Never reads authentication values or clicks an authentication control. */
export function pageReadiness(doc: Document, adapter: Adapter): PageReadiness {
  const root = adapter.formRoot(doc);
  const auth = authenticationStep(root);
  if (auth) return auth;
  if (formReady(doc, adapter)) return 'form';
  return authenticationStep(doc.body) ?? 'loading';
}

/** Aborting removes the pending timer immediately, including when a queue is stopped. */
export function readinessDelay(signal: AbortSignal, ms = 750): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('Autofill cancelled.')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
