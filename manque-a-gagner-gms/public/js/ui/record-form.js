// Add / edit dialog for any collection, with a live calculation preview.

import { html, setHtml } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog, toast } from './overlay.js';
import { renderField, readForm, syncVisibility, showErrors } from './forms.js';
import { drawChart } from './charts.js';
import { stockoutPreview, promotionPreview, listingPreview, facingPreview, productPreview } from './previews.js';
import { COLLECTIONS, LEVERS, validateRecord, newRecord } from '../core/schema.js';
import { createContext, computeRecord, unitEconomics } from '../core/calc.js';
import { fmtDecimal } from '../core/format.js';
import { state, saveRecord, deleteRecord, can } from '../state.js';

const LAYOUT = {
  products: [
    { legend: 'Identification', fields: ['name', 'ean', 'brand', 'category', 'status'] },
    { legend: 'Prix et marges', fields: ['pvcTtc', 'vatRate', 'netPrice', 'unitCost'] },
    { legend: 'En rayon', fields: ['rot', 'unitsPerFacing'] },
  ],
  retailers: [{ legend: null, fields: ['name', 'format', 'stores', 'kam'] }],
  stockouts: [
    { legend: 'Référence et magasin', fields: ['productId', 'retailerId', 'store', 'cause'] },
    { legend: 'Mesure de la rupture', fields: ['method', 'startDate', 'endDate', 'stores', 'rot', 'soldUnits', 'oosRate'] },
    { legend: null, fields: ['comment'] },
  ],
  promotions: [
    { legend: 'Opération', fields: ['name', 'retailerId', 'mechanic', 'startDate', 'endDate'] },
    { legend: 'Produit et mécanique', fields: ['productId', 'uplift', 'discountPct', 'fundedPct', 'baseRot'] },
    { legend: 'Exécution en magasin', fields: ['storesTargeted', 'storesActive', 'oosDays', 'actualUnits'] },
    { legend: null, fields: ['comment'] },
  ],
  listings: [
    { legend: 'Référencement', fields: ['productId', 'retailerId', 'storesTarget', 'storesListed', 'launchDate', 'delayWeeks'] },
    { legend: 'Hypothèses de vente', fields: ['rot', 'weeks', 'rampWeeks', 'cannibalization', 'listingCost'] },
    { legend: null, fields: ['comment'] },
  ],
  facings: [
    { legend: 'Scénario', fields: ['productId', 'retailerId', 'stores', 'rot', 'currentFacings', 'proposedFacings', 'elasticity', 'weeks'] },
    { legend: 'Capacité du rayon (facultatif)', fields: ['unitsPerFacing', 'restockDays', 'currentOosRate', 'targetOosRate'] },
    { legend: 'Part de linéaire (facultatif)', fields: ['marketShare', 'segmentFacings'] },
    { legend: null, fields: ['comment'] },
  ],
};

const TITLES = {
  products: ['Ajouter un produit', 'Modifier le produit'],
  retailers: ['Ajouter une enseigne', 'Modifier l’enseigne'],
  stockouts: ['Déclarer une rupture', 'Modifier la rupture'],
  promotions: ['Ajouter une ligne d’opération', 'Modifier la ligne d’opération'],
  listings: ['Ajouter un référencement', 'Modifier le référencement'],
  facings: ['Simuler des facings', 'Modifier le scénario de facings'],
};

const SAVED = {
  products: 'Produit enregistré.',
  retailers: 'Enseigne enregistrée.',
  stockouts: 'Rupture enregistrée.',
  promotions: 'Ligne d’opération enregistrée.',
  listings: 'Référencement enregistré.',
  facings: 'Scénario enregistré.',
};

/** Fields that fall back to the product sheet when left empty. */
const PRODUCT_FALLBACK = { rot: 'rot', baseRot: 'rot', unitsPerFacing: 'unitsPerFacing' };

function previewMarkup(collectionKey, value) {
  if (collectionKey === 'products') {
    if (!(value.pvcTtc > 0) || !(value.netPrice > 0)) {
      return html`<p class="preview-note">Saisissez le PVC et le prix net pour voir les marges.</p>`;
    }
    return productPreview(unitEconomics(value, state.settings), value);
  }
  if (!value.productId || !value.retailerId) {
    return html`<h3>${icon('chart')}Résultat du calcul</h3><p class="preview-note">Choisissez un produit et une enseigne : le manque à gagner se calcule pendant la saisie.</p>`;
  }
  const ctx = createContext(state.data, state.settings, { today: state.today });
  const result = computeRecord(collectionKey, { id: 'preview', ...value }, ctx);
  switch (collectionKey) {
    case 'stockouts': return stockoutPreview(result, state.settings);
    case 'promotions': return promotionPreview(result);
    case 'listings': return listingPreview(result);
    case 'facings': return facingPreview(result);
    default: return '';
  }
}

/** Confirms, deletes, and offers to remove dependent lines when needed. */
export async function confirmAndDelete(collectionKey, record) {
  const name = record.name || COLLECTIONS[collectionKey].singular;
  const ok = await confirmDialog({
    title: `Supprimer « ${name} » ?`,
    message: 'La suppression est définitive.',
    confirmLabel: 'Supprimer',
  });
  if (!ok) return false;
  try {
    await deleteRecord(collectionKey, record.id);
  } catch (error) {
    if (error.status !== 409) {
      toast(error.message, { tone: 'error' });
      return false;
    }
    const cascade = await confirmDialog({
      title: 'Fiche utilisée dans des analyses',
      message: `${error.message} Supprimer aussi ces lignes ?`,
      confirmLabel: 'Tout supprimer',
    });
    if (!cascade) return false;
    try {
      await deleteRecord(collectionKey, record.id, { cascade: true });
    } catch (again) {
      toast(again.message, { tone: 'error' });
      return false;
    }
  }
  toast('Suppression effectuée.');
  return true;
}

export function openRecordForm(collectionKey, record = null, { onDone, duplicate = false } = {}) {
  const collection = COLLECTIONS[collectionKey];
  const editing = Boolean(record?.id) && !duplicate;
  const initial = record ? { ...record } : newRecord(collectionKey);
  const readOnly = !can('edit');
  const hasPreview = LEVERS.includes(collectionKey) || collectionKey === 'products';
  const fieldByKey = Object.fromEntries(collection.fields.map((f) => [f.key, f]));
  const [addTitle, editTitle] = TITLES[collectionKey];

  const body = html`<form novalidate>
    <div class="modal-body">
      <div class="${hasPreview ? 'form-layout' : ''}">
        <div class="form-fields">
          <div class="form-errors" role="alert" hidden></div>
          <fieldset class="form-fields" style="border:0;margin:0;padding:0;min-width:0" ${readOnly ? 'disabled' : ''}>
          ${LAYOUT[collectionKey].map((group) => html`<fieldset class="fieldset">
            ${group.legend ? html`<legend>${group.legend}</legend>` : ''}
            ${group.fields.map((key) => renderField(fieldByKey[key], initial[key], { data: state.data, idPrefix: `rf-${collectionKey}` }))}
          </fieldset>`)}
          </fieldset>
        </div>
        ${hasPreview ? html`<aside class="preview" aria-live="polite"></aside>` : ''}
      </div>
    </div>
    <div class="form-actions">
      ${editing && !readOnly ? html`<button type="button" class="btn btn-ghost spacer" data-delete>${icon('trash')}<span>Supprimer</span></button>` : html`<span class="spacer"></span>`}
      ${editing && !readOnly ? html`<button type="button" class="btn btn-secondary" data-duplicate>${icon('copy')}<span>Dupliquer</span></button>` : ''}
      <button type="button" class="btn btn-secondary" data-close>${readOnly ? 'Fermer' : 'Annuler'}</button>
      ${readOnly ? '' : html`<button type="submit" class="btn btn-primary">${editing ? 'Enregistrer' : 'Ajouter'}</button>`}
    </div>
  </form>`;

  openModal({
    title: editing || readOnly ? editTitle : addTitle,
    subtitle: readOnly ? 'Consultation seule : votre rôle ne permet pas de modifier les données.' : null,
    body,
    onMount(root, close) {
      const form = root.querySelector('form');
      const preview = root.querySelector('.preview');
      const errorsBox = root.querySelector('.form-errors');
      const submit = form.querySelector('button[type="submit"]');

      const update = () => {
        const { value } = validateRecord(collectionKey, readForm(form, collection.fields));
        syncVisibility(form, collectionKey, value);
        const product = state.data.products.find((p) => p.id === value.productId);
        for (const [key, productField] of Object.entries(PRODUCT_FALLBACK)) {
          const input = form.elements.namedItem(key);
          if (!input || collectionKey === 'products') continue;
          const fallback = product?.[productField];
          input.placeholder = Number.isFinite(fallback) ? `Fiche produit : ${fmtDecimal(fallback, 2)}` : '';
        }
        for (const field of collection.fields) {
          const input = field.fallback && form.elements.namedItem(field.key);
          if (input) input.placeholder = `Hypothèse : ${fmtDecimal(state.settings[field.fallback], 2)}`;
        }
        if (preview) {
          setHtml(preview, previewMarkup(collectionKey, value));
          const curve = preview.querySelector('[data-preview-curve]');
          if (curve && value.currentFacings > 0 && value.proposedFacings > 0) {
            drawChart(curve, {
              type: 'curve',
              current: value.currentFacings,
              proposed: value.proposedFacings,
              elasticity: value.elasticity ?? state.settings.shelfElasticity,
            });
          }
        }
      };
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      update();

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (readOnly) return;
        const { value, errors, ok } = validateRecord(collectionKey, readForm(form, collection.fields));
        if (!ok) {
          const first = showErrors(form, errors);
          errorsBox.textContent = 'Corrigez les champs signalés pour enregistrer.';
          errorsBox.hidden = false;
          first?.focus();
          return;
        }
        submit.disabled = true;
        try {
          const saved = await saveRecord(collectionKey, editing ? record.id : null, value);
          toast(SAVED[collectionKey]);
          close();
          onDone?.(saved);
        } catch (error) {
          if (error.fields) showErrors(form, error.fields);
          errorsBox.textContent = error.message;
          errorsBox.hidden = false;
        } finally {
          submit.disabled = false;
        }
      });

      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (await confirmAndDelete(collectionKey, record)) {
          close();
          onDone?.(null);
        }
      });
      root.querySelector('[data-duplicate]')?.addEventListener('click', () => {
        const { value } = validateRecord(collectionKey, readForm(form, collection.fields));
        close();
        openRecordForm(collectionKey, value, { onDone, duplicate: true });
      });
    },
  });
}
