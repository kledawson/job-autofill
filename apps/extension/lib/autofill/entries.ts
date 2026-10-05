import type { Profile } from '../types';
import { clickSafely, sleep, timing } from './fill';
import { cleanLabel, OWN_ATTR } from './scan';
import { educationEntries, experienceEntries } from './values';

/**
 * Repeatable sections ("Work Experience" with an Add button, as on Workday's My Experience step). The form
 * starts with no entries, so one is added per profile entry before the fields are scanned.
 */
const SECTIONS = [
  { title: /^(work experience|employment history|work history)$/i, entry: /^(work experience|employment|job)\s*#?\s*\d+$/i, count: (p: Profile) => experienceEntries(p).length },
  { title: /^education$/i, entry: /^education\s*#?\s*\d+$/i, count: (p: Profile) => educationEntries(p).length },
];
const HEADINGS = 'h1, h2, h3, h4, h5, h6, legend, [role="heading"]';
const ADD_RE = /^add( another)?$/i;
const ADD_LABEL_RE = /^add\b.*\b(experience|education|employment|work|school)/i;

const text = (el: Element) => cleanLabel(el.textContent ?? '');
const headingsIn = (scope: ParentNode) => Array.from(scope.querySelectorAll(HEADINGS)).filter((h) => !h.closest(`[${OWN_ATTR}]`));

function addButtonIn(scope: Element): HTMLElement | null {
  const buttons = Array.from(scope.querySelectorAll<HTMLElement>('button, [role="button"]')).filter(
    (b) => (ADD_RE.test(text(b)) || ADD_LABEL_RE.test(b.getAttribute('aria-label') ?? '')) && !(b as HTMLButtonElement).disabled,
  );
  // After the first entry the Add button follows the last one.
  return buttons[buttons.length - 1] ?? null;
}

/** Smallest ancestor of the heading that holds an Add button but not another section's heading. */
function sectionFor(heading: Element): Element | null {
  let node = heading.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    const titles = headingsIn(node).filter((h) => SECTIONS.some((s) => s.title.test(text(h))));
    if (titles.length > 1) return null;
    if (addButtonIn(node)) return node;
  }
  return null;
}

const done = new WeakSet<Element>();

/** Clicks Add until each repeatable section has one entry per profile entry. Returns true if any were added. */
export async function addEntries(root: ParentNode, profile: Profile): Promise<boolean> {
  let added = false;
  for (const s of SECTIONS) {
    const want = s.count(profile);
    if (!want) continue;
    for (const heading of headingsIn(root).filter((h) => s.title.test(text(h)))) {
      const section = sectionFor(heading);
      // Each section is expanded once; entries the person deletes afterwards stay deleted.
      if (!section || done.has(section)) continue;
      done.add(section);
      const entries = () => headingsIn(section).filter((h) => s.entry.test(text(h))).length;
      for (let have = entries(); have < want; ) {
        const add = addButtonIn(section);
        if (!add) break;
        clickSafely(add);
        added = true;
        let now = have;
        for (let waited = 0; now === have && waited < 2000; waited += 100) {
          await sleep(100);
          now = entries();
        }
        if (now === have) break;
        have = now;
      }
    }
  }
  if (added) await sleep(timing.settle);
  return added;
}
