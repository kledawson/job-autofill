import { assertNoMappingConflict, parseStoredMapping, type MappingDraft, type RememberedMapping } from './remembered-mappings';

export const MEMORY_BACKUP_FORMAT = 'job-autofill-memories';
export const MEMORY_BACKUP_MAX_BYTES = 5 * 1024 * 1024;
export const MEMORY_BACKUP_MAX_RECORDS = 1000;
export type BackupMemory = Omit<RememberedMapping, 'id'>;
export interface MemoryBackup {
  format: typeof MEMORY_BACKUP_FORMAT; version: 1; createdAt: number; memories: BackupMemory[];
}
export interface RestoreRow {
  key: number; kind: 'new' | 'duplicate' | 'conflict'; incoming: BackupMemory[]; current: RememberedMapping[];
}
export interface RestorePreview {
  rows: RestoreRow[]; duplicatesInFile: number; createdAt: number; token: string;
}
export type RestoreChoice = 'keep' | 'backup';
export interface RestoreResult {
  added: number; replacements: number; removed: number; duplicates: number; kept: number; skipped: number;
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a valid Memories backup JSON file.');
  return value as Record<string, unknown>;
};
const finiteDate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15;
const withoutId = ({ id: _id, ...memory }: RememberedMapping): BackupMemory => memory;

/** Compare the complete approved rule, not just its answer. Dates and local IDs are metadata. */
export function memoryRule(memory: MappingDraft): string {
  return JSON.stringify({
    question: memory.question, scope: memory.scope, target: memory.target,
    aliases: memory.aliases, meaning: memory.meaning ?? null, answerAliases: memory.answerAliases ?? [],
  });
}
export function memoriesOverlap(a: MappingDraft, b: RememberedMapping): boolean {
  try { assertNoMappingConflict(a, [b]); return false; } catch { return true; }
}
export function makeMemoryBackup(records: RememberedMapping[], now = Date.now()): MemoryBackup {
  if (records.length > MEMORY_BACKUP_MAX_RECORDS) throw new Error('A backup supports up to 1,000 Memories.');
  const backup: MemoryBackup = { format: MEMORY_BACKUP_FORMAT, version: 1, createdAt: now, memories: records.map(withoutId) };
  // Export and import share validation; never produce a file that cannot be restored.
  parseMemoryBackup(JSON.stringify(backup));
  return backup;
}
export function parseMemoryBackup(contents: unknown): { backup: MemoryBackup; duplicatesInFile: number } {
  if (typeof contents !== 'string' || new TextEncoder().encode(contents).byteLength > MEMORY_BACKUP_MAX_BYTES) throw new Error('Choose a Memories backup smaller than 5 MB.');
  let raw: unknown;
  try { raw = JSON.parse(contents); } catch { throw new Error('This file is not valid JSON. Choose a Job Autofill Memories backup.'); }
  const value = record(raw);
  if (value.format !== MEMORY_BACKUP_FORMAT) throw new Error('This is not a Memories backup. Profile exports are restored in Settings → Data.');
  if (value.version !== 1) throw new Error('This backup version is not supported. Update Job Autofill before restoring it.');
  if (!finiteDate(value.createdAt) || !Array.isArray(value.memories) || value.memories.length > MEMORY_BACKUP_MAX_RECORDS) throw new Error('Invalid backup details. A backup supports up to 1,000 Memories.');
  const memories: BackupMemory[] = [], validated: RememberedMapping[] = [];
  const rules = new Set<string>();
  let duplicatesInFile = 0;
  for (const [index, item] of value.memories.entries()) {
    const memory = parseStoredMapping({ ...record(item), id: index + 1 });
    if (!memory) throw new Error('Memory ' + (index + 1) + ' has an invalid answer, scope, matching rule or record version. Nothing was restored.');
    const rule = memoryRule(memory);
    if (rules.has(rule)) { duplicatesInFile++; continue; }
    if (validated.some(existing => memoriesOverlap(memory, existing))) throw new Error('Memories inside this backup have overlapping questions or matching rules. Resolve them in Memories before backing up again.');
    rules.add(rule); validated.push(memory); memories.push(withoutId(memory));
  }
  return { backup: { format: MEMORY_BACKUP_FORMAT, version: 1, createdAt: value.createdAt, memories }, duplicatesInFile };
}
/** Group overlapping current records so an override cannot remove an item marked Keep. */
export function planMemoryRestore(backup: MemoryBackup, current: RememberedMapping[]): RestoreRow[] {
  const rows: RestoreRow[] = [];
  for (const [key, incoming] of backup.memories.entries()) {
    const overlaps = current.filter(existing => memoriesOverlap(incoming, existing));
    if (!overlaps.length) { rows.push({ key, kind: 'new', incoming: [incoming], current: [] }); continue; }
    if (overlaps.length === 1 && memoryRule(overlaps[0]!) === memoryRule(incoming)) {
      rows.push({ key, kind: 'duplicate', incoming: [incoming], current: overlaps }); continue;
    }
    const linked = rows.filter(row => row.kind === 'conflict' && row.current.some(existing => overlaps.some(m => m.id === existing.id)));
    const group: RestoreRow = {
      key: linked.length ? linked[0]!.key : key, kind: 'conflict',
      incoming: [...linked.flatMap(row => row.incoming), incoming],
      current: [...new Map([...linked.flatMap(row => row.current), ...overlaps].map(m => [m.id, m])).values()],
    };
    for (const row of linked) rows.splice(rows.indexOf(row), 1);
    rows.push(group);
  }
  return rows.sort((a, b) => a.key - b.key);
}
/** Usage-only changes do not invalidate a preview; edits/additions/removals do. */
export function memorySnapshot(records: RememberedMapping[]): string {
  return JSON.stringify([...records].sort((a, b) => a.id - b.id).map(({ lastUsed: _usage, ...m }) => m));
}
export async function memoryRestoreToken(contents: string, snapshot: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contents + '\u0000' + snapshot));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function parseRestoreChoices(value: unknown, rows: RestoreRow[]): Record<number, RestoreChoice> {
  const raw = record(value), choices: Record<number, RestoreChoice> = {};
  const eligible = rows.filter(row => row.kind !== 'duplicate');
  if (Object.keys(raw).length !== eligible.length) throw new Error('Review every restore choice before saving.');
  for (const row of eligible) {
    if (!Object.hasOwn(raw, row.key) || (raw[row.key] !== 'keep' && raw[row.key] !== 'backup')) throw new Error('Invalid restore choice. Refresh the preview.');
    choices[row.key] = raw[row.key] as RestoreChoice;
  }
  return choices;
}
