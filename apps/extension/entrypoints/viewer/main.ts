import 'pdfjs-dist/web/pdf_viewer.css';
import type { PDFPageProxy } from 'pdfjs-dist';
import { db } from '@/lib/db';
import type { StoredFile } from '@/lib/types';

// Shows a saved document with its own file name. Chrome's built-in PDF viewer would show the temporary
// address of a stored file instead, so pages are drawn here with pdf.js (already used to read resumes).

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const MAX_WIDTH = 900;

interface PageView {
  page: PDFPageProxy;
  wrap: HTMLDivElement;
  canvas: HTMLCanvasElement;
  layer: HTMLDivElement;
  task?: { cancel(): void; promise: Promise<unknown> };
  strs: string[];
  divs: HTMLElement[];
}

function el<T extends HTMLElement = HTMLElement>(tag: string, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): T {
  const node = document.createElement(tag) as T;
  Object.assign(node, props);
  node.append(...kids);
  return node;
}

function button(label: string, text: string, onClick: () => void) {
  const b = el<HTMLButtonElement>('button', { type: 'button', textContent: text });
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('click', onClick);
  return b;
}

async function show() {
  const kind = new URLSearchParams(location.search).get('kind') as StoredFile['kind'] | null;
  const file = kind ? await db.files.get(kind) : undefined;
  if (!file) {
    document.title = 'Document not found';
    document.body.innerHTML = '<p>This document is no longer saved. Upload it again in Job Autofill settings.</p>';
    return;
  }
  document.title = file.name;

  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;

  // --- Toolbar -------------------------------------------------------------------------------
  const search = el<HTMLInputElement>('input', { type: 'search', placeholder: 'Search this document' });
  search.setAttribute('aria-label', 'Search this document');
  const found = el('output', { textContent: '' });
  found.setAttribute('aria-live', 'polite');
  const prev = button('Previous match', '↑', () => step(-1));
  const next = button('Next match', '↓', () => step(1));
  const zoomOut = button('Zoom out', '−', () => zoomBy(-1));
  const zoomIn = button('Zoom in', '+', () => zoomBy(1));
  const zoomLabel = el('output', { textContent: '100%' });
  const fit = button('Fit to width', 'Fit', () => void setZoom(1));
  const print = button('Print', 'Print', () => void printDoc());
  const download = el<HTMLAnchorElement>('a', { className: 'download', textContent: 'Download', download: file.name });
  download.href = URL.createObjectURL(new Blob([file.blob], { type: 'application/pdf' }));
  const group = (...kids: Node[]) => el('div', { className: 'group' }, ...kids);
  const header = el(
    'header',
    {},
    el('h1', { textContent: file.name }),
    group(search, prev, next, found),
    group(zoomOut, zoomLabel, zoomIn, fit),
    group(print, download),
  );
  const pages = el('main');
  document.body.append(header, pages);

  // --- Pages ---------------------------------------------------------------------------------
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.blob.arrayBuffer()) }).promise;
  } catch (err) {
    pages.innerHTML = '<p>This PDF could not be displayed. Use Download to open it in another app.</p>';
    console.error('[Job Autofill] could not display the document', err);
    return;
  }
  const views: PageView[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const canvas = el<HTMLCanvasElement>('canvas');
    const layer = el<HTMLDivElement>('div', { className: 'textLayer' });
    const wrap = el<HTMLDivElement>('div', { className: 'page' }, canvas, layer);
    pages.append(wrap);
    views.push({ page, wrap, canvas, layer, strs: [], divs: [] });
  }

  // 100% is the page fitted to the window (up to a readable width); zoom levels are relative to that.
  const base = Math.min(MAX_WIDTH, window.innerWidth - 32) / views[0]!.page.getViewport({ scale: 1 }).width;
  let zoom = 1;
  let pass = 0;

  async function renderAll() {
    const mine = ++pass;
    const scale = base * zoom;
    const ratio = window.devicePixelRatio || 1;
    for (const v of views) {
      v.task?.cancel();
      const view = v.page.getViewport({ scale });
      v.wrap.style.width = `${view.width}px`;
      v.wrap.style.height = `${view.height}px`;
      v.wrap.style.setProperty('--total-scale-factor', String(scale));
    }
    for (const v of views) {
      if (mine !== pass) return;
      const out = v.page.getViewport({ scale: scale * ratio });
      v.canvas.width = out.width;
      v.canvas.height = out.height;
      try {
        v.task = v.page.render({ canvas: v.canvas, viewport: out });
        await v.task.promise;
        v.layer.replaceChildren();
        const text = new pdfjs.TextLayer({ textContentSource: v.page.streamTextContent(), container: v.layer, viewport: v.page.getViewport({ scale }) });
        await text.render();
        v.strs = text.textContentItemsStr;
        v.divs = text.textDivs;
      } catch (err) {
        // A newer zoom level cancelled this pass.
        if ((err as Error).name !== 'RenderingCancelledException' && mine === pass) console.error('[Job Autofill] page render failed', err);
        if (mine !== pass) return;
      }
    }
    if (mine === pass) markMatches(false);
  }

  async function setZoom(value: number) {
    zoom = Math.min(ZOOMS[ZOOMS.length - 1]!, Math.max(ZOOMS[0]!, value));
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    zoomOut.disabled = zoom <= ZOOMS[0]!;
    zoomIn.disabled = zoom >= ZOOMS[ZOOMS.length - 1]!;
    await renderAll();
  }
  function zoomBy(direction: 1 | -1) {
    const target = direction > 0 ? ZOOMS.find((z) => z > zoom + 0.01) : [...ZOOMS].reverse().find((z) => z < zoom - 0.01);
    if (target) void setZoom(target);
  }

  async function printDoc() {
    // Pages drawn at a small zoom would print blurry, so print them at the fitted size.
    if (zoom < 1) await setZoom(1);
    window.print();
  }

  // --- Search (matches inside a single line of text) ------------------------------------------
  let matches: HTMLElement[] = [];
  let current = 0;
  function markMatches(scroll: boolean) {
    for (const m of new Set(matches)) m.classList.remove('hit', 'current');
    matches = [];
    const query = search.value.trim().toLowerCase();
    if (query) {
      for (const v of views) {
        v.strs.forEach((str, i) => {
          const lower = str.toLowerCase();
          for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, at + query.length)) matches.push(v.divs[i]!);
        });
      }
      for (const m of new Set(matches)) m.classList.add('hit');
    }
    current = Math.min(current, Math.max(0, matches.length - 1));
    found.textContent = !query ? '' : matches.length ? `${current + 1} of ${matches.length}` : 'No matches';
    prev.disabled = next.disabled = matches.length < 2;
    matches[current]?.classList.add('current');
    if (scroll) matches[current]?.scrollIntoView({ block: 'center', inline: 'center' });
  }
  function step(direction: 1 | -1) {
    if (!matches.length) return;
    matches[current]?.classList.remove('current');
    current = (current + direction + matches.length) % matches.length;
    markMatches(true);
  }
  search.addEventListener('input', () => {
    current = 0;
    markMatches(true);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  });
  prev.disabled = next.disabled = true;

  await setZoom(1);
}

void show();
