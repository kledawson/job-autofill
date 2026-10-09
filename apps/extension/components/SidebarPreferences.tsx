import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { readSidebarVisibility, SIDEBAR_CATEGORIES, SIDEBAR_ORDER, SIDEBAR_VISIBILITY_KEY, type SidebarId, type SidebarVisibility } from '@/lib/sidebar-layout';
import { Card } from './ui';

export function useSidebarVisibility() {
  const [visibility, setVisibility] = useState(() => readSidebarVisibility(undefined));
  useEffect(() => {
    let mounted = true, revision = 0;
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && SIDEBAR_VISIBILITY_KEY in changes) { revision++; setVisibility(readSidebarVisibility(changes[SIDEBAR_VISIBILITY_KEY]!.newValue)); }
    };
    browser.storage.onChanged.addListener(changed);
    void browser.storage.local.get(SIDEBAR_VISIBILITY_KEY).then(data => {
      if (mounted && !revision) setVisibility(readSidebarVisibility(data[SIDEBAR_VISIBILITY_KEY]));
    }).catch(() => undefined);
    return () => { mounted = false; browser.storage.onChanged.removeListener(changed); };
  }, []);
  return visibility;
}

export function SidebarPreferences() {
  const visibility = useSidebarVisibility();
  const [displayed, setDisplayed] = useState(visibility);
  const pending = useRef(0);
  useEffect(() => { if (!pending.current) setDisplayed(visibility); }, [visibility]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  function change(id: SidebarId, checked: boolean) {
    if (id === 'fill') return;
    pending.current++;
    setDisplayed(current => ({ ...current, [id]: checked }));
    setBusy(true); setMessage('Saving…'); setError('');
    // Read and merge inside each queued write so rapid changes never drop another checkbox.
    writes.current = writes.current.catch(() => undefined).then(async () => {
      const stored = await browser.storage.local.get(SIDEBAR_VISIBILITY_KEY);
      const next: SidebarVisibility = { ...readSidebarVisibility(stored[SIDEBAR_VISIBILITY_KEY]), [id]: checked };
      await browser.storage.local.set({ [SIDEBAR_VISIBILITY_KEY]: { version: 1, categories: next } });
      setDisplayed(next);
      setMessage(SIDEBAR_CATEGORIES[id].title + (checked ? ' shown in the sidebar.' : ' hidden from the sidebar.'));
    }).catch(async () => {
      // Roll back a failed optimistic click to the persisted choices.
      const stored = await browser.storage.local.get(SIDEBAR_VISIBILITY_KEY).catch(() => undefined);
      setDisplayed(stored ? readSidebarVisibility(stored[SIDEBAR_VISIBILITY_KEY]) : visibility);
      setMessage(''); setError('Could not save this choice. Please try again.');
    }).finally(() => { pending.current--; setBusy(pending.current > 0); });
  }
  return <Card title="Sidebar" description="Choose the categories you want to see. Changes save automatically and update open sidebars.">
    <div className="divide-y divide-slate-100">{SIDEBAR_ORDER.map(id => <label key={id} className="flex cursor-pointer items-start gap-3 py-3">
      <input type="checkbox" className="mt-1 size-4 accent-indigo-600" checked={displayed[id]} disabled={id === 'fill' || busy} onChange={event => change(id, event.target.checked)} />
      <span><span className="block font-medium text-slate-900">{SIDEBAR_CATEGORIES[id].title}</span><span className="mt-0.5 block text-sm text-slate-500">{SIDEBAR_CATEGORIES[id].description}</span></span>
    </label>)}</div>
    <p className="mt-3 text-sm text-slate-500">Hide categories you do not use. Hiding a category keeps its data and drafts; a running queue continues. Drag the dotted handles in the sidebar to change the order.</p>
    <p role="status" className="mt-3 text-sm text-green-700">{message || 'Your choices are saved on this browser.'}</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </Card>;
}
