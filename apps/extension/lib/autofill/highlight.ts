import { OWN_ATTR } from './scan';

export type ReviewState = 'filled' | 'ai' | 'review' | 'missing' | 'pending' | 'entered';

const COLORS: Record<ReviewState, string> = {
  filled: '#16a34a',
  ai: '#d97706',
  review: '#d97706',
  missing: '#dc2626',
  pending: '#2563eb',
  entered: '#64748b',
};

export function outline(el: HTMLElement, state: ReviewState) {
  el.style.setProperty('outline', `2px ${state === 'pending' ? 'dashed' : 'solid'} ${COLORS[state]}`, 'important');
  el.style.setProperty('outline-offset', '2px', 'important');
  el.style.setProperty('border-radius', el.style.borderRadius || '4px');
  el.setAttribute('data-jaf-state', state);
  if (state === 'ai' || state === 'review' || state === 'pending') tags.set(el, state === 'ai' ? 'AI' : state === 'review' ? 'Review' : 'Writing…');
  else tags.delete(el);
  scheduleOverlay();
}

export function clearOutline(el: HTMLElement) {
  el.style.removeProperty('outline');
  el.style.removeProperty('outline-offset');
  el.removeAttribute('data-jaf-state');
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
let overlayTimer: ReturnType<typeof setInterval> | undefined;

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
  overlayTimer = setInterval(scheduleOverlay, 1000);
  return shadow;
}

function scheduleOverlay() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}

function releaseOverlay() {
  clearInterval(overlayTimer); overlayTimer = undefined;
  window.removeEventListener('scroll', scheduleOverlay); window.removeEventListener('resize', scheduleOverlay);
  host?.remove(); host = null; shadow = null;
}

function render() {
  if (!tags.size) { releaseOverlay(); return; }
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
    if (label === 'AI' || label === 'Review') tag.style.background = COLORS.ai;
    tag.textContent = label;
    tag.style.top = `${r.top + window.scrollY - 10}px`;
    tag.style.left = `${r.right + window.scrollX - 34}px`;
    tagLayer.appendChild(tag);
  }
  if (!tags.size) releaseOverlay();
}

/** Only an explicit Show field action scrolls. Animation leaves the review outline intact. */
export function revealField(target: HTMLElement, control: HTMLElement) {
  const reduced = target.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  control.focus({ preventScroll: true });
  // Focus handlers can rerender a widget or cancel smooth scrolling. Scroll last, in one
  // immediate operation, including nested scroll containers and enclosing frames.
  const visibleTarget = target.getClientRects().length ? target : control;
  visibleTarget.scrollIntoView?.({ behavior: 'instant', block: 'center', inline: 'nearest' });
  if (!reduced) target.animate?.([{ boxShadow: '0 0 0 0 transparent' }, { boxShadow: '0 0 0 7px #a5b4fc' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1400 });
}
