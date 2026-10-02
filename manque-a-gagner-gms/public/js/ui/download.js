// File hand-off. Inside an embedded preview downloads can be blocked, so the
// content is also offered as text to copy.

import { html } from './dom.js';
import { openModal, toast } from './overlay.js';
import { icon } from './icons.js';

const embedded = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

export function isEmbedded() {
  return embedded;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function showCopyDialog(filename, text) {
  openModal({
    title: 'Copier le fichier',
    subtitle: `${filename} : le téléchargement n’est pas disponible dans cet aperçu. Copiez le contenu puis collez-le dans Excel ou un éditeur de texte.`,
    size: 'md',
    body: html`<div class="modal-body"><label class="visually-hidden" for="copy-area">Contenu</label>
      <textarea id="copy-area" rows="12" readonly style="font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px">${text}</textarea></div>
      <div class="form-actions"><button type="button" class="btn btn-secondary" data-close>Fermer</button>
      <button type="button" class="btn btn-primary" data-copy>${icon('copy')}<span>Copier</span></button></div>`,
    onMount(root) {
      const area = root.querySelector('textarea');
      root.querySelector('[data-copy]').addEventListener('click', async () => {
        if (await copyText(text)) toast('Contenu copié.');
        else {
          area.focus();
          area.select();
          toast('Sélection prête : utilisez Ctrl+C (ou Cmd+C).');
        }
      });
    },
  });
}

/** Saves `text` as a file; CSV gets a BOM so Excel reads accents correctly. */
export function offerFile(filename, text, type = 'text/csv') {
  if (embedded) {
    showCopyDialog(filename, text);
    return;
  }
  const content = type === 'text/csv' ? `\ufeff${text}` : text;
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
