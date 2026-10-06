import type { Profile } from '../types';
import { clickSafely, sleep, timing } from './fill';
import { cleanLabel, OWN_ATTR } from './scan';
import { educationEntries, experienceEntries, uniqueLinks } from './values';

/**
 * Repeatable sections ("Work Experience" with an Add button, as on Workday's My Experience step). The form
 * starts with no entries, so one is added per profile entry before the fields are scanned.
 */
interface RepeatSection {
  title: RegExp;
  /** How many entries the section should end up with. */
  count(p: Profile, root: ParentNode): number;
  /** How many entries it has now. */
  entries(section: Element): number;
}

/** Entries so far: Workday panels (workExperience-3) when present, else numbered headings ("Education 2"). */
const numbered = (re: RegExp, panel: RegExp) => (section: Element) => {
  const panels = Array.from(section.querySelectorAll('[data-automation-id]')).filter((p) => panel.test(p.getAttribute('data-automation-id')!)).length;
  return Math.max(panels, headingsIn(section).filter((h) => re.test(text(h))).length);
};
const urlBoxes = (section: Element) =>
  Array.from(section.querySelectorAll('input[type="text"], input[type="url"], input:not([type])')).filter((b) => !b.closest(`[${OWN_ATTR}]`)).length;

/** True when the page asks for LinkedIn in its own box, so it is not repeated under Websites. */
function hasLinkedInBox(root: ParentNode): boolean {
  return Array.from(root.querySelectorAll('label')).some((l) => /linked\s?in/i.test(l.textContent ?? ''));
}

const SECTIONS: RepeatSection[] = [
  {
    title: /^(work experience|employment history|work history)$/i,
    count: (p) => experienceEntries(p).length,
    entries: numbered(/^(work experience|employment|job)\s*#?\s*\d+$/i, /^workExperience-\d+$/),
  },
  { title: /^education$/i, count: (p) => educationEntries(p).length, entries: numbered(/^education\s*#?\s*\d+$/i, /^education-\d+$/) },
  // Workday "Websites": one URL box per distinct link in the profile (LinkedIn comes last, and is skipped
  // when the page has its own LinkedIn box).
  {
    title: /^websites?$/i,
    count: (p, root) => {
      const links = uniqueLinks(p);
      const linkedinLast = !!p.linkedin.trim() && links[links.length - 1] === p.linkedin.trim();
      return linkedinLast && hasLinkedInBox(root) ? links.length - 1 : links.length;
    },
    entries: urlBoxes,
  },
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

/**
 * Clicks Add until each repeatable section has one entry per profile entry. Returns true if any were added.
 * `done` belongs to one fill session: within it, entries the person deletes stay deleted; a new Fill click
 * starts a new session and adds them back.
 */
export async function addEntries(root: ParentNode, profile: Profile, done: WeakSet<Element> = new WeakSet()): Promise<boolean> {
  let added = false;
  for (const s of SECTIONS) {
    const want = s.count(profile, root);
    if (!want) continue;
    for (const heading of headingsIn(root).filter((h) => s.title.test(text(h)))) {
      const section = sectionFor(heading);
      if (!section || done.has(section)) continue;
      done.add(section);
      const entries = () => s.entries(section);
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
