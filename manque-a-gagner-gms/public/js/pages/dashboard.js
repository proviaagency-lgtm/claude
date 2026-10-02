// Tableau de bord: the total "manque à gagner", its split by lever, where it
// sits (retailers, ranges, months) and the actions worth the most.

import { html } from '../ui/dom.js';
import { button, emptyState, leverKey, LEVER_META, shareOf, chartToggle } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { state, filteredResults, measureContext, currentWindow, can } from '../state.js';
import { summarize, monthlyStockouts, groupActions } from '../core/calc.js';
import { LEVERS } from '../core/schema.js';
import { fmtEuro, fmtUnits, fmtMonth, fmtNumber, fmtDate } from '../core/format.js';
import { monthKey } from '../core/dates.js';
import { barsByGroup } from './shared.js';

function periodText() {
  const win = currentWindow();
  if (win.from && win.to) return `du ${fmtDate(win.from)} au ${fmtDate(win.to)}`;
  if (win.from) return `depuis le ${fmtDate(win.from)}, opérations prévues comprises`;
  if (win.to) return `jusqu’au ${fmtDate(win.to)}`;
  return 'sur tout l’historique';
}

/** Months for the stock-out chart: the window, capped at the current month, 24 at most. */
function monthsToShow() {
  const win = currentWindow();
  const todayMonth = monthKey(state.today);
  const end = win.to && monthKey(win.to) < todayMonth ? monthKey(win.to) : todayMonth;
  const start = win.from ? monthKey(win.from) : null;
  const [ey, em] = end.split('-').map(Number);
  const months = [];
  for (let i = 0; i < 24; i += 1) {
    const key = new Date(Date.UTC(ey, em - 1 - i, 1)).toISOString().slice(0, 7);
    if (start && key < start) break;
    months.unshift(key);
    if (!start && months.length === 12) break;
  }
  return months;
}

function secondaryFigure(results, m) {
  const sum = (key) => results.reduce((s, r) => s + r[m.view][key], 0);
  const revenueLabel = m.view === 'mfg' ? 'CA net industriel' : 'CA magasin TTC';
  const marginLabel = m.view === 'mfg' ? 'marge brute industriel' : 'marge enseigne';
  if (m.measure === 'revenue') return html`dont <strong>${fmtEuro(sum('margin'), { compact: true })}</strong> de ${marginLabel}`;
  if (m.measure === 'margin') return html`sur <strong>${fmtEuro(sum('revenue'), { compact: true })}</strong> de ${revenueLabel}`;
  return html`soit <strong>${fmtEuro(sum('revenue'), { compact: true })}</strong> de ${revenueLabel}`;
}

function welcome() {
  const actions = [];
  if (can('admin')) actions.push(button({ label: 'Charger les données de démonstration', iconName: 'refresh', action: 'load-demo', variant: 'primary' }));
  if (can('edit')) {
    actions.push(button({ label: 'Importer un fichier CSV', iconName: 'upload', action: 'go', data: { route: 'import' } }));
    actions.push(button({ label: 'Ajouter un produit', iconName: 'plus', action: 'add-record', data: { collection: 'products' } }));
  }
  return html`<section class="card">${emptyState({
    title: 'Votre espace est prêt',
    text: 'Commencez par vos produits et vos enseignes, puis renseignez les ruptures, opérations, référencements et facings : '
      + 'le manque à gagner se calcule au fil de la saisie. Les données de démonstration montrent un exemple complet.',
    actions,
  })}</section>`;
}

function noMatch() {
  return html`<section class="card">${emptyState({
    title: 'Aucun résultat pour ces filtres',
    text: 'Élargissez la période ou retirez le filtre enseigne ou marque.',
    actions: [button({ label: 'Réinitialiser les filtres', iconName: 'refresh', action: 'reset-filters' })],
  })}</section>`;
}

function chartCard({ key, title, subtitle, className }) {
  return html`<section class="card ${className}">
    <div class="card-head"><div><h2>${title}</h2><p>${subtitle}</p></div><div class="card-tools">${chartToggle(key)}</div></div>
    <div class="card-body"><div class="chart" data-chart="${key}"></div></div>
  </section>`;
}

export default {
  id: 'tableau-de-bord',
  title: 'Tableau de bord',
  filters: true,

  render() {
    if (!LEVERS.some((l) => state.data[l].length)) return welcome();
    const results = filteredResults();
    if (!results.length) return noMatch();
    const m = measureContext();
    const summary = summarize(results, m.view, m.measure);
    const positive = LEVERS.map((l) => Math.max(0, summary.byLever[l].value));
    const positiveTotal = positive.reduce((a, b) => a + b, 0);
    const top = groupActions(results.filter((r) => m.value(r) > 0), m.value).slice(0, 8);

    return html`
      <section class="card summary" aria-labelledby="hero-label">
        <div>
          <span class="tag" id="hero-label">Manque à gagner identifié</span>
          <div class="hero-figure">${m.measure === 'units' ? fmtUnits(summary.total) : fmtEuro(summary.total)}</div>
          <p class="hero-caption">${m.label}, ${secondaryFigure(results, m)}. Ruptures et opérations ${periodText()} ; nouveaux produits et facings en potentiel sur ${fmtNumber(state.settings.horizonWeeks)} semaines.</p>
        </div>
        <div>
          <div class="share-bar" role="img" aria-label="Répartition du manque à gagner par levier">
            ${LEVERS.map((lever, i) => (positive[i] > 0 ? html`<span class="${LEVER_META[lever].series}" style="flex:${positive[i]}" data-tip="${JSON.stringify({ value: m.format(summary.byLever[lever].value), title: LEVER_META[lever].label, rows: [{ text: `${shareOf(positive[i], positiveTotal)} du total` }] })}"></span>` : ''))}
          </div>
          <div class="lever-legend">
            ${LEVERS.map((lever, i) => html`
              <a class="lever-stat" href="#${LEVER_META[lever].route}">
                <span class="lever-name">${leverKey(lever)}${LEVER_META[lever].label}</span>
                <span class="lever-value">${m.compact(summary.byLever[lever].value)}</span>
                <span class="lever-meta">${shareOf(positive[i], positiveTotal)} · ${fmtNumber(summary.byLever[lever].count)} ligne${summary.byLever[lever].count > 1 ? 's' : ''}</span>
              </a>`)}
          </div>
        </div>
      </section>

      <div class="grid">
        ${chartCard({ key: 'retailers', title: 'Par enseigne', subtitle: `${m.label}, réparti par levier`, className: 'span-7' })}
        <section class="card span-5 row-span-2">
          <div class="card-head"><div><h2>Plan d’action prioritaire</h2><p>Les actions qui pèsent le plus, tous leviers confondus</p></div></div>
          <div class="card-body">
            <ol class="action-list">${top.map((g) => html`<li>
              <button type="button" class="action-item" data-action="open-record" data-collection="${g.lever}" data-id="${g.results[0].id}">
                <span class="action-title">${g.label}</span>
                <span class="action-value">${m.compact(g.value)}</span>
                <span class="action-meta">${leverKey(g.lever)}${LEVER_META[g.lever].label} · ${g.retailerName}${g.results.length > 1 ? ` · ${g.results.length} lignes` : ''}</span>
              </button></li>`)}</ol>
          </div>
          <div class="card-foot"><a href="#argumentaire" class="link-button">Préparer l’argumentaire d’une enseigne</a> ${icon('arrow')}</div>
        </section>
        ${chartCard({ key: 'categories', title: 'Par gamme', subtitle: `${m.label}, réparti par levier`, className: 'span-7' })}
        ${chartCard({ key: 'months', title: 'Ruptures mois par mois', subtitle: `${m.label} perdu, réparti selon les jours de rupture`, className: 'span-12' })}
      </div>`;
  },

  charts() {
    const results = filteredResults();
    if (!results.length) return {};
    const m = measureContext();
    return {
      retailers: { ...barsByGroup(results, (r) => r.retailerId, (g) => g.results[0].retailerName), categoryLabel: 'Enseigne' },
      categories: { ...barsByGroup(results, (r) => r.category || 'Sans gamme', (g) => g.key, { limit: 6 }), categoryLabel: 'Gamme' },
      months: {
        type: 'columns',
        className: 'series-1',
        unit: m.measure === 'units' ? 'units' : 'euro',
        points: monthlyStockouts(results, m.view, m.measure, monthsToShow(), currentWindow()).map((p) => ({
          label: fmtMonth(p.month),
          title: fmtMonth(p.month, { short: false }),
          value: p.value,
        })),
        format: m.format,
        formatLabel: m.compact,
        axisLabel: 'Mois',
        valueLabel: m.label,
      },
    };
  },
};
