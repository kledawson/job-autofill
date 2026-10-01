import { OWN_ATTR } from './scan';

export type ReviewState = 'filled' | 'ai' | 'missing' | 'pending';

const COLORS: Record<ReviewState, string> = {
  filled: '#16a34a',
  ai: '#2563eb',
  missing: '#dc2626',
  pending: '#2563eb',
};

const outlined = new Map<HTMLElement, ReviewState>();

export function outline(el: HTMLElement, state: ReviewState) {
  el.style.setProperty('outline', `2px ${state === 'pending' ? 'dashed' : 'solid'} ${COLORS[state]}`, 'important');
  el.style.setProperty('outline-offset', '2px', 'important');
  el.style.setProperty('border-radius', el.style.borderRadius || '4px');
  el.setAttribute('data-jaf-state', state);
  outlined.set(el, state);
  if (state === 'ai' || state === 'pending') tags.set(el, state === 'ai' ? 'AI' : 'Writing…');
  else tags.delete(el);
  scheduleOverlay();
}

export function clearOutline(el: HTMLElement) {
  el.style.removeProperty('outline');
  el.style.removeProperty('outline-offset');
  el.removeAttribute('data-jaf-state');
  outlined.delete(el);
  tags.delete(el);
  scheduleOverlay();
}

// ---------------------------------------------------------------------------
// Overlay: "AI" tags next to generated answers and a status card, drawn in a
// shadow root so the page's styles and React tree are never touched.
// ---------------------------------------------------------------------------

const tags = new Map<HTMLElement, string>();
let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let status: { title: string; lines: string[]; tone: 'working' | 'done' } | null = null;
let frame = 0;

function ensureHost(): ShadowRoot {
  if (shadow && host?.isConnected) return shadow;
  host = document.createElement('div');
  host.setAttribute(OWN_ATTR, 'overlay');
  host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;';
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    .tag{position:absolute;font:600 11px/1 system-ui,sans-serif;color:#fff;background:#2563eb;border-radius:4px;padding:3px 6px;pointer-events:none;white-space:nowrap;width:max-content;box-shadow:0 1px 2px rgba(0,0,0,.2)}
    .card{position:fixed;right:16px;bottom:16px;max-width:320px;font:13px/1.4 system-ui,sans-serif;color:#111827;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.15);padding:12px 14px}
    .card h4{margin:0 0 6px;font-size:13px;font-weight:600;display:flex;gap:8px;align-items:center}
    .card p{margin:2px 0;color:#374151}
    .dot{width:8px;height:8px;border-radius:50%;display:inline-block}
    .close{margin-left:auto;border:0;background:none;cursor:pointer;color:#6b7280;font-size:16px;line-height:1;pointer-events:auto}
    .legend span{display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:12px;color:#4b5563}
  </style><div id="tags"></div><div id="card"></div>`;
  window.addEventListener('scroll', scheduleOverlay, { passive: true });
  window.addEventListener('resize', scheduleOverlay);
  setInterval(scheduleOverlay, 1000);
  return shadow;
}

function scheduleOverlay() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}

function render() {
  if (!tags.size && !status && !host) return;
  const root = ensureHost();
  const tagLayer = root.getElementById('tags')!;
  tagLayer.textContent = '';
  for (const [el, label] of tags) {
    if (!el.isConnected) {
      tags.delete(el);
      continue;
    }
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = label;
    tag.style.top = `${r.top + window.scrollY - 10}px`;
    tag.style.left = `${r.right + window.scrollX - 34}px`;
    tagLayer.appendChild(tag);
  }

  const card = root.getElementById('card')!;
  card.textContent = '';
  if (!status) return;
  const box = document.createElement('div');
  box.className = 'card';
  const h = document.createElement('h4');
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = status.tone === 'working' ? '#2563eb' : '#16a34a';
  const title = document.createElement('span');
  title.textContent = status.title;
  const close = document.createElement('button');
  close.className = 'close';
  close.textContent = '×';
  close.title = 'Hide';
  close.onclick = () => {
    status = null;
    render();
  };
  h.append(dot, title, close);
  box.appendChild(h);
  for (const line of status.lines) {
    const p = document.createElement('p');
    p.textContent = line;
    box.appendChild(p);
  }
  const legend = document.createElement('p');
  legend.className = 'legend';
  for (const [state, label] of [
    ['filled', 'From profile'],
    ['ai', 'AI-written'],
    ['missing', 'Needs you'],
  ] as const) {
    const s = document.createElement('span');
    const d = document.createElement('span');
    d.className = 'dot';
    d.style.background = COLORS[state];
    s.append(d, label);
    legend.appendChild(s);
  }
  box.appendChild(legend);
  card.appendChild(box);
}

export function showStatus(next: typeof status) {
  status = next;
  scheduleOverlay();
}
