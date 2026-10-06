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
// Overlay: "AI" tags next to generated answers, drawn in a shadow root so the
// page's styles and React tree are never touched. Status shows in the side panel.
// ---------------------------------------------------------------------------

const tags = new Map<HTMLElement, string>();
let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
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
  </style><div id="tags"></div>`;
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
  if (!tags.size && !host) return;
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
}
