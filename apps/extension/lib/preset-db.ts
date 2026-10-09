import { db, getProfile } from './db';
import { defaultPreset, DEFAULT_PRESET_ID, parsePreset, presetId, profileForPreset, type ApplicationPreset, type PresetDocument } from './presets';
import { fileToPayload, type FillContext } from './messages';
import { getSettings } from './settings';

export async function ensurePresets() {
  await db.transaction('rw', db.presets, db.presetState, async () => {
    if (!await db.presets.get(DEFAULT_PRESET_ID)) await db.presets.put(defaultPreset());
    if (!await db.presetState.get('selection')) await db.presetState.put({ id: 'selection', selectedId: DEFAULT_PRESET_ID });
  });
}
export async function listPresets(): Promise<ApplicationPreset[]> {
  const records = (await db.presets.toArray()).map(parsePreset);
  if (!records.some(p => p.id === DEFAULT_PRESET_ID)) records.push(defaultPreset());
  return records.sort((a, b) =>
    a.id === DEFAULT_PRESET_ID ? -1 : b.id === DEFAULT_PRESET_ID ? 1 : a.name.localeCompare(b.name));
}
export async function selectedPresetId(): Promise<string> {
  const state = await db.presetState.get('selection');
  return state && await db.presets.get(state.selectedId) ? state.selectedId : DEFAULT_PRESET_ID;
}
export async function selectPreset(id: string) {
  await ensurePresets();
  presetId(id);
  await db.transaction('rw', db.presets, db.presetState, async () => {
    if (!await db.presets.get(id)) throw new Error('This preset was deleted. Choose another preset.');
    await db.presetState.put({ id: 'selection', selectedId: id });
  });
}
function validateDocument(file: PresetDocument) {
  presetId(file.id);
  if (!(file.blob instanceof Blob) || !/\.pdf$/i.test(file.name) || file.blob.size > 10 * 1024 * 1024 ||
      file.blob.size === 0 || file.type !== 'application/pdf') throw new Error('Upload a PDF between 1 byte and 10 MB.');
}
export async function savePreset(value: unknown, expectedRevision?: number, uploads: PresetDocument[] = []) {
  const incoming = parsePreset(value);
  await ensurePresets();
  uploads.forEach(validateDocument);
  return db.transaction('rw', db.presets, db.presetFiles, async () => {
    const current = await db.presets.get(incoming.id);
    if (current ? current.revision !== expectedRevision : expectedRevision !== undefined) throw new Error('This preset changed in another window. Reopen it before saving.');
    const all = await db.presets.toArray();
    if (!current && all.length >= 30) throw new Error('Use at most 30 application presets.');
    if (all.some(p => p.id !== incoming.id && p.name.toLocaleLowerCase() === incoming.name.toLocaleLowerCase())) throw new Error('A preset already uses that name. Choose a different name.');
    for (const upload of uploads) {
      if (await db.presetFiles.get(upload.id)) throw new Error('A document already uses this ID.');
      await db.presetFiles.add(upload);
    }
    for (const choice of [incoming.resume, incoming.coverLetter]) {
      if (choice !== 'profile' && choice !== 'none' && !await db.presetFiles.get(choice)) throw new Error('The selected document is missing. Upload it again.');
    }
    const saved = { ...incoming, revision: (current?.revision ?? 0) + 1, updatedAt: Date.now() };
    await db.presets.put(saved);
    const referenced = new Set((await db.presets.toArray()).flatMap(p => [p.resume, p.coverLetter]));
    for (const f of await db.presetFiles.toArray()) if (!referenced.has(f.id)) await db.presetFiles.delete(f.id);
    return saved;
  });
}
export async function deletePreset(id: string, expectedRevision: number) {
  if (id === DEFAULT_PRESET_ID) throw new Error('Keep the Default preset. You can edit it instead.');
  await db.transaction('rw', db.presets, db.presetFiles, db.presetState, async () => {
    const current = await db.presets.get(presetId(id));
    if (!current || current.revision !== expectedRevision) throw new Error('This preset changed. Refresh before deleting.');
    await db.presets.delete(id);
    if ((await db.presetState.get('selection'))?.selectedId === id) await db.presetState.put({ id: 'selection', selectedId: DEFAULT_PRESET_ID });
    const referenced = new Set((await db.presets.toArray()).flatMap(p => [p.resume, p.coverLetter]));
    for (const f of await db.presetFiles.toArray()) if (!referenced.has(f.id)) await db.presetFiles.delete(f.id);
  });
}
export async function buildPresetContext(id?: string): Promise<FillContext> {
  await ensurePresets();
  const settings = await getSettings();
  const data = await db.transaction('r', db.presets, db.presetState, db.presetFiles, db.files, db.profile, async () => {
    const selected = id ?? (await db.presetState.get('selection'))?.selectedId ?? DEFAULT_PRESET_ID;
    const record = await db.presets.get(presetId(selected));
    if (!record) throw new Error('This preset was deleted. Choose another preset.');
    const preset = parsePreset(record);
    async function file(choice: string, kind: 'resume' | 'coverLetter' | 'transcript') {
      if (choice === 'none') return null;
      const stored = choice === 'profile' ? await db.files.get(kind) : await db.presetFiles.get(choice);
      if (!stored && choice !== 'profile') throw new Error('A preset document is missing. Edit the preset and upload it again.');
      return stored ?? null;
    }
    return { preset, profile: profileForPreset(await getProfile(), preset), resume: await file(preset.resume, 'resume'),
      coverLetter: await file(preset.coverLetter, 'coverLetter'), transcript: await file('profile', 'transcript') };
  });
  const payload = async (file: typeof data.resume) => file ? fileToPayload(file, await file.blob.arrayBuffer()) : null;
  return { profile: data.profile, resume: await payload(data.resume), coverLetter: await payload(data.coverLetter),
    transcript: await payload(data.transcript), hasGeminiKey: !!settings.geminiApiKey,
    preset: { id: data.preset.id, name: data.preset.name, revision: data.preset.revision, emphasis: data.preset.emphasis, responses: data.preset.responses, links: data.preset.links } };
}
