// Calculation engine: turns stored records into "manque à gagner" results for
// the four levers. Pure functions, no DOM; shared by the browser and the server.
//
// Every result carries three volumes (gross, net for the manufacturer, net for
// the retailer) and two value views:
//   mfg    → net revenue at the manufacturer's net price, and gross margin;
//   retail → shelf revenue incl. VAT, and the retailer's front margin.

import { LEVERS } from './schema.js';
import { daysInclusive, overlapDays, toDayNumber, monthKey, fromDayNumber } from './dates.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const pick = (...values) => values.find(finite);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const VIEWS = {
  mfg: { label: 'Industriel', revenue: 'CA net industriel', margin: 'Marge brute industriel' },
  retail: { label: 'Enseigne', revenue: 'CA magasin TTC', margin: 'Marge enseigne' },
};

export const MEASURES = {
  revenue: 'Chiffre d’affaires',
  margin: 'Marge',
  units: 'Volume (UVC)',
};

/** Per-unit economics of a product: prices, VAT and both margins. */
export function unitEconomics(product, settings) {
  const vatRate = pick(product?.vatRate, settings.defaultVatRate, 0);
  const pvcTtc = pick(product?.pvcTtc, 0);
  const pvcHt = pvcTtc / (1 + vatRate / 100);
  const netPrice = pick(product?.netPrice, 0);
  const hasCost = finite(product?.unitCost);
  const unitCost = hasCost ? product.unitCost : netPrice * (1 - settings.defaultMfgMarginRate / 100);
  return {
    vatRate,
    pvcTtc,
    pvcHt,
    netPrice,
    unitCost,
    mfgMargin: netPrice - unitCost,
    retailMargin: pvcHt - netPrice,
    marginEstimated: !hasCost,
  };
}

/**
 * Share of out-of-stock sales really lost. The manufacturer loses shoppers who
 * switch brand or give up; the retailer loses those who buy elsewhere or give up.
 */
export function lossRates(settings) {
  if (!settings.applyOosBehavior) return { mfg: 1, retail: 1 };
  return {
    mfg: (settings.oosOtherBrand + settings.oosNoPurchase) / 100,
    retail: (settings.oosSameItemOtherStore + settings.oosNoPurchase) / 100,
  };
}

/**
 * Weeks of full-rate sales over an horizon of `weeks` when sales ramp up
 * linearly from zero to the target rate over `rampWeeks`.
 */
export function effectiveWeeks(weeks, rampWeeks) {
  if (!(weeks > 0)) return 0;
  if (!(rampWeeks > 0)) return weeks;
  return weeks >= rampWeeks ? weeks - rampWeeks / 2 : (weeks * weeks) / (2 * rampWeeks);
}

/** Sales multiplier when facings go from `current` to `proposed`. */
export function facingsFactor(current, proposed, elasticity) {
  if (!(current > 0) || !(proposed > 0)) return 1;
  return Math.pow(proposed / current, elasticity);
}

export function createContext(data, settings, { today, window } = {}) {
  return {
    settings,
    today,
    window: window && (window.from || window.to) ? window : null,
    loss: lossRates(settings),
    products: new Map((data.products || []).map((p) => [p.id, p])),
    retailers: new Map((data.retailers || []).map((r) => [r.id, r])),
  };
}

function baseResult(lever, record, ctx) {
  const product = ctx.products.get(record.productId);
  const retailer = ctx.retailers.get(record.retailerId);
  const warnings = [];
  if (!product) warnings.push({ level: 'critical', message: 'Produit introuvable : le calcul est à zéro.' });
  if (!retailer) warnings.push({ level: 'critical', message: 'Enseigne introuvable.' });
  return {
    lever,
    id: record.id,
    record,
    product,
    retailer,
    productId: record.productId,
    retailerId: record.retailerId,
    productName: product?.name || 'Produit inconnu',
    retailerName: retailer?.name || 'Enseigne inconnue',
    brand: product?.brand || '',
    category: product?.category || '',
    eco: unitEconomics(product, ctx.settings),
    warnings,
    inWindow: true,
  };
}

function valuesFromUnits(res, units) {
  res.units = units;
  res.mfg = { revenue: units.mfg * res.eco.netPrice, margin: units.mfg * res.eco.mfgMargin };
  res.retail = { revenue: units.retail * res.eco.pvcTtc, margin: units.retail * res.eco.retailMargin };
}

function rotationWarning(res, ...candidates) {
  if (!candidates.some(finite)) {
    res.warnings.push({ level: 'warning', message: 'Rotation manquante : renseignez-la sur la ligne ou la fiche produit.' });
  }
}

// ---------------------------------------------------------------- Ruptures

export function computeStockout(record, ctx) {
  const res = baseResult('stockouts', record, ctx);
  const win = ctx.window;
  const method = record.method === 'rate' ? 'rate' : 'event';
  let gross = 0;
  const details = { method };

  if (method === 'rate') {
    const rate = clamp((record.oosRate ?? 0) / 100, 0, 0.99);
    const sold = record.soldUnits ?? 0;
    let share = 1;
    if (win && record.startDate && record.endDate) {
      const total = daysInclusive(record.startDate, record.endDate);
      share = total > 0 ? overlapDays(record.startDate, record.endDate, win.from, win.to) / total : 0;
    }
    gross = ((sold * rate) / (1 - rate)) * share;
    Object.assign(details, {
      rate,
      soldUnits: sold,
      share,
      start: record.startDate,
      end: record.endDate,
      potentialUnits: (sold / (1 - rate)) * share,
    });
    res.inWindow = share > 0;
  } else {
    const ongoing = !record.endDate;
    const start = record.startDate;
    const end = record.endDate || ctx.today;
    let days = 0;
    let totalDays = 0;
    if (start && end && toDayNumber(end) >= toDayNumber(start)) {
      totalDays = daysInclusive(start, end);
      days = win ? overlapDays(start, end, win.from, win.to) : totalDays;
    } else if (start && ongoing) {
      res.warnings.push({ level: 'warning', message: 'Rupture en cours datée dans le futur : aucun jour compté.' });
    }
    const rot = pick(record.rot, res.product?.rot, 0);
    const stores = pick(record.stores, 1);
    rotationWarning(res, record.rot, res.product?.rot);
    gross = ((rot * days) / 7) * stores;
    Object.assign(details, { days, totalDays, rot, stores, ongoing, start, end });
    res.inWindow = !win || days > 0;
  }

  valuesFromUnits(res, { gross, mfg: gross * ctx.loss.mfg, retail: gross * ctx.loss.retail });
  res.date = record.startDate || null;
  res.details = details;
  return res;
}

// -------------------------------------------------------------- Opérations

export function computePromotion(record, ctx) {
  const res = baseResult('promotions', record, ctx);
  const { eco } = res;
  const s = ctx.settings;
  const days = record.startDate && record.endDate ? Math.max(0, daysInclusive(record.startDate, record.endDate)) : 0;
  const weeks = days / 7;
  const baseRot = pick(record.baseRot, res.product?.rot, 0);
  rotationWarning(res, record.baseRot, res.product?.rot);
  const uplift = pick(record.uplift, 1);
  const promoRot = baseRot * uplift;
  const discount = clamp((record.discountPct ?? 0) / 100, 0, 1);
  const funded = clamp((record.fundedPct ?? 100) / 100, 0, 1);
  const fundingPerUnit = eco.pvcHt * discount * funded;
  const promo = {
    mfgRevenue: eco.netPrice - fundingPerUnit,
    mfgMargin: eco.mfgMargin - fundingPerUnit,
    retailRevenue: eco.pvcTtc * (1 - discount),
    retailMargin: eco.pvcHt * (1 - discount) - (eco.netPrice - fundingPerUnit),
  };
  const targeted = record.storesTargeted ?? 0;
  const active = record.storesActive ?? 0;
  const missing = Math.max(0, targeted - active);

  // Stores that skipped the operation still sold at the base rate and full price:
  // only the difference with the promo scenario is lost.
  const span = missing * weeks;
  const nonImplementation = {
    units: span * (promoRot - baseRot),
    mfgRevenue: span * (promoRot * promo.mfgRevenue - baseRot * eco.netPrice),
    mfgMargin: span * (promoRot * promo.mfgMargin - baseRot * eco.mfgMargin),
    retailRevenue: span * (promoRot * promo.retailRevenue - baseRot * eco.pvcTtc),
    retailMargin: span * (promoRot * promo.retailMargin - baseRot * eco.retailMargin),
  };

  const oosDays = clamp(record.oosDays ?? 0, 0, days);
  const oosGross = (active * promoRot * oosDays) / 7;
  const oosMfg = oosGross * ctx.loss.mfg;
  const oosRetail = oosGross * ctx.loss.retail;
  const outOfStock = {
    unitsGross: oosGross,
    unitsMfg: oosMfg,
    unitsRetail: oosRetail,
    mfgRevenue: oosMfg * promo.mfgRevenue,
    mfgMargin: oosMfg * promo.mfgMargin,
    retailRevenue: oosRetail * promo.retailRevenue,
    retailMargin: oosRetail * promo.retailMargin,
  };

  res.units = {
    gross: nonImplementation.units + oosGross,
    mfg: nonImplementation.units + oosMfg,
    retail: nonImplementation.units + oosRetail,
  };
  res.mfg = {
    revenue: nonImplementation.mfgRevenue + outOfStock.mfgRevenue,
    margin: nonImplementation.mfgMargin + outOfStock.mfgMargin,
  };
  res.retail = {
    revenue: nonImplementation.retailRevenue + outOfStock.retailRevenue,
    margin: nonImplementation.retailMargin + outOfStock.retailMargin,
  };

  const potential = {
    units: targeted * weeks * promoRot,
    incrementalUnits: targeted * weeks * (promoRot - baseRot),
    incrementalMfgMargin: targeted * weeks * (promoRot * promo.mfgMargin - baseRot * eco.mfgMargin),
  };
  const implantationRate = targeted > 0 ? active / targeted : null;
  const achievement = finite(record.actualUnits) && potential.units > 0 ? record.actualUnits / potential.units : null;

  if (discount * 100 > s.promoDiscountAlert + 1e-9) {
    res.warnings.push({
      level: 'warning',
      message: `Remise de ${String(Math.round(discount * 1000) / 10).replace('.', ',')} % au-dessus du seuil d’alerte de ${String(s.promoDiscountAlert).replace('.', ',')} %.`,
    });
  }
  if (active > targeted) {
    res.warnings.push({ level: 'info', message: 'Plus de magasins ont implanté que prévu.' });
  }
  if ((record.oosDays ?? 0) > days) {
    res.warnings.push({ level: 'info', message: 'Jours de rupture plafonnés à la durée de l’opération.' });
  }
  if (potential.incrementalUnits > 0 && potential.incrementalMfgMargin < 0) {
    res.warnings.push({
      level: 'warning',
      message: 'Opération non rentable pour l’industriel : la marge baisse malgré le volume additionnel.',
    });
  }

  res.date = record.startDate || null;
  res.inWindow = !ctx.window || (days > 0 && overlapDays(record.startDate, record.endDate, ctx.window.from, ctx.window.to) > 0);
  res.details = {
    days,
    weeks,
    baseRot,
    uplift,
    promoRot,
    discount,
    funded,
    fundingPerUnit,
    promo,
    targeted,
    active,
    missing,
    oosDays,
    nonImplementation,
    outOfStock,
    potential,
    implantationRate,
    achievement,
  };
  return res;
}

// ------------------------------------------------------- Nouveaux produits

export function computeListing(record, ctx) {
  const res = baseResult('listings', record, ctx);
  const s = ctx.settings;
  const weeks = pick(record.weeks, s.horizonWeeks);
  const rampWeeks = pick(record.rampWeeks, s.rampWeeks);
  const delayWeeks = clamp(pick(record.delayWeeks, 0), 0, weeks);
  const rot = pick(record.rot, res.product?.rot, 0);
  rotationWarning(res, record.rot, res.product?.rot);
  const cannibalization = clamp(pick(record.cannibalization, s.cannibalization) / 100, 0, 1);
  const target = record.storesTarget ?? 0;
  const listed = record.storesListed ?? 0;
  const missing = Math.max(0, target - listed);
  const effWeeks = effectiveWeeks(weeks, rampWeeks);

  const missingUnits = rot * effWeeks * missing;
  // A late shelf launch shifts the whole ramp-up: over a fixed horizon the
  // listed stores only sell during the remaining weeks.
  const delayUnits = rot * (effWeeks - effectiveWeeks(weeks - delayWeeks, rampWeeks)) * listed;
  const gross = missingUnits + delayUnits;
  const net = gross * (1 - cannibalization);
  valuesFromUnits(res, { gross, mfg: net, retail: net });

  const potentialGross = rot * effWeeks * target;
  const potentialNet = potentialGross * (1 - cannibalization);
  const potential = {
    unitsGross: potentialGross,
    units: potentialNet,
    mfgRevenue: potentialNet * res.eco.netPrice,
    mfgMargin: potentialNet * res.eco.mfgMargin,
  };
  const listingCost = finite(record.listingCost) ? record.listingCost : null;
  const roi = listingCost > 0 ? (potential.mfgMargin - listingCost) / listingCost : null;

  if (listed > target) {
    res.warnings.push({ level: 'info', message: 'Plus de magasins ont référencé que de magasins ciblés.' });
  }
  if (roi !== null && roi < 0) {
    res.warnings.push({
      level: 'warning',
      message: 'Le coût de référencement dépasse la marge attendue sur l’horizon, même à 100 % des magasins cibles.',
    });
  }

  res.date = record.launchDate || null;
  res.details = {
    weeks,
    rampWeeks,
    delayWeeks,
    rot,
    cannibalization,
    target,
    listed,
    missing,
    effWeeks,
    missingUnits,
    delayUnits,
    dn: target > 0 ? Math.min(1, listed / target) : null,
    potential,
    listingCost,
    roi,
  };
  return res;
}

// ------------------------------------------------------------------ Facings

export function shelfStatus(coverageDays, restockDays, safetyFactor) {
  if (coverageDays < restockDays) return 'critical';
  if (coverageDays < restockDays * safetyFactor) return 'warning';
  return 'good';
}

export function computeFacing(record, ctx) {
  const res = baseResult('facings', record, ctx);
  const s = ctx.settings;
  const current = record.currentFacings ?? 0;
  const proposed = record.proposedFacings ?? 0;
  const elasticity = pick(record.elasticity, s.shelfElasticity);
  const rot = pick(record.rot, res.product?.rot, 0);
  rotationWarning(res, record.rot, res.product?.rot);
  const weeks = pick(record.weeks, s.horizonWeeks);
  const stores = record.stores ?? 0;
  const baseUnits = rot * weeks * stores;
  const factor = facingsFactor(current, proposed, elasticity);
  const elasticityUnits = baseUnits * (factor - 1);

  // Observed sales happen while the item is available: removing part of the
  // out-of-stock time scales them by (1 - target) / (1 - current).
  let oosUnits = 0;
  if (finite(record.currentOosRate) && finite(record.targetOosRate)) {
    const r1 = clamp(record.currentOosRate / 100, 0, 0.99);
    const r2 = clamp(record.targetOosRate / 100, 0, 0.99);
    oosUnits = baseUnits * factor * ((1 - r2) / (1 - r1) - 1);
  }
  const gross = elasticityUnits + oosUnits;
  valuesFromUnits(res, { gross, mfg: gross, retail: gross });

  const unitsPerFacing = pick(record.unitsPerFacing, res.product?.unitsPerFacing);
  const restockDays = pick(record.restockDays, s.restockDays);
  const daily = rot / 7;
  let capacity = null;
  if (unitsPerFacing > 0 && daily > 0) {
    const coverageCurrent = (current * unitsPerFacing) / daily;
    const coverageProposed = (proposed * unitsPerFacing) / daily;
    capacity = {
      unitsPerFacing,
      restockDays,
      coverageCurrent,
      coverageProposed,
      minFacings: Math.max(1, Math.ceil((daily * restockDays * s.safetyFactor) / unitsPerFacing)),
      statusCurrent: shelfStatus(coverageCurrent, restockDays, s.safetyFactor),
      statusProposed: shelfStatus(coverageProposed, restockDays, s.safetyFactor),
    };
  }

  let shelfShare = null;
  if (finite(record.marketShare) && record.segmentFacings > 0) {
    const pdm = record.marketShare / 100;
    shelfShare = {
      pdm,
      pdl: current / record.segmentFacings,
      pdlProposed: proposed / record.segmentFacings,
      facingsAtPdm: Math.max(1, Math.round(pdm * record.segmentFacings)),
    };
  }

  if (proposed < current) {
    res.warnings.push({ level: 'info', message: 'Réduction de facings : le calcul chiffre la perte de ventes.' });
  }

  res.date = null;
  res.details = {
    current,
    proposed,
    elasticity,
    rot,
    weeks,
    stores,
    baseUnits,
    factor,
    elasticityUnits,
    oosUnits,
    capacity,
    shelfShare,
  };
  return res;
}

// ------------------------------------------------------------- Aggregation

const COMPUTE = {
  stockouts: computeStockout,
  promotions: computePromotion,
  listings: computeListing,
  facings: computeFacing,
};

export function computeRecord(lever, record, ctx) {
  return COMPUTE[lever](record, ctx);
}

/** Results for every lever record, in lever order. */
export function computeAll(data, settings, options = {}) {
  const ctx = createContext(data, settings, options);
  const results = [];
  for (const lever of LEVERS) {
    for (const record of data[lever] || []) results.push(COMPUTE[lever](record, ctx));
  }
  return results;
}

export function measureValue(result, view, measure) {
  if (measure === 'units') return result.units[view];
  return result[view][measure];
}

export function summarize(results, view, measure) {
  const byLever = Object.fromEntries(LEVERS.map((lever) => [lever, { value: 0, count: 0 }]));
  let total = 0;
  for (const result of results) {
    const value = measureValue(result, view, measure);
    byLever[result.lever].value += value;
    byLever[result.lever].count += 1;
    total += value;
  }
  return { total, byLever, count: results.length };
}

/** Groups results by `keyOf(result)`, largest total first. */
export function groupResults(results, keyOf, view, measure) {
  const groups = new Map();
  for (const result of results) {
    const key = keyOf(result);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        value: 0,
        count: 0,
        byLever: Object.fromEntries(LEVERS.map((lever) => [lever, 0])),
        results: [],
      });
    }
    const group = groups.get(key);
    const value = measureValue(result, view, measure);
    group.value += value;
    group.count += 1;
    group.byLever[result.lever] += value;
    group.results.push(result);
  }
  return [...groups.values()].sort((a, b) => b.value - a.value);
}

/**
 * Spreads out-of-stock results evenly over the days they cover (inside the
 * period `window` they were computed with) and returns
 * [{ month: 'YYYY-MM', value }] for the requested months.
 */
export function monthlyStockouts(results, view, measure, months, window = null) {
  const totals = new Map(months.map((m) => [m, 0]));
  for (const result of results) {
    if (result.lever !== 'stockouts') continue;
    const { start, end } = result.details;
    if (!start || !end) continue;
    const value = measureValue(result, view, measure);
    if (!value) continue;
    let first = toDayNumber(start);
    let last = toDayNumber(end);
    if (window?.from) first = Math.max(first, toDayNumber(window.from));
    if (window?.to) last = Math.min(last, toDayNumber(window.to));
    if (last < first) continue;
    const perDay = value / (last - first + 1);
    for (let day = first; day <= last; day += 1) {
      const key = monthKey(fromDayNumber(day));
      if (totals.has(key)) totals.set(key, totals.get(key) + perDay);
    }
  }
  return months.map((month) => ({ month, value: totals.get(month) }));
}

// ------------------------------------------------------------------ Wording

const STOCKOUT_ACTIONS = {
  entrepot: 'Sécuriser le flux entrepôt',
  commande: 'Corriger la commande magasin',
  rayon: 'Fiabiliser la mise en rayon',
  industriel: 'Sécuriser la production',
  blocage: 'Lever le blocage',
  promo: 'Ajuster les quantités promo',
  autre: 'Réduire les ruptures',
};

/** Short imperative action for an action plan or a retailer pitch. */
export function actionLabel(result) {
  const d = result.details;
  switch (result.lever) {
    case 'stockouts':
      return `${STOCKOUT_ACTIONS[result.record.cause] || STOCKOUT_ACTIONS.autre} : ${result.productName}`;
    case 'promotions': {
      const name = result.record.name;
      if (d.missing > 0 && d.outOfStock.unitsGross > 0) {
        return `Implanter « ${name} » dans ${d.missing} magasins de plus et sécuriser les stocks`;
      }
      if (d.missing > 0) return `Implanter « ${name} » dans ${d.missing} magasins de plus`;
      return `Sécuriser les stocks de « ${name} »`;
    }
    case 'listings':
      if (d.missing > 0) return `Référencer ${result.productName} dans ${d.missing} magasins de plus`;
      return `Tenir la date d’implantation de ${result.productName}`;
    case 'facings':
      return `Passer ${result.productName} de ${d.current} à ${d.proposed} facings`;
    default:
      return result.productName;
  }
}
