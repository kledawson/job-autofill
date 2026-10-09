export const SIDEBAR_ORDER = ['fill', 'queue', 'review', 'setup', 'track', 'presets', 'history'] as const;
export type SidebarId = typeof SIDEBAR_ORDER[number];
export const isSidebarId = (id: string): id is SidebarId => (SIDEBAR_ORDER as readonly string[]).includes(id);
export const SIDEBAR_ORDER_KEY = 'sidebarOrder';
export const SIDEBAR_VISIBILITY_KEY = 'sidebarVisibility';
export const SIDEBAR_CATEGORIES: Record<SidebarId, { title: string; description: string; defaultVisible: boolean }> = {
  fill: { title: 'Fill this page', description: 'Fill and see a short summary of the current application. Always available.', defaultVisible: true },
  queue: { title: 'Application queue', description: 'Paste job links and review applications in batches.', defaultVisible: true },
  review: { title: 'Review & remember', description: 'Review missing questions and save answers for next time.', defaultVisible: true },
  setup: { title: 'Setup & connections', description: 'Quick links to your profile, AI and Google Sheets settings.', defaultVisible: false },
  track: { title: 'Track without autofill', description: 'Record an application you submitted without using autofill.', defaultVisible: false },
  presets: { title: 'Application preset', description: 'Switch resumes and prepared responses for different roles.', defaultVisible: true },
  history: { title: 'Applications', description: 'See your recent applications and their status.', defaultVisible: true },
};
export type SidebarVisibility = Record<SidebarId, boolean>;
export function readSidebarVisibility(value: unknown): SidebarVisibility {
  const result = Object.fromEntries(SIDEBAR_ORDER.map(id => [id, SIDEBAR_CATEGORIES[id].defaultVisible])) as SidebarVisibility;
  const record = value as { version?: unknown; categories?: Record<string, unknown> } | undefined;
  if (record?.version === 1 && record.categories && typeof record.categories === 'object' && !Array.isArray(record.categories)) {
    for (const id of SIDEBAR_ORDER) if (id !== 'fill' && typeof record.categories[id] === 'boolean') result[id] = record.categories[id] as boolean;
  }
  return result;
}

/** Retain existing relative order and insert newly added sections before their next default neighbor. */
export function readSidebarOrder(value: unknown): SidebarId[] {
  const record = value as { version?: unknown; order?: unknown } | undefined;
  if (!record || record.version !== 1 || !Array.isArray(record.order) || record.order.length > 50 ||
      record.order.some(id => typeof id !== 'string' || id.length > 80)) return [...SIDEBAR_ORDER];
  const result: SidebarId[] = [...new Set(record.order.filter(isSidebarId))];
  for (const id of SIDEBAR_ORDER) {
    if (result.includes(id)) continue;
    const following = SIDEBAR_ORDER.slice(SIDEBAR_ORDER.indexOf(id) + 1).find(next => result.includes(next));
    result.splice(following ? result.indexOf(following) : result.length, 0, id);
  }
  return result;
}
