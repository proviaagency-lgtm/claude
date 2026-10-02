// Facings: sales gained by widening a product's shelf space, with a check of
// whether the current shelf can hold the sales between two replenishments.

import { html } from '../ui/dom.js';
import { button, emptyState, kpis, chartToggle } from '../ui/components.js';
import { dataTable } from '../ui/table.js';
import { shelfBadge } from '../ui/previews.js';
import { state, measureContext, can } from '../state.js';
import { fmtPct, fmtNumber } from '../core/format.js';
import { groupResults } from '../core/calc.js';
import { leverResults, collectionActions, rowOpen, productLabel } from './shared.js';

const STATUS_ORDER = { critical: 0, warning: 1, good: 2 };

export default {
  id: 'facings',
  title: 'Facings',
  subtitle: 'Ventes gagnées en élargissant le linéaire',
  filters: true,
  headerActions: () => collectionActions('facings', 'Simuler des facings'),

  render() {
    if (!state.data.facings.length) {
      return html`<section class="card">${emptyState({
        title: 'Aucun scénario de facings',
        text: 'Indiquez les facings actuels et proposés d’une référence dans une enseigne : le gain se calcule avec l’élasticité au linéaire, et la capacité du rayon est comparée aux ventes entre deux réassorts.',
        actions: can('edit') ? [
          button({ label: 'Simuler des facings', iconName: 'plus', action: 'add-record', variant: 'primary', data: { collection: 'facings' } }),
          button({ label: 'Importer un CSV', iconName: 'upload', action: 'import-preset', data: { collection: 'facings' } }),
        ] : [],
      })}</section>`;
    }
    const m = measureContext();
    const results = leverResults('facings');
    const total = results.reduce((s, r) => s + m.value(r), 0);
    const added = results.reduce((s, r) => s + Math.max(0, r.details.proposed - r.details.current) * r.details.stores, 0);
    const critical = results.filter((r) => r.details.capacity?.statusCurrent === 'critical').length;
    const base = results.reduce((s, r) => s + r.details.baseUnits, 0);
    const gain = results.reduce((s, r) => s + r.units.mfg, 0);

    const columns = [
      { key: 'product', label: 'Produit', sort: (r) => r.productName, render: productLabel },
      { key: 'retailer', label: 'Enseigne', sort: (r) => r.retailerName, render: (r) => html`${r.retailerName}<span class="cell-sub">${fmtNumber(r.details.stores)} magasins</span>` },
      { key: 'facings', label: 'Facings', align: 'right', sort: (r) => r.details.proposed - r.details.current, render: (r) => html`<span class="num strong">${fmtNumber(r.details.current)} → ${fmtNumber(r.details.proposed)}</span>` },
      { key: 'uplift', label: 'Hausse des ventes', align: 'right', sort: (r) => (r.details.baseUnits ? r.units.mfg / r.details.baseUnits : 0), render: (r) => html`<span class="num">+${fmtPct(r.details.baseUnits ? r.units.mfg / r.details.baseUnits : 0)}</span>${r.details.oosUnits ? html`<span class="cell-sub">dont moins de ruptures</span>` : ''}` },
      {
        key: 'shelf',
        label: 'Couverture actuelle',
        sort: (r) => (r.details.capacity ? STATUS_ORDER[r.details.capacity.statusCurrent] : null),
        render: (r) => (r.details.capacity ? shelfBadge(r.details.capacity.statusCurrent, r.details.capacity.coverageCurrent) : html`<span class="muted">Capacité non renseignée</span>`),
      },
      {
        key: 'pdl',
        label: 'PDM / PDL',
        render: (r) => (r.details.shelfShare
          ? html`<span class="num">${fmtPct(r.details.shelfShare.pdm, 0)} / ${fmtPct(r.details.shelfShare.pdl, 0)}</span><span class="cell-sub">${fmtNumber(r.details.shelfShare.facingsAtPdm)} facings à parité</span>`
          : html`<span class="muted">—</span>`),
      },
      { key: 'value', label: m.label, align: 'right', sort: (r) => m.value(r), render: (r) => html`<span class="num strong">${m.format(m.value(r))}</span>` },
    ];

    return html`
      ${kpis([
        { label: `Gain potentiel · ${m.label}`, value: m.compact(total), sub: `sur ${fmtNumber(state.settings.horizonWeeks)} semaines par défaut` },
        { label: 'Hausse moyenne des ventes', value: `+${fmtPct(base ? gain / base : 0)}`, sub: `élasticité de ${String(state.settings.shelfElasticity).replace('.', ',')} par défaut` },
        { label: 'Facings à ajouter', value: fmtNumber(added), sub: 'tous magasins confondus' },
        { label: 'Rayons sous-dimensionnés', value: fmtNumber(critical), sub: critical ? 'capacité inférieure aux ventes entre deux réassorts' : 'aucun rayon en rupture probable' },
      ])}
      <section class="card">
        <div class="card-head"><div><h2>Par enseigne</h2><p>${m.label} gagné</p></div>
          <div class="card-tools">${chartToggle('retailers')}</div></div>
        <div class="card-body"><div class="chart" data-chart="retailers"></div></div>
      </section>
      <section class="card">
        ${dataTable({
          key: 'facings',
          columns,
          rows: results,
          search: (r) => `${r.productName} ${r.product?.ean || ''} ${r.retailerName}`,
          rowAttrs: (r) => rowOpen('facings', r.id),
          defaultSort: { sortKey: 'value', sortDir: 'desc' },
          empty: 'Aucun scénario pour ces filtres.',
        })}
      </section>`;
  },

  charts() {
    const m = measureContext();
    const groups = groupResults(leverResults('facings'), (r) => r.retailerId, m.view, m.measure).slice(0, 8);
    return {
      retailers: {
        type: 'bars',
        categoryLabel: 'Enseigne',
        series: [{ key: 'v', label: m.label, className: 'series-4' }],
        rows: groups.map((g) => ({ label: g.results[0].retailerName, values: { v: g.value } })),
        format: m.format,
        formatLabel: m.compact,
      },
    };
  },
};
