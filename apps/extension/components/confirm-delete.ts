/** Shared accessible deletion confirmation. Native modal behavior traps focus and restores it. */
export function confirmDelete(title: string, description: string, action = 'Delete'): Promise<boolean> {
  return new Promise(resolve => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.createElement('dialog');
    dialog.className = 'w-[calc(100%-2rem)] max-w-md rounded-xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-900/40 m-auto';
    const heading = document.createElement('h2'), details = document.createElement('p'), controls = document.createElement('div');
    heading.id = 'delete-' + crypto.randomUUID(); heading.className = 'font-semibold'; heading.textContent = title;
    details.id = heading.id + '-description'; details.className = 'mt-2 break-words text-sm text-slate-600'; details.textContent = description;
    dialog.setAttribute('aria-labelledby', heading.id); dialog.setAttribute('aria-describedby', details.id);
    controls.className = 'mt-4 flex justify-end gap-2';
    const cancel = document.createElement('button'), remove = document.createElement('button');
    cancel.textContent = 'Cancel'; remove.textContent = action;
    cancel.className = 'rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500';
    remove.className = 'rounded-lg bg-red-600 px-3 py-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-indigo-500';
    let settled = false;
    const finish = (result: boolean) => { if (settled) return; settled = true; dialog.close(); dialog.remove(); previous?.focus({ preventScroll: true }); resolve(result); };
    cancel.onclick = () => finish(false); remove.onclick = () => finish(true);
    dialog.addEventListener('cancel', e => { e.preventDefault(); finish(false); });
    dialog.addEventListener('close', () => finish(false));
    controls.append(cancel, remove); dialog.append(heading, details, controls); document.body.append(dialog); dialog.showModal(); cancel.focus();
  });
}
