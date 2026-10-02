// Nouveaux produits: sales missed in target stores that have not listed an
// innovation yet, and through late shelf launches.

import { html } from '../ui/dom.js';
import { button, emptyState, kpis, meter, badge, chartToggle } from '../ui/components.js';
import { dataTable } from '../ui/table.js';
import { state, measureContext, can } from '../state.js';
import { fmtPct, fmtDate, fmtNumber, fmtDecimal, fmtEuro } from '../core/format.js';
import { groupResults } from '../core/calc.js';
import { leverResults, collectionActions, rowOpen, productLabel } from './shared.js';

function roiBadge(roi) {
  if (roi === null) return html`<span class="muted">—</span>`;
  if (roi < 0) return badge('critical', fmtPct(roi, 0));
  if (roi < 1) return badge('warning', `+${fmtPct(roi, 0)}`);
  return badge('good', `+${fmtPct(roi, 0)}`);
}

export default {
  id: 'nouveaux-produits',
  title: 'Nouveaux produits',
  subtitle: 'Ventes manquées tant que l’innovation n’est pas référencée partout',
  filters: true,
  headerActions: () => collectionActions('listings', 'Ajouter un référencement'),

  render() {
    if (!state.data.listings.length) {
      return html`<section class="card">${emptyState({
        title: 'Aucun référencement suivi',
        text: 'Pour chaque innovation et chaque enseigne, indiquez le nombre de magasins cibles et le nombre de magasins qui l’ont référencée : la DN manquante est chiffrée sur l’horizon des hypothèses.',
        actions: can('edit') ? [
          button({ label: 'Ajouter un référencement', iconName: 'plus', action: 'add-record', variant: 'primary', data: { collection: 'listings' } }),
          button({ label: 'Importer un CSV', iconName: 'upload', action: 'import-preset', data: { collection: 'listings' } }),
        ] : [],
      })}</section>`;
    }
    const m = measureContext();
    const results = leverResults('listings');
    const total = results.reduce((s, r) => s + m.value(r), 0);
    const missing = results.reduce((s, r) => s + r.details.missing, 0);
    const target = results.reduce((s, r) => s + r.details.target, 0);
    const listed = results.reduce((s, r) => s + Math.min(r.details.listed, r.details.target), 0);
    const potential = results.reduce((s, r) => s + r.details.potential.mfgRevenue, 0);
    const delayed = results.filter((r) => r.details.delayWeeks > 0).length;

    const columns = [
      { key: 'product', label: 'Produit', sort: (r) => r.productName, render: (r) => html`${productLabel(r)}${r.product?.status === 'innovation' ? html` <span class="chip">Innovation</span>` : ''}` },
      { key: 'retailer', label: 'Enseigne', sort: (r) => r.retailerName, render: (r) => html`${r.retailerName}<span class="cell-sub">${r.record.launchDate ? `implantation ${fmtDate(r.record.launchDate)}` : 'date non renseignée'}</span>` },
      { key: 'dn', label: 'Distribution', sort: (r) => r.details.dn, render: (r) => meter(r.details.dn ?? 0, `${fmtNumber(r.details.listed)} / ${fmtNumber(r.details.target)} mag. · DN ${fmtPct(r.details.dn ?? 0, 0)}`) },
      { key: 'rot', label: 'Rotation cible', align: 'right', sort: (r) => r.details.rot, render: (r) => html`<span class="num">${fmtDecimal(r.details.rot, 1)}</span><span class="cell-sub">UVC / mag. / sem.</span>` },
      { key: 'delay', label: 'Retard', align: 'right', sort: (r) => r.details.delayWeeks, render: (r) => r.details.delayWeeks > 0 ? badge('warning', `${fmtDecimal(r.details.delayWeeks, 1)} sem.`) : html`<span class="muted">—</span>` },
      { key: 'roi', label: 'Retour sur coût', align: 'right', sort: (r) => r.details.roi, render: (r) => roiBadge(r.details.roi) },
      { key: 'value', label: m.label, align: 'right', sort: (r) => m.value(r), render: (r) => html`<span class="num strong">${m.format(m.value(r))}</span>` },
    ];

    return html`
      ${kpis([
        { label: `Manque à gagner · ${m.label}`, value: m.compact(total), sub: `net de cannibalisation, sur ${fmtNumber(state.settings.horizonWeeks)} semaines par défaut` },
        { label: 'Magasins à conquérir', value: fmtNumber(missing), sub: `sur ${fmtNumber(target)} magasins cibles` },
        { label: 'Distribution numérique', value: fmtPct(target ? listed / target : 0, 0), sub: delayed ? `${fmtNumber(delayed)} implantation${delayed > 1 ? 's' : ''} en retard` : 'aucun retard déclaré' },
        { label: 'Potentiel à 100 % de DN', value: fmtEuro(potential, { compact: true }), sub: 'CA net industriel sur l’horizon' },
      ])}
      <section class="card">
        <div class="card-head"><div><h2>Par produit</h2><p>${m.label} manqué</p></div>
          <div class="card-tools">${chartToggle('products')}</div></div>
        <div class="card-body"><div class="chart" data-chart="products"></div></div>
      </section>
      <section class="card">
        ${dataTable({
          key: 'listings',
          columns,
          rows: results,
          search: (r) => `${r.productName} ${r.product?.ean || ''} ${r.retailerName}`,
          rowAttrs: (r) => rowOpen('listings', r.id),
          defaultSort: { sortKey: 'value', sortDir: 'desc' },
          empty: 'Aucun référencement pour ces filtres.',
        })}
      </section>`;
  },

  charts() {
    const m = measureContext();
    const groups = groupResults(leverResults('listings'), (r) => r.productId, m.view, m.measure).slice(0, 8);
    return {
      products: {
        type: 'bars',
        categoryLabel: 'Produit',
        series: [{ key: 'v', label: m.label, className: 'series-3' }],
        rows: groups.map((g) => ({ label: g.results[0].productName, values: { v: g.value } })),
        format: m.format,
        formatLabel: m.compact,
      },
    };
  },
};
