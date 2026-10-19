import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { useSidebarVisibility } from './SidebarPreferences';
import { isSidebarId, readSidebarOrder, SIDEBAR_ORDER, SIDEBAR_ORDER_KEY, type SidebarId } from '@/lib/sidebar-layout';

type Dragged = { id: SidebarId; title: string };
type Target = { id: SidebarId; after: boolean };
const LayoutContext = createContext<{
  order: SidebarId[]; dragging: Dragged | null; target: Target | null;
  drag(value: Dragged | null): void; aim(value: Target | null): void; drop(): void;
  move(id: SidebarId, direction: number, title: string): void;
} | null>(null);
export const useSidebarLayout = () => useContext(LayoutContext);

export function SidebarLayout({ children }: { children: ReactNode }) {
  const visibility = useSidebarVisibility();
  const [order, setOrder] = useState<SidebarId[]>([...SIDEBAR_ORDER]);
  const [dragging, setDragging] = useState<Dragged | null>(null), [target, setTarget] = useState<Target | null>(null);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const touched = useRef(false), current = useRef(order);
  useEffect(() => {
    let mounted = true;
    const apply = (value: unknown) => { const next = readSidebarOrder(value); current.current = next; setOrder(next); };
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && SIDEBAR_ORDER_KEY in changes) { touched.current = true; apply(changes[SIDEBAR_ORDER_KEY]!.newValue); }
    };
    browser.storage.onChanged.addListener(changed);
    void browser.storage.local.get(SIDEBAR_ORDER_KEY).then(data => {
      if (mounted && !touched.current) apply(data[SIDEBAR_ORDER_KEY]);
    }).catch(() => undefined);
    return () => { mounted = false; browser.storage.onChanged.removeListener(changed); };
  }, []);
  function save(next: SidebarId[], note: string) {
    touched.current = true; current.current = next; setOrder(next); setError(''); setMessage(note);
    void browser.storage.local.set({ [SIDEBAR_ORDER_KEY]: { version: 1, order: next } }).catch(() => {
      setError('Could not save the section order. Try moving it again.');
    });
  }
  function move(id: SidebarId, direction: number, title: string) {
    const shown = current.current.filter(section => section !== 'fill' && visibility[section]), index = shown.indexOf(id), destination = index + direction;
    if (index < 0 || destination < 0 || destination >= shown.length) return;
    const next = current.current.filter(section => section !== id), neighbor = shown[destination]!;
    const insert = next.indexOf(neighbor) + (direction > 0 ? 1 : 0);
    next.splice(insert, 0, id);
    save(next, title + ' moved to position ' + (destination + 1) + ' of ' + shown.length + '.');
    requestAnimationFrame(() => { document.getElementById('sidebar-' + id + '-move')?.focus({ preventScroll: true }); });
  }
  function drop() {
    if (dragging && target && dragging.id !== target.id) {
      const next = current.current.filter(id => id !== dragging.id);
      const index = next.indexOf(target.id) + (target.after ? 1 : 0);
      next.splice(index, 0, dragging.id);
      const shown = next.filter(id => visibility[id]);
      save(next, dragging.title + ' moved to position ' + (shown.indexOf(dragging.id) + 1) + ' of ' + shown.length + '.');
    }
    setDragging(null); setTarget(null);
  }
  const sections = new Map(Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ id?: string; hidden?: boolean }>(child) || !child.props.id || !isSidebarId(child.props.id)) return [];
    return [[child.props.id, cloneElement(child, { key: child.props.id, hidden: !visibility[child.props.id] })] as const];
  }));
  return <LayoutContext.Provider value={{ order: order.filter(id => id !== 'fill' && visibility[id]), dragging, target, drag: value => { setDragging(value); if (!value) setTarget(null); }, aim: setTarget, drop, move }}>
    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
      <p id="sidebar-arrange-help">Drag the dotted handles to reorder.</p>
      <button type="button" className="shrink-0 text-indigo-700 underline" onClick={() => save([...SIDEBAR_ORDER], 'Default section order restored. Applications is last.')}>Reset order</button>
    </div>
    <div className="flex flex-col gap-2">{order.map(id => sections.get(id))}</div>
    <p role="status" className="sr-only">{message}</p>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </LayoutContext.Provider>;
}
