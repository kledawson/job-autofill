import { useEffect, useRef, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { useSidebarLayout } from './SidebarLayout';
import { isSidebarId } from '@/lib/sidebar-layout';

/** Keep children mounted so collapsing does not discard a draft or stop live queue updates. */
export function SidebarSection({ id, title, summary, defaultOpen = false, hidden = false, children }: {
  id: string; title: string; summary?: string; defaultOpen?: boolean; hidden?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen), [error, setError] = useState('');
  const touched = useRef(false);
  const layout = useSidebarLayout();
  const [arranging, setArranging] = useState(false);
  const sortable = layout && isSidebarId(id) ? { layout, id } : null;
  const position = sortable ? sortable.layout.order.indexOf(sortable.id) : -1;
  const key = 'sidebarSection:' + id;
  useEffect(() => {
    let mounted = true;
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && typeof changes[key]?.newValue === 'boolean') setOpen(changes[key]!.newValue as boolean);
    };
    browser.storage.onChanged.addListener(changed);
    void browser.storage.local.get(key).then(saved => {
      if (mounted && !touched.current && typeof saved[key] === 'boolean') setOpen(saved[key]);
    }).catch(() => undefined);
    return () => { mounted = false; browser.storage.onChanged.removeListener(changed); };
  }, [key]);
  return <section hidden={hidden} id={'sidebar-' + id} className={'scroll-mt-40 overflow-hidden rounded-xl border bg-white shadow-sm ' +
    (layout?.target?.id === id ? layout.target.after ? 'border-slate-200 border-b-4 border-b-indigo-500' : 'border-slate-200 border-t-4 border-t-indigo-500' : 'border-slate-200') +
    (layout?.dragging?.id === id ? ' opacity-60' : '')}
    onDragOver={event => {
      if (!sortable?.layout.dragging) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move';
      const header = document.getElementById('sidebar-' + id + '-toggle')!.getBoundingClientRect();
      sortable.layout.aim({ id: sortable.id, after: event.clientY > header.top + header.height / 2 });
    }} onDrop={event => { if (sortable?.layout.dragging) { event.preventDefault(); sortable.layout.drop(); } }}>
    <div className="flex items-center">
    {sortable && <button id={'sidebar-' + id + '-move'} type="button" draggable
      className="ml-1.5 shrink-0 cursor-grab rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 active:cursor-grabbing"
      aria-label={'Arrange ' + title} aria-describedby="sidebar-arrange-help" aria-expanded={arranging} aria-controls={'sidebar-' + id + '-arrange'}
      title="Drag to reorder, or click for move buttons. Use Up/Down arrows on the keyboard."
      onClick={() => setArranging(value => !value)}
      onKeyDown={event => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault(); sortable.layout.move(sortable.id, event.key === 'ArrowUp' ? -1 : 1, title);
        } else if (event.key === 'Escape') { setArranging(false); sortable.layout.drag(null); }
      }} onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); setArranging(false); sortable.layout.drag({ id: sortable.id, title }); }}
      onDragEnd={() => sortable.layout.drag(null)}>
      <svg aria-hidden="true" width="10" height="16" viewBox="0 0 10 16" fill="currentColor">{[3,8,13].flatMap(y => [2,7].map(x => <circle key={x + ':' + y} cx={x} cy={y} r="1.3" />))}</svg>
    </button>}
    <h2 className="min-w-0 flex-1"><button id={'sidebar-' + id + '-toggle'} type="button" className="flex w-full items-center gap-2 px-2 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
      aria-label={'Toggle ' + title} aria-expanded={open} aria-controls={'sidebar-' + id + '-body'} onClick={() => {
        touched.current = true; const next = !open; setOpen(next); setError('');
        void browser.storage.local.set({ [key]: next }).catch(() => setError('Could not remember this layout. Try again.'));
      }}>
      <span aria-hidden className="text-xs text-slate-400">{open ? '▾' : '▸'}</span>
      <span className="font-semibold text-slate-900">{title}</span>
      {summary && <span className="ml-auto truncate text-xs font-normal text-slate-500" title={summary}>{summary}</span>}
    </button></h2>
    </div>
    {sortable && arranging && <div id={'sidebar-' + id + '-arrange'} className="flex flex-wrap gap-2 border-t border-slate-100 px-3 py-2 text-xs" aria-label={'Arrange ' + title}>
      <button type="button" disabled={position === 0} className="rounded border border-slate-200 px-2 py-1 text-slate-700 disabled:text-slate-400" onClick={() => sortable.layout.move(sortable.id, -1, title)}>↑ Move up</button>
      <button type="button" disabled={position === sortable.layout.order.length - 1} className="rounded border border-slate-200 px-2 py-1 text-slate-700 disabled:text-slate-400" onClick={() => sortable.layout.move(sortable.id, 1, title)}>↓ Move down</button>
      <button type="button" className="ml-auto text-indigo-700 underline" onClick={() => { setArranging(false); document.getElementById('sidebar-' + id + '-move')?.focus(); }}>Done</button>
    </div>}
    <div id={'sidebar-' + id + '-body'} hidden={!open} className="space-y-2 border-t border-slate-100 p-3">{children}</div>
    {error && <p role="alert" className="px-3 pb-2 text-xs text-red-700">{error}</p>}
  </section>;
}
