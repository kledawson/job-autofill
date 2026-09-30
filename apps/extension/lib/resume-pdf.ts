// Extracts text lines and link targets from a PDF, entirely in the browser.
// Used by extension pages only (pdf.js is loaded on demand).

export interface PdfText {
  lines: string[];
  links: string[];
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

export async function extractPdfText(data: ArrayBuffer): Promise<PdfText> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  const lines: string[] = [];
  const links: string[] = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, 5); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = (content.items as TextItem[]).filter((i) => typeof i.str === 'string' && i.str.trim());

      // Group items into rows by baseline, top to bottom.
      const rows: { y: number; size: number; items: TextItem[] }[] = [];
      for (const item of items) {
        const y = item.transform[5]!;
        const size = Math.abs(item.transform[3] ?? 10) || 10;
        const row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, size * 0.4));
        if (row) row.items.push(item);
        else rows.push({ y, size, items: [item] });
      }
      rows.sort((a, b) => b.y - a.y);

      for (const row of rows) {
        row.items.sort((a, b) => a.transform[4]! - b.transform[4]!);
        let text = '';
        let prevEnd: number | null = null;
        for (const item of row.items) {
          const x = item.transform[4]!;
          if (prevEnd !== null) {
            const gap = x - prevEnd;
            // Wide gaps separate columns (a title on the left, dates on the right).
            if (gap > row.size * 2) text += '\t';
            else if (gap > row.size * 0.15 && !text.endsWith(' ') && !item.str.startsWith(' ')) text += ' ';
          }
          text += item.str;
          prevEnd = x + item.width;
        }
        lines.push(text.replace(/[ ]{2,}/g, ' ').trim());
      }

      for (const a of await page.getAnnotations()) {
        if (a?.subtype === 'Link' && typeof a.url === 'string') links.push(a.url);
      }
    }
  } finally {
    await task.destroy();
  }
  return { lines, links };
}
