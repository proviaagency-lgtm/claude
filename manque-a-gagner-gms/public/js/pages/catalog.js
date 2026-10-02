// Référentiel: products and retailers.

import { html } from '../ui/dom.js';
import { button, emptyState } from '../ui/components.js';
import { dataTable } from '../ui/table.js';
import { icon } from '../ui/icons.js';
import { state, windowedResults, measureContext, can } from '../state.js';
import { unitEconomics, groupResults } from '../core/calc.js';
import { RETAILER_FORMATS } from '../core/schema.js';
import { fmtPrice, fmtPct, fmtNumber, fmtDecimal } from '../core/format.js';
import { collectionActions, openButton } from './shared.js';

function actionsCell(collection, id) {
  if (!can('edit')) return '';
  return html`<button type="button" class="btn btn-ghost btn-icon" data-action="delete-record" data-collection="${collection}" data-id="${id}" title="Supprimer" aria-label="Supprimer">${icon('trash')}</button>`;
}

export const products = {
  id: 'produits',
  title: 'Produits',
  subtitle: 'Prix, marges et rotations de référence',
  headerActions: () => collectionActions('products', 'Ajouter un produit'),

  render() {
    const list = state.data.products;
    if (!list.length) {
      return html`<section class="card">${emptyState({
        title: 'Aucun produit',
        text: 'Ajoutez vos références avec leur PVC, leur prix net et leur rotation, ou importez votre catalogue au format CSV (export Excel accepté).',
        actions: can('edit') ? [
          button({ label: 'Ajouter un produit', iconName: 'plus', action: 'add-record', variant: 'primary', data: { collection: 'products' } }),
          button({ label: 'Importer le catalogue', iconName: 'upload', action: 'import-preset', data: { collection: 'products' } }),
        ] : [],
      })}</section>`;
    }
    const rows = list.map((p) => ({ p, eco: unitEconomics(p, state.settings) }));
    const columns = [
      { key: 'name', label: 'Libellé', sort: (r) => r.p.name, render: (r) => openButton('products', r.p.id, r.p.name, r.p.ean || 'EAN non renseigné') },
      { key: 'brand', label: 'Marque · gamme', sort: (r) => `${r.p.brand || ''} ${r.p.category || ''}`, render: (r) => html`${r.p.brand || '—'}<span class="cell-sub">${r.p.category || ''}</span>` },
      { key: 'status', label: 'Statut', sort: (r) => r.p.status, render: (r) => (r.p.status === 'innovation' ? html`<span class="chip">Innovation</span>` : html`<span class="muted">Permanent</span>`) },
      { key: 'pvc', label: 'PVC TTC', align: 'right', sort: (r) => r.p.pvcTtc, render: (r) => html`<span class="num">${fmtPrice(r.p.pvcTtc)}</span>` },
      { key: 'net', label: 'Prix net', align: 'right', sort: (r) => r.p.netPrice, render: (r) => html`<span class="num">${fmtPrice(r.p.netPrice)}</span>` },
      {
        key: 'mfg',
        label: 'Marge industriel',
        align: 'right',
        sort: (r) => r.eco.mfgMargin / (r.eco.netPrice || 1),
        render: (r) => html`<span class="num">${fmtPct(r.eco.netPrice ? r.eco.mfgMargin / r.eco.netPrice : 0, 0)}</span>${r.eco.marginEstimated ? html`<span class="cell-sub">estimée</span>` : ''}`,
      },
      { key: 'retail', label: 'Taux de marque enseigne', align: 'right', sort: (r) => r.eco.retailMargin / (r.eco.pvcHt || 1), render: (r) => html`<span class="num">${fmtPct(r.eco.pvcHt ? r.eco.retailMargin / r.eco.pvcHt : 0, 0)}</span>` },
      { key: 'rot', label: 'Rotation', align: 'right', sort: (r) => r.p.rot, render: (r) => html`<span class="num">${Number.isFinite(r.p.rot) ? fmtDecimal(r.p.rot, 1) : '—'}</span>` },
      { key: 'actions', label: html`<span class="visually-hidden">Actions</span>`, render: (r) => actionsCell('products', r.p.id), className: 'actions' },
    ];
    return html`<section class="card">${dataTable({
      key: 'products',
      columns,
      rows,
      search: (r) => `${r.p.name} ${r.p.ean || ''} ${r.p.brand || ''} ${r.p.category || ''}`,
      rowAttrs: (r) => ({ class: 'clickable', 'data-action': 'open-record', 'data-collection': 'products', 'data-id': r.p.id }),
      defaultSort: { sortKey: 'name', sortDir: 'asc' },
    })}</section>`;
  },
};

export const retailers = {
  id: 'enseignes',
  title: 'Enseignes',
  subtitle: 'Parc de magasins et responsables de compte',
  headerActions: () => collectionActions('retailers', 'Ajouter une enseigne'),

  render() {
    const list = state.data.retailers;
    if (!list.length) {
      return html`<section class="card">${emptyState({
        title: 'Aucune enseigne',
        text: 'Ajoutez les enseignes que vous livrez avec leur nombre de magasins.',
        actions: can('edit') ? [button({ label: 'Ajouter une enseigne', iconName: 'plus', action: 'add-record', variant: 'primary', data: { collection: 'retailers' } })] : [],
      })}</section>`;
    }
    const m = measureContext();
    const totals = new Map(groupResults(windowedResults().filter((r) => r.inWindow), (r) => r.retailerId, m.view, m.measure).map((g) => [g.key, g.value]));
    const formatLabel = (value) => RETAILER_FORMATS.find((f) => f.value === value)?.label || '—';
    const columns = [
      { key: 'name', label: 'Enseigne', sort: (r) => r.name, render: (r) => openButton('retailers', r.id, r.name, r.kam ? `Suivie par ${r.kam}` : '') },
      { key: 'format', label: 'Format', sort: (r) => formatLabel(r.format), render: (r) => formatLabel(r.format) },
      { key: 'stores', label: 'Magasins', align: 'right', sort: (r) => r.stores, render: (r) => html`<span class="num">${Number.isFinite(r.stores) ? fmtNumber(r.stores) : '—'}</span>` },
      { key: 'gap', label: `Manque à gagner · ${m.label}`, align: 'right', sort: (r) => totals.get(r.id) || 0, render: (r) => html`<span class="num strong">${m.format(totals.get(r.id) || 0)}</span>` },
      { key: 'pitch', label: html`<span class="visually-hidden">Argumentaire</span>`, render: (r) => html`<button type="button" class="btn btn-ghost btn-small" data-action="open-pitch" data-id="${r.id}">${icon('pitch')}<span>Argumentaire</span></button>` },
      { key: 'actions', label: html`<span class="visually-hidden">Actions</span>`, render: (r) => actionsCell('retailers', r.id), className: 'actions' },
    ];
    return html`<section class="card">${dataTable({
      key: 'retailers',
      columns,
      rows: list,
      search: (r) => `${r.name} ${r.kam || ''}`,
      rowAttrs: (r) => ({ class: 'clickable', 'data-action': 'open-record', 'data-collection': 'retailers', 'data-id': r.id }),
      defaultSort: { sortKey: 'gap', sortDir: 'desc' },
    })}</section>`;
  },
};
