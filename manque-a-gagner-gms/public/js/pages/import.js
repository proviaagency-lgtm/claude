// Import CSV: choose the data, drop a file (or paste from Excel), check the
// mapping and the errors, then import the valid rows.

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button } from '../ui/components.js';
import { toast } from '../ui/overlay.js';
import { offerFile } from '../ui/download.js';
import { state, reload, can } from '../state.js';
import { COLLECTIONS, LEVERS } from '../core/schema.js';
import { IMPORT_MODES, IMPORT_MODE_LABELS, importCSV, templateCSV, exportColumns } from '../core/io.js';
import { newId } from '../store/local-store.js';
import { fmtNumber } from '../core/format.js';

const CHOICES = [
  { key: 'products', title: 'Produits', text: 'EAN, libellé, PVC, prix net, coût, rotation' },
  { key: 'retailers', title: 'Enseignes', text: 'Nom, format, nombre de magasins' },
  { key: 'stockouts', title: 'Ruptures', text: 'Taux de rupture ou jours × magasins' },
  { key: 'promotions', title: 'Opérations', text: 'Une ligne par produit et par opération' },
  { key: 'listings', title: 'Nouveaux produits', text: 'Magasins cibles et magasins référencés' },
  { key: 'facings', title: 'Facings', text: 'Facings actuels et proposés par enseigne' },
];

const ROUTES = { products: 'produits', retailers: 'enseignes', stockouts: 'ruptures', promotions: 'operations', listings: 'nouveaux-produits', facings: 'facings' };

const local = {
  collection: 'products',
  fileName: '',
  text: '',
  outcome: null,
  mode: null,
  createRetailers: true,
  busy: false,
};

export function presetImport(collection) {
  local.collection = collection;
  local.fileName = '';
  local.text = '';
  local.outcome = null;
  local.mode = null;
}

function requiredColumns(collection) {
  const fields = COLLECTIONS[collection].fields;
  const required = new Set();
  for (const f of fields) {
    if (f.type === 'ref' && f.collection === 'products') required.add('EAN').add('Produit');
    else if (f.type === 'ref') required.add('Enseigne');
    else if (f.required) required.add(f.label);
  }
  return required;
}

function analyse() {
  if (!local.text) return null;
  return importCSV(local.collection, local.text, state.data, {
    createMissingRetailers: LEVERS.includes(local.collection) && local.createRetailers,
    newId,
  });
}

function preview(result) {
  if (!result) return '';
  const { parsed, records, errors, newRetailers, map } = result;
  const modes = IMPORT_MODES[local.collection];
  const mode = modes.includes(local.mode) ? local.mode : modes[0];
  const recognised = parsed.headers.length - map.unmatched.length;
  return html`
    <section class="card">
      <div class="card-head"><div><h2>Vérification</h2><p>${local.fileName || 'Texte collé'} · séparateur « ${parsed.delimiter === '\t' ? 'tabulation' : parsed.delimiter} »</p></div></div>
      <div class="card-body steps">
        <p>${fmtNumber(parsed.rows.length)} ligne${parsed.rows.length > 1 ? 's' : ''} lue${parsed.rows.length > 1 ? 's' : ''},
          ${fmtNumber(recognised)} colonne${recognised > 1 ? 's' : ''} reconnue${recognised > 1 ? 's' : ''}.
          ${map.unmatched.length ? html`Colonnes ignorées : <strong>${map.unmatched.join(', ')}</strong>.` : ''}</p>
        ${newRetailers.length ? html`<p>${icon('info')} ${fmtNumber(newRetailers.length)} enseigne${newRetailers.length > 1 ? 's' : ''} sera créée${newRetailers.length > 1 ? 's' : ''} : ${newRetailers.map((r) => r.name).join(', ')}.</p>` : ''}
        ${errors.length ? html`<div>
          <p class="field-error">${fmtNumber(errors.length)} ligne${errors.length > 1 ? 's' : ''} en erreur ${records.length ? '(ignorée' + (errors.length > 1 ? 's' : '') + ' à l’import)' : ''}</p>
          <ul class="error-list">${errors.slice(0, 100).map((e) => html`<li><strong>Ligne ${e.line}</strong> : ${e.messages.join(' · ')}</li>`)}</ul>
        </div>` : html`<p>${icon('check')} Toutes les lignes sont valides.</p>`}
        ${records.length ? html`<fieldset class="fieldset" style="grid-template-columns:1fr">
          <legend>Que faire des données existantes ?</legend>
          ${modes.map((m) => html`<label class="checkbox"><input type="radio" name="import-mode" value="${m}" data-action="import-mode" ${m === mode ? 'checked' : ''}> <span>${IMPORT_MODE_LABELS[m]}</span></label>`)}
          ${LEVERS.includes(local.collection) ? html`<label class="checkbox"><input type="checkbox" data-action="import-create-retailers" ${local.createRetailers ? 'checked' : ''}> <span>Créer automatiquement les enseignes inconnues</span></label>` : ''}
        </fieldset>
        <div>${button({ label: `Importer ${fmtNumber(records.length)} ligne${records.length > 1 ? 's' : ''}${errors.length ? ' valides' : ''}`, iconName: 'upload', action: 'import-run', variant: 'primary', disabled: local.busy })}</div>` : ''}
      </div>
    </section>`;
}

export default {
  id: 'import',
  title: 'Import CSV',
  subtitle: 'Vos fichiers Excel ou exports des portails enseignes',

  render() {
    if (!can('edit')) {
      return html`<section class="card"><div class="empty"><h2>Import réservé aux éditeurs</h2><p>Votre rôle permet de consulter les analyses. Demandez à un administrateur de modifier votre rôle pour importer des données.</p></div></section>`;
    }
    const required = requiredColumns(local.collection);
    const headers = exportColumns(local.collection).map((c) => c.header);
    const result = analyse();
    const leverWithoutRefs = LEVERS.includes(local.collection) && !state.data.products.length;
    return html`
      <section class="card">
        <div class="card-body steps">
          <div>
            <div class="step-title"><b>1</b><h2>Quelles données importez-vous ?</h2></div>
            <div class="choice-grid">${CHOICES.map((c) => html`
              <button type="button" class="choice" data-action="import-choose" data-collection="${c.key}" aria-pressed="${c.key === local.collection}">
                <strong>${c.title}</strong><span>${c.text}</span>
              </button>`)}</div>
          </div>
          <div>
            <div class="step-title"><b>2</b><h2>Déposez votre fichier</h2></div>
            ${leverWithoutRefs ? html`<p class="form-errors">Importez d’abord vos produits : chaque ligne doit retrouver son produit par EAN ou par libellé.</p>` : ''}
            <label class="dropzone" data-dropzone>
              ${icon('upload')}
              <strong>Glissez un fichier CSV ici ou cliquez pour le choisir</strong>
              <span class="small">Séparateur point-virgule, virgule ou tabulation · nombres au format français acceptés · dates JJ/MM/AAAA</span>
              <input type="file" accept=".csv,.txt,text/csv,text/plain" class="visually-hidden" data-file-input>
            </label>
            <details style="margin-top:10px">
              <summary class="link-button" style="display:inline">Ou coller des cellules depuis Excel</summary>
              <textarea id="import-paste" rows="5" style="margin-top:8px" placeholder="Collez ici les lignes copiées, en-têtes compris"></textarea>
              <div style="margin-top:8px">${button({ label: 'Analyser le texte collé', action: 'import-paste' })}</div>
            </details>
            <p style="margin-top:12px" class="small ink-2">Colonnes attendues (en gras : obligatoires) :</p>
            <ul class="columns-list" style="margin-top:6px">${headers.map((h) => html`<li class="${required.has(h) ? 'req' : ''}">${h}</li>`)}</ul>
            <div style="margin-top:10px">${button({ label: 'Télécharger le modèle', iconName: 'download', action: 'import-template', size: 'small' })}</div>
          </div>
        </div>
      </section>
      ${preview(result)}
      ${local.outcome ? html`<section class="banner"><span class="tag">Import terminé</span>
        <span>${local.outcome}</span>
        <a class="link-button" href="#${ROUTES[local.collection]}">Voir les ${COLLECTIONS[local.collection].label.toLowerCase()}</a></section>` : ''}`;
  },

  mount(root, ctx) {
    const input = root.querySelector('[data-file-input]');
    const zone = root.querySelector('[data-dropzone]');
    if (!input || !zone) return;
    const readFile = async (file) => {
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) {
        toast('Fichier trop volumineux (15 Mo maximum).', { tone: 'error' });
        return;
      }
      const buffer = await file.arrayBuffer();
      let text = new TextDecoder('utf-8').decode(buffer);
      // Older Excel exports are Windows-1252, which shows up as U+FFFD here.
      if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buffer);
      local.fileName = file.name;
      local.text = text;
      local.outcome = null;
      ctx.rerender();
    };
    input.addEventListener('change', () => readFile(input.files?.[0]));
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.classList.add('is-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('is-over');
      readFile(event.dataTransfer?.files?.[0]);
    });
  },

  handlers: {
    'import-choose'(el, event, ctx) {
      presetImport(el.dataset.collection);
      ctx.rerender();
    },
    'import-template'() {
      offerFile(`modele-gondole-${ROUTES[local.collection]}.csv`, templateCSV(local.collection));
    },
    'import-paste'(el, event, ctx) {
      const area = document.getElementById('import-paste');
      if (!area?.value.trim()) {
        toast('Collez d’abord des lignes avec leurs en-têtes.', { tone: 'error' });
        return;
      }
      local.text = area.value;
      local.fileName = '';
      local.outcome = null;
      ctx.rerender();
    },
    'import-mode'(el, event, ctx) {
      local.mode = el.value;
      ctx.rerender();
    },
    'import-create-retailers'(el, event, ctx) {
      local.createRetailers = el.checked;
      ctx.rerender();
    },
    async 'import-run'(el, event, ctx) {
      const result = analyse();
      if (!result?.records.length) return;
      const modes = IMPORT_MODES[local.collection];
      const mode = modes.includes(local.mode) ? local.mode : modes[0];
      local.busy = true;
      ctx.rerender();
      try {
        const outcome = await state.store.import(local.collection, {
          records: result.records,
          mode,
          newRetailers: result.newRetailers.map((r) => ({ tempId: r.id, name: r.name, format: r.format })),
        });
        await reload();
        const parts = [];
        if (outcome.created) parts.push(`${fmtNumber(outcome.created)} ajoutée${outcome.created > 1 ? 's' : ''}`);
        if (outcome.updated) parts.push(`${fmtNumber(outcome.updated)} mise${outcome.updated > 1 ? 's' : ''} à jour`);
        if (outcome.removed) parts.push(`${fmtNumber(outcome.removed)} remplacée${outcome.removed > 1 ? 's' : ''}`);
        if (outcome.retailersCreated) parts.push(`${fmtNumber(outcome.retailersCreated)} enseigne${outcome.retailersCreated > 1 ? 's' : ''} créée${outcome.retailersCreated > 1 ? 's' : ''}`);
        local.outcome = `Lignes ${parts.join(', ')}.`;
        local.text = '';
        local.fileName = '';
        toast('Import terminé.');
      } catch (error) {
        const detail = error.rows?.length ? ` (première ligne en erreur : ${error.rows[0].index + 1})` : '';
        toast(`${error.message}${detail}`, { tone: 'error', timeout: 7000 });
      } finally {
        local.busy = false;
        ctx.rerender();
      }
    },
  },
};
