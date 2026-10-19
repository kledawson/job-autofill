import type { Adapter } from './adapters';
import { scanFields } from './scan';
import { sleep } from './fill';

/** Wait for a stable field structure, not network-idle (analytics may never go idle).
 * Only metadata is compared. Background tabs need no animation frames or focus.
 */
export async function waitForFieldReadiness(doc: Document, adapter: Adapter, signal: AbortSignal,
  { minimumMs = 1200, quietMs = 600, maximumMs = 8000, pollMs = 150 } = {}) {
  const start = Date.now();
  let changedAt = start, previous = '';
  while (!signal.aborted && Date.now() - start < maximumMs) {
    const root = adapter.formRoot(doc);
    const signature = JSON.stringify(scanFields(root).map(f => [f.kind, f.label, f.path, f.options,
      f.el.hasAttribute('disabled'), f.el.getAttribute('aria-disabled')]));
    if (signature !== previous) { previous = signature; changedAt = Date.now(); }
    if (doc.readyState !== 'loading' && !root.querySelector('[aria-busy="true"]') &&
      Date.now() - start >= minimumMs && Date.now() - changedAt >= quietMs) return;
    await sleep(pollMs);
  }
  if (signal.aborted) throw new Error('Autofill cancelled.');
}
