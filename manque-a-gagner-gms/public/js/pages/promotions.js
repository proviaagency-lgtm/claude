// Opérations: incremental promo sales lost through stores that did not
// implement the operation and through out-of-stocks during it.

import { html } from '../ui/dom.js';
import { button, emptyState, kpis, meter, badge, chartToggle } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { state, measureContext, can } from '../state.js';
import { PROMO_MECHANICS } from '../core/schema.js';
import { fmtPct, fmtDate, fmtNumber, fmtDecimal, fmtPercentValue } from '../core/format.js';
import { toDayNumber } from '../core/dates.js';
import { leverResults, collectionActions, openButton } from './shared.js';

const mechanicLabel = (value) => PROMO_MECHANICS.find((m) => m.value === value)?.label || 'Autre';

/** Value of one component (non-implementation or out-of-stock) in the current measure. */
function part(result, which, m) {
  const d = result.details[which];
  if (m.measure === 'units') {
    if (which === 'nonImplementation') return d.units;
    return m.view === 'mfg' ? d.unitsMfg : d.unitsRetail;
  }
  const key = `${m.view}${m.measure === 'revenue' ? 'Revenue' : 'Margin'}`;
  return d[key];
}

function status(record, today) {
  const t = toDayNumber(today);
  if (toDayNumber(record.startDate) > t) return badge('info', 'À venir');
  if (toDayNumber(record.endDate) < t) return badge('neutral', 'Terminée');
  return badge('good', 'En cours');
}

function groupOperations(results) {
  const groups = new Map();
  for (const r of results) {
    const key = `${r.record.name}|${r.retailerId}|${r.record.startDate}`;
    if (!groups.has(key)) groups.set(key, { key, name: r.record.name, results: [] });
    groups.get(key).results.push(r);
  }
  return [...groups.values()];
}

export default {
  id: 'operations',
  title: 'Opérations',
  subtitle: 'Volume promo perdu par non-implantation et ruptures',
  filters: true,
  headerActions: () => collectionActions('promotions', 'Ajouter une ligne'),

  render() {
    if (!state.data.promotions.length) {
      return html`<section class="card">${emptyState({
        title: 'Aucune opération enregistrée',
        text: 'Ajoutez une ligne par produit et par opération : magasins prévus, magasins ayant implanté, coefficient promo et jours de rupture. Le manque à gagner apparaît pendant la saisie.',
        actions: can('edit') ? [
          button({ label: 'Ajouter une ligne', iconName: 'plus', action: 'add-record', variant: 'primary', data: { collection: 'promotions' } }),
          button({ label: 'Importer un CSV', iconName: 'upload', action: 'import-preset', data: { collection: 'promotions' } }),
        ] : [],
      })}</section>`;
    }
    const m = measureContext();
    const results = leverResults('promotions');
    const total = results.reduce((s, r) => s + m.value(r), 0);
    const ni = results.reduce((s, r) => s + part(r, 'nonImplementation', m), 0);
    const oos = results.reduce((s, r) => s + part(r, 'outOfStock', m), 0);
    const targeted = results.reduce((s, r) => s + r.details.targeted, 0);
    const active = results.reduce((s, r) => s + Math.min(r.details.active, r.details.targeted), 0);
    const unprofitable = results.filter((r) => r.details.potential.incrementalUnits > 0 && r.details.potential.incrementalMfgMargin < 0).length;
    const groups = groupOperations(results).sort((a, b) => b.results.reduce((s, r) => s + m.value(r), 0) - a.results.reduce((s, r) => s + m.value(r), 0));

    const body = groups.map((g) => {
      const first = g.results[0];
      const sum = (fn) => g.results.reduce((s, r) => s + fn(r), 0);
      const gTargeted = sum((r) => r.details.targeted);
      const gActive = sum((r) => Math.min(r.details.active, r.details.targeted));
      return html`
        <tr class="group">
          <td colspan="2">${g.name}<span class="cell-sub">${first.retailerName} · ${mechanicLabel(first.record.mechanic)} · du ${fmtDate(first.record.startDate)} au ${fmtDate(first.record.endDate)}</span></td>
          <td>${status(first.record, state.today)}</td>
          <td>${meter(gTargeted ? gActive / gTargeted : 0, `${fmtPct(gTargeted ? gActive / gTargeted : 0, 0)} implantée`)}</td>
          <td class="right num">${m.format(sum((r) => part(r, 'nonImplementation', m)))}</td>
          <td class="right num">${m.format(sum((r) => part(r, 'outOfStock', m)))}</td>
          <td class="right num strong">${m.format(sum((r) => m.value(r)))}</td>
        </tr>
        ${g.results.map((r) => {
          const d = r.details;
          const alerts = r.warnings.filter((w) => w.level !== 'info');
          return html`<tr class="clickable" data-action="open-record" data-collection="promotions" data-id="${r.id}">
            <td>${openButton('promotions', r.id, r.productName, r.product?.ean || '')}</td>
            <td><span class="num">${fmtPercentValue(r.record.discountPct ?? 0, 0)} · ×${fmtDecimal(d.uplift, 1)}</span><span class="cell-sub">remise · coefficient</span></td>
            <td>${alerts.length ? html`<span class="badge badge-warning" data-tip="${JSON.stringify({ value: `${alerts.length} alerte${alerts.length > 1 ? 's' : ''}`, rows: alerts.map((w) => ({ text: w.message })) })}" tabindex="0">${icon('alert')}${alerts.length > 1 ? `${alerts.length} alertes` : 'Alerte'}</span>` : ''}</td>
            <td>${meter(d.implantationRate ?? 0, `${fmtNumber(d.active)} / ${fmtNumber(d.targeted)} mag.`)}</td>
            <td class="right num">${m.format(part(r, 'nonImplementation', m))}</td>
            <td class="right num">${m.format(part(r, 'outOfStock', m))}<span class="cell-sub">${fmtDecimal(d.oosDays, 1)} j de rupture</span></td>
            <td class="right num strong">${m.format(m.value(r))}</td>
          </tr>`;
        })}`;
    });

    return html`
      ${kpis([
        { label: `Manque à gagner · ${m.label}`, value: m.compact(total), sub: `${fmtNumber(groups.length)} opération${groups.length > 1 ? 's' : ''}, ${fmtNumber(results.length)} ligne${results.length > 1 ? 's' : ''}` },
        { label: 'Non-implantation', value: m.compact(ni), sub: `${fmtNumber(Math.max(0, targeted - active))} implantations manquantes` },
        { label: 'Ruptures pendant les opérations', value: m.compact(oos), sub: 'dans les magasins qui ont implanté' },
        { label: 'Taux d’implantation', value: fmtPct(targeted ? active / targeted : 0, 0), sub: unprofitable ? `${fmtNumber(unprofitable)} ligne${unprofitable > 1 ? 's' : ''} non rentable${unprofitable > 1 ? 's' : ''} en marge` : 'toutes les lignes sont rentables' },
      ])}
      <section class="card">
        <div class="card-head"><div><h2>Par opération</h2><p>Non-implantation et ruptures · ${m.label}</p></div>
          <div class="card-tools">${chartToggle('operations')}</div></div>
        <div class="card-body"><div class="chart" data-chart="operations"></div></div>
      </section>
      <section class="card">
        <div class="table-tools"><span class="table-count">${fmtNumber(results.length)} ligne${results.length > 1 ? 's' : ''} sur la période</span></div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th scope="col">Opération · produit</th><th scope="col">Mécanique</th><th scope="col">Statut</th><th scope="col">Implantation</th>
              <th scope="col" class="right">Non-implantation</th><th scope="col" class="right">Ruptures</th><th scope="col" class="right">${m.label}</th>
            </tr></thead>
            <tbody>${body.length ? body : html`<tr><td colspan="7" class="muted">Aucune opération sur la période.</td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
  },

  charts() {
    const m = measureContext();
    const groups = groupOperations(leverResults('promotions'));
    const rows = groups.map((g) => ({
      label: `${g.name} · ${g.results[0].retailerName}`,
      values: {
        ni: g.results.reduce((s, r) => s + part(r, 'nonImplementation', m), 0),
        oos: g.results.reduce((s, r) => s + part(r, 'outOfStock', m), 0),
      },
    })).sort((a, b) => (b.values.ni + b.values.oos) - (a.values.ni + a.values.oos)).slice(0, 10);
    return {
      operations: {
        type: 'bars',
        categoryLabel: 'Opération',
        series: [
          { key: 'ni', label: 'Non-implantation', className: 'series-2' },
          { key: 'oos', label: 'Ruptures pendant l’opération', className: 'series-1' },
        ],
        rows,
        format: m.format,
        formatLabel: m.compact,
      },
    };
  },
};
