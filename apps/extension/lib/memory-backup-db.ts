import { db, getRememberedMappings } from './db';
import { parseStoredMapping, type RememberedMapping } from './remembered-mappings';
import { makeMemoryBackup, memoryRestoreToken, memorySnapshot, parseMemoryBackup, parseRestoreChoices, planMemoryRestore, type RestorePreview, type RestoreResult } from './memory-backup';

export async function exportMemoryBackup() {
  const raw = await db.rememberedMappings.toArray(), records = raw.map(parseStoredMapping);
  if (records.some(m => m === null)) throw new Error('Some saved Memories cannot be read. Review your Memories before creating a backup.');
  return makeMemoryBackup(records as RememberedMapping[]);
}
export async function previewMemoryRestore(contents: unknown): Promise<RestorePreview> {
  const { backup, duplicatesInFile } = parseMemoryBackup(contents), records = await getRememberedMappings();
  return { rows: planMemoryRestore(backup, records), duplicatesInFile, createdAt: backup.createdAt, token: await memoryRestoreToken(contents as string, memorySnapshot(records)) };
}
export async function restoreMemoryBackup(contents: unknown, expectedToken: unknown, rawChoices: unknown): Promise<RestoreResult> {
  const { backup, duplicatesInFile } = parseMemoryBackup(contents);
  if (typeof expectedToken !== 'string' || !/^[a-f0-9]{64}$/.test(expectedToken)) throw new Error('Read the backup preview before restoring.');
  const before = await getRememberedMappings(), snapshot = memorySnapshot(before);
  if (await memoryRestoreToken(contents as string, snapshot) !== expectedToken) throw new Error('Your Memories or backup changed after the preview. Refresh the preview and review your choices again.');
  // Crypto runs before the transaction; exact revalidation inside it closes the race.
  return db.transaction('rw', db.rememberedMappings, async () => {
    const current = await getRememberedMappings();
    if (memorySnapshot(current) !== snapshot) throw new Error('Your Memories changed. Refresh the preview before restoring.');
    const rows = planMemoryRestore(backup, current), choices = parseRestoreChoices(rawChoices, rows);
    const result: RestoreResult = { added: 0, replacements: 0, removed: 0, duplicates: duplicatesInFile, kept: 0, skipped: 0 };
    for (const row of rows) {
      if (row.kind === 'duplicate') { result.duplicates += row.incoming.length; continue; }
      if (choices[row.key] === 'keep') {
        if (row.kind === 'conflict') result.kept += row.current.length;
        else result.skipped += row.incoming.length;
        continue;
      }
      if (row.kind === 'conflict') {
        await db.rememberedMappings.bulkDelete(row.current.map(m => m.id));
        result.removed += row.current.length; result.replacements += row.incoming.length;
      } else result.added += row.incoming.length;
      for (const incoming of row.incoming) {
        const latestUsage = Math.max(incoming.lastUsed ?? 0, ...row.current.map(m => m.lastUsed ?? 0));
        await db.rememberedMappings.add({
          ...incoming, ...(row.kind === 'conflict' ? { updatedAt: Date.now() } : {}),
          ...(latestUsage ? { lastUsed: latestUsage } : {}),
        } as RememberedMapping);
      }
    }
    return result;
  });
}
