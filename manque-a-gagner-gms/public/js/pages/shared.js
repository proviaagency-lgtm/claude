// Helpers shared by the lever pages: results, cells, chart specs and exports.

import { html } from '../ui/dom.js';
import { button, LEVER_META } from '../ui/components.js';
import { state, filteredResults, measureContext, can } from '../state.js';
import { exportCSV } from '../core/io.js';
import { csvNumber } from '../core/csv.js';
import { offerFile } from '../ui/download.js';
import { groupResults } from '../core/calc.js';
import { todayISO } from '../core/dates.js';

export function leverResults(lever) {
  return filteredResults().filter((r) => r.lever === lever);
}

/** "Ajouter / Importer / Exporter" buttons for a collection page. */
export function collectionActions(collection, addLabel) {
  const editable = can('edit');
  return html`
    ${button({ label: 'Exporter', iconName: 'download', action: 'export', data: { collection } })}
    ${editable ? button({ label: 'Importer', iconName: 'upload', action: 'import-preset', data: { collection } }) : ''}
    ${editable ? button({ label: addLabel, iconName: 'plus', action: 'add-record', variant: 'primary', data: { collection } }) : ''}`;
}

export function rowOpen(collection, id) {
  return { class: 'clickable', 'data-action': 'open-record', 'data-collection': collection, 'data-id': id };
}

export function openButton(collection, id, label, sub) {
  return html`<button type="button" class="link-button cell-main" data-action="open-record" data-collection="${collection}" data-id="${id}">${label}</button>${sub ? html`<span class="cell-sub">${sub}</span>` : ''}`;
}

export function productLabel(result) {
  return openButton(result.lever, result.id, result.productName, result.product?.ean || '');
}

/** Bars spec: one category per group, segments per lever (or a single lever). */
export function barsByGroup(results, keyOf, labelOf, { levers, limit = 8 } = {}) {
  const m = measureContext();
  const groups = groupResults(results, keyOf, m.view, m.measure);
  const leverList = levers || Object.keys(LEVER_META);
  let shown = groups;
  if (groups.length > limit) {
    const head = groups.slice(0, limit - 1);
    const tail = groups.slice(limit - 1);
    const other = { key: '__other', value: 0, byLever: Object.fromEntries(leverList.map((l) => [l, 0])), results: [] };
    for (const g of tail) {
      other.value += g.value;
      for (const l of leverList) other.byLever[l] += g.byLever[l] || 0;
    }
    shown = [...head, other];
  }
  return {
    type: 'bars',
    series: leverList.map((lever) => ({ key: lever, label: LEVER_META[lever].label, className: LEVER_META[lever].series })),
    rows: shown.map((g) => ({
      label: g.key === '__other' ? `Autres (${groups.length - limit + 1})` : labelOf(g),
      values: Object.fromEntries(leverList.map((l) => [l, g.byLever[l] || 0])),
    })),
    format: m.format,
    formatLabel: m.compact,
  };
}

/** Computed columns appended to a lever export, for the current filters. */
export function resultColumns(resultsById) {
  const get = (path) => (record) => {
    const result = resultsById.get(record.id);
    if (!result) return '';
    return csvNumber(path(result), 2);
  };
  return [
    { header: 'Ventes manquées (UVC)', get: get((r) => r.units.gross) },
    { header: 'Perte nette industriel (UVC)', get: get((r) => r.units.mfg) },
    { header: 'Manque à gagner CA net industriel (€)', get: get((r) => r.mfg.revenue) },
    { header: 'Manque à gagner marge industriel (€)', get: get((r) => r.mfg.margin) },
    { header: 'Manque à gagner CA magasin TTC (€)', get: get((r) => r.retail.revenue) },
    { header: 'Manque à gagner marge enseigne (€)', get: get((r) => r.retail.margin) },
  ];
}

const FILE_NAMES = {
  products: 'produits',
  retailers: 'enseignes',
  stockouts: 'ruptures',
  promotions: 'operations',
  listings: 'nouveaux-produits',
  facings: 'facings',
};

export function exportCollection(collection) {
  let records = state.data[collection];
  let extra = [];
  if (LEVER_META[collection]) {
    const results = leverResults(collection);
    const byId = new Map(results.map((r) => [r.id, r]));
    records = records.filter((r) => byId.has(r.id));
    extra = resultColumns(byId);
  }
  const csv = exportCSV(collection, records, state.data, extra);
  offerFile(`gondole-${FILE_NAMES[collection]}-${todayISO()}.csv`, csv);
}
