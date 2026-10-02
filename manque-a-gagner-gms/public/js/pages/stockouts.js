// Ruptures: sales missed while a reference is out of stock.

import { html } from '../ui/dom.js';
import { button, emptyState, kpis, chartToggle } from '../ui/components.js';
import { dataTable } from '../ui/table.js';
import { state, measureContext, can } from '../state.js';
import { STOCKOUT_CAUSES } from '../core/schema.js';
import { fmtUnits, fmtPct, fmtDate, fmtNumber, fmtDecimal } from '../core/format.js';
import { leverResults, collectionActions, rowOpen, productLabel } from './shared.js';
import { groupResults } from '../core/calc.js';

const causeLabel = (value) => STOCKOUT_CAUSES.find((c) => c.value === value)?.label || 'Autre ou inconnue';

function intensity(result) {
  const d = result.details;
  if (d.method === 'rate') return html`${fmtPct(d.rate)} de rupture<span class="cell-sub">${fmtUnits(d.soldUnits)} vendues</span>`;
  return html`${fmtNumber(d.days)} j × ${fmtNumber(d.stores)} mag.<span class="cell-sub">${fmtDecimal(d.rot, 1)} UVC / mag. / sem.</span>`;
}

function period(result) {
  const d = result.details;
  const r = result.record;
  if (d.method === 'event' && d.ongoing) return html`<span class="badge badge-critical">En cours</span><span class="cell-sub">depuis le ${fmtDate(r.startDate)}</span>`;
  return html`${fmtDate(r.startDate)}<span class="cell-sub">au ${fmtDate(r.endDate)}</span>`;
}

export default {
  id: 'ruptures',
  title: 'Ruptures',
  subtitle: 'Ventes manquées quand la référence est absente du rayon',
  filters: true,
  headerActions: () => collectionActions('stockouts', 'Déclarer une rupture'),

  render() {
    const results = leverResults('stockouts');
    if (!state.data.stockouts.length) {
      return html`<section class="card">${emptyState({
        title: 'Aucune rupture enregistrée',
        text: 'Déclarez une rupture constatée en magasin (jours × magasins), ou importez les taux de rupture fournis par les portails enseignes.',
        actions: can('edit') ? [
          button({ label: 'Déclarer une rupture', iconName: 'plus', action: 'add-record', variant: 'primary', data: { collection: 'stockouts' } }),
          button({ label: 'Importer un CSV', iconName: 'upload', action: 'import-preset', data: { collection: 'stockouts' } }),
        ] : [],
      })}</section>`;
    }
    const m = measureContext();
    const total = results.reduce((s, r) => s + m.value(r), 0);
    const grossUnits = results.reduce((s, r) => s + r.units.gross, 0);
    const netUnits = results.reduce((s, r) => s + r.units[m.view], 0);
    const ongoing = results.filter((r) => r.details.method === 'event' && r.details.ongoing).length;
    const recovered = grossUnits > 0 ? 1 - netUnits / grossUnits : 0;

    const columns = [
      { key: 'product', label: 'Produit', sort: (r) => r.productName, render: productLabel },
      { key: 'retailer', label: 'Enseigne', sort: (r) => r.retailerName, render: (r) => html`${r.retailerName}${r.record.store ? html`<span class="cell-sub">${r.record.store}</span>` : ''}` },
      { key: 'period', label: 'Période', sort: (r) => r.record.startDate, render: period },
      { key: 'intensity', label: 'Mesure', render: intensity },
      { key: 'cause', label: 'Cause', sort: (r) => causeLabel(r.record.cause), render: (r) => causeLabel(r.record.cause) },
      { key: 'gross', label: 'Ventes manquées', align: 'right', sort: (r) => r.units.gross, render: (r) => html`<span class="num">${fmtUnits(r.units.gross)}</span>` },
      { key: 'value', label: m.label, align: 'right', sort: (r) => m.value(r), render: (r) => html`<span class="num strong">${m.format(m.value(r))}</span>` },
    ];

    return html`
      ${kpis([
        { label: `Manque à gagner net · ${m.label}`, value: m.compact(total), sub: `${fmtNumber(results.length)} ligne${results.length > 1 ? 's' : ''} sur la période` },
        { label: 'Ventes manquées en rayon', value: fmtUnits(grossUnits, { compact: true }), sub: 'avant report des clients' },
        { label: 'Récupéré par le report', value: fmtPct(recovered, 0), sub: m.view === 'mfg' ? 'achat dans un autre magasin, d’une autre référence de la marque ou plus tard' : 'achat d’une autre marque, d’une autre référence ou plus tard' },
        { label: 'Ruptures en cours', value: fmtNumber(ongoing), sub: ongoing ? 'à traiter en priorité' : 'aucune rupture ouverte' },
      ])}
      <div class="grid">
        <section class="card span-6">
          <div class="card-head"><div><h2>Par cause</h2><p>${m.label} perdu</p></div>
            <div class="card-tools">${chartToggle('causes')}</div></div>
          <div class="card-body"><div class="chart" data-chart="causes"></div></div>
        </section>
        <section class="card span-6">
          <div class="card-head"><div><h2>Par enseigne</h2><p>${m.label} perdu</p></div>
            <div class="card-tools">${chartToggle('retailers')}</div></div>
          <div class="card-body"><div class="chart" data-chart="retailers"></div></div>
        </section>
      </div>
      <section class="card">
        ${dataTable({
          key: 'stockouts',
          columns,
          rows: results,
          search: (r) => `${r.productName} ${r.product?.ean || ''} ${r.retailerName} ${r.record.store || ''} ${causeLabel(r.record.cause)}`,
          rowAttrs: (r) => rowOpen('stockouts', r.id),
          defaultSort: { sortKey: 'value', sortDir: 'desc' },
          empty: 'Aucune rupture pour ces filtres.',
        })}
      </section>`;
  },

  charts() {
    const m = measureContext();
    const results = leverResults('stockouts');
    const spec = (groups, categoryLabel) => ({
      type: 'bars',
      categoryLabel,
      series: [{ key: 'v', label: m.label, className: 'series-1' }],
      rows: groups.map((g) => ({ label: g.label, values: { v: g.value } })),
      format: m.format,
      formatLabel: m.compact,
    });
    const causes = groupResults(results, (r) => r.record.cause || 'autre', m.view, m.measure)
      .map((g) => ({ label: causeLabel(g.key), value: g.value }));
    const retailers = groupResults(results, (r) => r.retailerId, m.view, m.measure)
      .slice(0, 8)
      .map((g) => ({ label: g.results[0].retailerName, value: g.value }));
    return { causes: spec(causes, 'Cause'), retailers: spec(retailers, 'Enseigne') };
  },
};
