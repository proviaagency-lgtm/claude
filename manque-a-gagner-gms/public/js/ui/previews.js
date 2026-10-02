// Live result panels shown beside record forms.

import { html } from './dom.js';
import { icon } from './icons.js';
import { badge, warningList, meter } from './components.js';
import { fmtEuro, fmtUnits, fmtPct, fmtPrice, fmtDecimal, fmtNumber } from '../core/format.js';

function rows(items) {
  return html`<dl class="preview-rows">${items.filter(Boolean).map(([label, value]) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`)}</dl>`;
}

function headline(label, value) {
  return html`<div><span class="kpi-label">${label}</span><div class="preview-figure">${value}</div></div>`;
}

const title = html`<h3>${icon('chart')}Résultat du calcul</h3>`;

export function stockoutPreview(res, settings) {
  const d = res.details;
  const how = d.method === 'rate'
    ? `${fmtPct(d.rate)} de rupture sur ${fmtUnits(d.soldUnits)} vendues.`
    : `${fmtNumber(d.days)} jour${d.days > 1 ? 's' : ''} × ${fmtNumber(d.stores)} magasin${d.stores > 1 ? 's' : ''} × ${fmtDecimal(d.rot)} UVC par semaine${d.ongoing ? ', rupture en cours' : ''}.`;
  const net = settings.applyOosBehavior
    ? `Après report des clients : ${fmtPct(res.units.mfg / (res.units.gross || 1), 0)} des ventes manquées sont perdues pour l’industriel, ${fmtPct(res.units.retail / (res.units.gross || 1), 0)} pour l’enseigne.`
    : 'Report des clients désactivé dans les hypothèses : 100 % des ventes manquées sont perdues.';
  return html`${title}
    ${headline('Manque à gagner net industriel', fmtEuro(res.mfg.revenue))}
    ${rows([
      ['Ventes manquées', fmtUnits(res.units.gross)],
      ['Perdues pour l’industriel', fmtUnits(res.units.mfg)],
      ['Marge brute industriel', fmtEuro(res.mfg.margin)],
      ['CA magasin TTC perdu', fmtEuro(res.retail.revenue)],
      ['Marge enseigne perdue', fmtEuro(res.retail.margin)],
    ])}
    <p class="preview-note">${how} ${net}</p>
    ${warningList(res.warnings)}`;
}

export function promotionPreview(res) {
  const d = res.details;
  const ni = d.nonImplementation;
  const oos = d.outOfStock;
  return html`${title}
    ${headline('Manque à gagner net industriel', fmtEuro(res.mfg.revenue))}
    ${d.targeted ? meter(d.implantationRate, `${fmtNumber(d.active)} / ${fmtNumber(d.targeted)} magasins implantés`) : ''}
    ${rows([
      [`Non-implantation (${fmtNumber(d.missing)} mag.)`, fmtEuro(ni.mfgRevenue)],
      ['Ruptures pendant l’opération', fmtEuro(oos.mfgRevenue)],
      ['Volume promo potentiel', fmtUnits(d.potential.units)],
      ['dont volume additionnel', fmtUnits(d.potential.incrementalUnits)],
      ['Prix net après financement', fmtPrice(d.promo.mfgRevenue)],
      ['Marge additionnelle de l’opération', fmtEuro(d.potential.incrementalMfgMargin)],
      d.achievement !== null && ['Taux de réalisation', fmtPct(d.achievement, 0)],
    ])}
    <p class="preview-note">${fmtNumber(d.days)} jours à ${fmtDecimal(d.promoRot, 1)} UVC par magasin et par semaine (rotation ${fmtDecimal(d.baseRot, 1)} × ${fmtDecimal(d.uplift, 1)}).</p>
    ${warningList(res.warnings)}`;
}

export function listingPreview(res) {
  const d = res.details;
  return html`${title}
    ${headline('Manque à gagner net industriel', fmtEuro(res.mfg.revenue))}
    ${d.target ? meter(d.dn, `DN ${fmtPct(d.dn, 0)} : ${fmtNumber(d.listed)} / ${fmtNumber(d.target)} magasins`) : ''}
    ${rows([
      ['Magasins à conquérir', fmtNumber(d.missing)],
      ['Ventes manquées (brutes)', fmtUnits(d.missingUnits)],
      d.delayUnits > 0 && ['dont retard d’implantation', fmtUnits(d.delayUnits)],
      ['Après cannibalisation', fmtUnits(res.units.mfg)],
      ['Potentiel total sur l’horizon', fmtEuro(d.potential.mfgRevenue)],
      d.roi !== null && ['Retour sur le coût de référencement', fmtPct(d.roi, 0)],
    ])}
    <p class="preview-note">${fmtDecimal(d.rot)} UVC par magasin et par semaine sur ${fmtNumber(d.weeks)} semaines, montée en charge de ${fmtNumber(d.rampWeeks)} semaines, cannibalisation de ${fmtPct(d.cannibalization, 0)}.</p>
    ${warningList(res.warnings)}`;
}

export const SHELF_STATUS = {
  critical: ['critical', 'Rupture probable'],
  warning: ['warning', 'Couverture juste'],
  good: ['good', 'Couverture suffisante'],
};

export function shelfBadge(status, coverage) {
  const [level, label] = SHELF_STATUS[status];
  return badge(level, `${label} · ${fmtDecimal(coverage, 1)} j`);
}

export function facingPreview(res) {
  const d = res.details;
  const cap = d.capacity;
  const share = d.shelfShare;
  return html`${title}
    ${headline('Gain potentiel net industriel', fmtEuro(res.mfg.revenue))}
    ${rows([
      ['Hausse des ventes (élasticité)', fmtPct(d.factor - 1)],
      d.oosUnits ? ['dont moins de ruptures', fmtUnits(d.oosUnits)] : null,
      ['Ventes additionnelles', fmtUnits(res.units.mfg)],
      ['Marge brute industriel', fmtEuro(res.mfg.margin)],
      ['CA magasin TTC', fmtEuro(res.retail.revenue)],
    ])}
    <div class="chart" data-preview-curve></div>
    ${cap ? html`<div>${rows([
      ['Couverture actuelle', shelfBadge(cap.statusCurrent, cap.coverageCurrent)],
      ['Couverture proposée', shelfBadge(cap.statusProposed, cap.coverageProposed)],
      ['Facings minimum conseillés', fmtNumber(cap.minFacings)],
    ])}</div>` : html`<p class="preview-note">Renseignez la capacité par facing pour vérifier la couverture du rayon.</p>`}
    ${share ? rows([
      ['Part de marché', fmtPct(share.pdm)],
      ['Part de linéaire actuelle', fmtPct(share.pdl)],
      ['Facings à parité PDM', fmtNumber(share.facingsAtPdm)],
    ]) : ''}
    ${warningList(res.warnings)}`;
}

export function productPreview(eco, product) {
  const mfgRate = eco.netPrice > 0 ? eco.mfgMargin / eco.netPrice : NaN;
  const retailRate = eco.pvcHt > 0 ? eco.retailMargin / eco.pvcHt : NaN;
  return html`${title}
    ${rows([
      ['PVC HT', fmtPrice(eco.pvcHt)],
      ['Marge brute industriel', `${fmtPrice(eco.mfgMargin)} (${fmtPct(mfgRate, 0)})`],
      ['Taux de marque enseigne', `${fmtPrice(eco.retailMargin)} (${fmtPct(retailRate, 0)})`],
      product.rot ? ['CA industriel par magasin et par an', fmtEuro(product.rot * 52 * eco.netPrice)] : null,
    ])}
    ${eco.marginEstimated ? html`<p class="preview-note">Coût de revient non renseigné : la marge est estimée avec le taux par défaut des hypothèses.</p>` : ''}
    ${eco.retailMargin < 0 ? warningList([{ level: 'warning', message: 'Le prix net dépasse le PVC hors taxes : vérifiez les prix.' }]) : ''}`;
}
