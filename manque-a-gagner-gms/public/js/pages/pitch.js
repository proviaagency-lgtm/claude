// Argumentaire enseigne: a one-page brief for a retailer meeting, written from
// the retailer's side (shelf revenue, retailer margin) with the matching gain
// for the manufacturer.

import { html } from '../ui/dom.js';
import { button, emptyState, leverChip, LEVER_META } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/overlay.js';
import { copyText, isEmbedded } from '../ui/download.js';
import { state, windowedResults, currentWindow, PERIODS } from '../state.js';
import { LEVERS, STOCKOUT_CAUSES } from '../core/schema.js';
import { summarize, groupResults, groupActions } from '../core/calc.js';
import { fmtEuro, fmtUnits, fmtPct, fmtDate, fmtNumber, fmtDateLong } from '../core/format.js';

const local = { retailerId: '' };

export function presetPitch(retailerId) {
  local.retailerId = retailerId;
}

function pickRetailer() {
  const retailers = state.data.retailers;
  if (local.retailerId && retailers.some((r) => r.id === local.retailerId)) return local.retailerId;
  if (state.filters.retailerId) return state.filters.retailerId;
  const groups = groupResults(windowedResults().filter((r) => r.inWindow), (r) => r.retailerId, 'retail', 'revenue');
  return groups[0]?.key || retailers[0]?.id || '';
}

function periodText() {
  const win = currentWindow();
  if (win.from && win.to) return `du ${fmtDate(win.from)} au ${fmtDate(win.to)}`;
  if (win.from) return `depuis le ${fmtDate(win.from)}`;
  return 'sur l’ensemble de l’historique';
}

function analyse(retailerId) {
  const results = windowedResults().filter((r) => r.inWindow && r.retailerId === retailerId);
  const retail = summarize(results, 'retail', 'revenue');
  const retailMargin = summarize(results, 'retail', 'margin');
  const mfg = summarize(results, 'mfg', 'revenue');
  const actions = groupActions(results.filter((r) => r.retail.revenue > 0), (r) => r.retail.revenue).slice(0, 8);
  const stockouts = results.filter((r) => r.lever === 'stockouts');
  const causes = groupResults(stockouts, (r) => r.record.cause || 'autre', 'retail', 'revenue');
  const promos = results.filter((r) => r.lever === 'promotions');
  const targeted = promos.reduce((s, r) => s + r.details.targeted, 0);
  const active = promos.reduce((s, r) => s + Math.min(r.details.active, r.details.targeted), 0);
  const listings = results.filter((r) => r.lever === 'listings');
  const lTarget = listings.reduce((s, r) => s + r.details.target, 0);
  const lListed = listings.reduce((s, r) => s + Math.min(r.details.listed, r.details.target), 0);
  const tightShelves = results.filter((r) => r.lever === 'facings' && r.details.capacity?.statusCurrent === 'critical');
  return { results, retail, retailMargin, mfg, actions, causes, promo: { targeted, active }, listing: { target: lTarget, listed: lListed }, tightShelves };
}

function points(a) {
  const out = [];
  const topCause = a.causes[0];
  if (topCause && topCause.value > 0) {
    const label = STOCKOUT_CAUSES.find((c) => c.value === topCause.key)?.label.toLowerCase() || 'autre';
    out.push(`Première cause de rupture : ${label}, ${fmtEuro(topCause.value)} de CA TTC perdu.`);
  }
  if (a.promo.targeted) {
    out.push(`Implantation des opérations : ${fmtPct(a.promo.active / a.promo.targeted, 0)} des magasins prévus (${fmtNumber(a.promo.targeted - a.promo.active)} implantations manquantes).`);
  }
  if (a.listing.target) {
    out.push(`Distribution des innovations : ${fmtPct(a.listing.listed / a.listing.target, 0)} des magasins cibles les ont référencées.`);
  }
  if (a.tightShelves.length) {
    out.push(`${fmtNumber(a.tightShelves.length)} référence${a.tightShelves.length > 1 ? 's ont' : ' a'} un linéaire trop court pour tenir entre deux réassorts.`);
  }
  return out;
}

function summaryText(retailer, a) {
  const lines = [
    `Argumentaire ${retailer.name} – ${fmtDateLong(state.today)}`,
    `${state.orgName}`,
    '',
    `Manque à gagner identifié dans vos magasins ${periodText()} : ${fmtEuro(a.retail.total)} de CA TTC, dont ${fmtEuro(a.retailMargin.total)} de marge.`,
    '',
    'Répartition :',
    ...LEVERS.filter((l) => a.retail.byLever[l].count).map((l) => `- ${LEVER_META[l].label} : ${fmtEuro(a.retail.byLever[l].value)}`),
    '',
    'Nos propositions :',
    ...a.actions.map((g, i) => `${i + 1}. ${g.label} : +${fmtEuro(g.retail.revenue)} de CA TTC`),
  ];
  const notes = points(a);
  if (notes.length) lines.push('', 'Points d’attention :', ...notes.map((n) => `- ${n}`));
  return lines.join('\n').replace(/\u00a0/g, ' ');
}

export default {
  id: 'argumentaire',
  title: 'Argumentaire enseigne',
  subtitle: 'La synthèse à présenter en rendez-vous',

  handlers: {
    'pitch-select'(el, event, ctx) {
      local.retailerId = el.value;
      ctx.rerender();
    },
    async 'pitch-copy'() {
      const retailerId = pickRetailer();
      const retailer = state.data.retailers.find((r) => r.id === retailerId);
      if (!retailer) return;
      const ok = await copyText(summaryText(retailer, analyse(retailerId)));
      toast(ok ? 'Résumé copié : collez-le dans un e-mail.' : 'Copie impossible ici : sélectionnez le texte de la page.', { tone: ok ? 'info' : 'error' });
    },
    'pitch-print'() {
      window.print();
    },
  },

  render() {
    const retailerId = pickRetailer();
    const retailer = state.data.retailers.find((r) => r.id === retailerId);
    if (!retailer) {
      return html`<section class="card">${emptyState({ title: 'Aucune enseigne', text: 'Ajoutez une enseigne et ses données pour préparer un argumentaire.' })}</section>`;
    }
    const a = analyse(retailerId);
    const options = [...state.data.retailers].sort((x, y) => x.name.localeCompare(y.name, 'fr'));
    const notes = points(a);
    return html`
      <div class="filters no-print">
        <label class="filter"><span>Enseigne</span>
          <select id="pitch-retailer" data-action="pitch-select">${options.map((r) => html`<option value="${r.id}" ${r.id === retailerId ? 'selected' : ''}>${r.name}</option>`)}</select>
        </label>
        <label class="filter"><span>Période</span>
          <select id="pitch-period" data-action="filter" data-key="period">${PERIODS.filter(([key]) => key !== 'custom' || state.filters.period === 'custom').map(([value, text]) => html`<option value="${value}" ${state.filters.period === value ? 'selected' : ''}>${text}</option>`)}</select>
        </label>
        <div class="topbar-actions">
          ${button({ label: 'Copier le résumé', iconName: 'copy', action: 'pitch-copy' })}
          ${isEmbedded() ? '' : button({ label: 'Imprimer ou PDF', iconName: 'printer', action: 'pitch-print', variant: 'primary' })}
        </div>
      </div>
      <article class="card pitch">
        <header class="pitch-head">
          <div><span class="tag">Argumentaire</span><h2 style="margin-top:10px">${retailer.name}</h2></div>
          <div class="pitch-meta">${state.orgName}<br>${fmtDateLong(state.today)}${retailer.kam ? html`<br>Suivi : ${retailer.kam}` : ''}</div>
        </header>
        ${a.results.length ? html`
          <div class="pitch-key">
            <div class="kpi"><span class="kpi-label">CA TTC non réalisé dans vos magasins</span><span class="kpi-value">${fmtEuro(a.retail.total)}</span><span class="kpi-sub">${periodText()} pour les ruptures et opérations</span></div>
            <div class="kpi"><span class="kpi-label">Marge enseigne correspondante</span><span class="kpi-value">${fmtEuro(a.retailMargin.total)}</span><span class="kpi-sub">estimée sur nos prix nets</span></div>
            <div class="kpi"><span class="kpi-label">Volume en jeu</span><span class="kpi-value">${fmtUnits(a.results.reduce((s, r) => s + r.units.retail, 0))}</span><span class="kpi-sub">${fmtNumber(a.results.length)} ligne${a.results.length > 1 ? 's' : ''} d’analyse</span></div>
          </div>
          <div class="pitch-section">
            <h3>Où se situe le manque à gagner</h3>
            <div class="table-wrap"><table class="data">
              <thead><tr><th scope="col">Levier</th><th scope="col" class="right">CA magasin TTC</th><th scope="col" class="right">Marge enseigne</th><th scope="col" class="right">CA net industriel</th></tr></thead>
              <tbody>${LEVERS.filter((l) => a.retail.byLever[l].count).map((l) => html`<tr>
                <td>${leverChip(l)}</td>
                <td class="right num">${fmtEuro(a.retail.byLever[l].value)}</td>
                <td class="right num">${fmtEuro(a.retailMargin.byLever[l].value)}</td>
                <td class="right num">${fmtEuro(a.mfg.byLever[l].value)}</td></tr>`)}</tbody>
              <tfoot><tr><td>Total</td><td class="right num">${fmtEuro(a.retail.total)}</td><td class="right num">${fmtEuro(a.retailMargin.total)}</td><td class="right num">${fmtEuro(a.mfg.total)}</td></tr></tfoot>
            </table></div>
          </div>
          <div class="pitch-section">
            <h3>Nos propositions</h3>
            <div class="table-wrap"><table class="data">
              <thead><tr><th scope="col">Action</th><th scope="col" class="right">Gain enseigne (CA TTC)</th><th scope="col" class="right">Gain industriel (CA net)</th></tr></thead>
              <tbody>${a.actions.map((g, i) => html`<tr>
                <td><span class="cell-main">${i + 1}. ${g.label}</span><span class="cell-sub">${LEVER_META[g.lever].label}${g.results.length > 1 ? ` · ${g.results.length} lignes` : ''}</span></td>
                <td class="right num strong">+${fmtEuro(g.retail.revenue)}</td>
                <td class="right num">+${fmtEuro(g.mfg.revenue)}</td></tr>`)}</tbody>
            </table></div>
          </div>
          ${notes.length ? html`<div class="pitch-section"><h3>Points d’attention</h3>
            <ul class="warn-list">${notes.map((n) => html`<li class="warn-info">${icon('info')}<span>${n}</span></li>`)}</ul></div>` : ''}
          <div class="pitch-section"><p class="small muted">Méthode : ventes manquées calculées à partir des rotations, des jours et taux de rupture, de l’implantation des opérations et de la distribution des innovations.
            Pour l’enseigne, ${fmtPct((state.settings.oosSameItemOtherStore + state.settings.oosNoPurchase) / 100, 0)} des ventes manquées en rupture sont perdues (clients partis ailleurs ou ayant renoncé).
            Les facings sont chiffrés avec une élasticité de ${String(state.settings.shelfElasticity).replace('.', ',')} et les potentiels sur ${fmtNumber(state.settings.horizonWeeks)} semaines.</p></div>
        ` : html`<div class="pitch-section"><p class="pitch-text">Aucune donnée pour cette enseigne sur la période. Élargissez la période ou ajoutez des ruptures, opérations, référencements ou facings.</p></div>`}
      </article>`;
  },
};
