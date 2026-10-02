// Fictitious demo dataset: a Breton biscuit maker selling to French retail.
// Dates are relative to `today` so the demo always looks current. EAN codes
// use the GS1 restricted-circulation prefix 299 so they never match a real
// product.

import { addDays } from './dates.js';

export const DEMO_COMPANY = 'Biscuiterie Aurore (démo)';

function ean13(base12) {
  const digits = base12.split('').map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return base12 + ((10 - (sum % 10)) % 10);
}

const PRODUCTS = [
  ['p1', 'Galettes pur beurre 130 g', 'Aurore', 'Biscuits secs', 'permanent', 2.15, 5.5, 1.38, 0.82, 6.5, 12],
  ['p2', 'Palets bretons 125 g', 'Aurore', 'Biscuits secs', 'permanent', 2.29, 5.5, 1.46, 0.88, 5.2, 12],
  ['p3', 'Crêpes dentelle chocolat 90 g', 'Aurore', 'Biscuits chocolatés', 'permanent', 2.49, 5.5, 1.59, 0.97, 4.1, 10],
  ['p4', 'Sablés citron 150 g', 'Aurore', 'Biscuits secs', 'permanent', 2.05, 5.5, 1.31, 0.8, 3.2, 12],
  ['p5', 'Cookies pépites chocolat 200 g', 'Aurore', 'Biscuits chocolatés', 'permanent', 2.39, 5.5, 1.52, 0.95, 7.8, 9],
  ['p6', 'Madeleines pur beurre x12', 'Aurore', 'Pâtisserie', 'permanent', 2.79, 5.5, 1.78, 1.12, 5.9, 8],
  ['p7', 'Gaufrettes vanille 175 g', 'Petit Matin', 'Goûter enfant', 'permanent', 1.69, 5.5, 1.07, 0.66, 4.4, 14],
  ['p8', 'Mini palets x10 sachets', 'Petit Matin', 'Goûter enfant', 'innovation', 2.99, 5.5, 1.91, 1.21, 3.6, 8],
  ['p9', 'Caramels au beurre salé 150 g', 'Aurore', 'Confiserie', 'permanent', 2.95, 20, 1.69, 1.02, 2.3, 10],
  ['p10', 'Galettes sarrasin et graines 120 g', 'Aurore Bio', 'Biscuits secs', 'innovation', 2.59, 5.5, 1.62, 1.0, 3.0, 12],
  ['p11', 'Cookies avoine chocolat noir 180 g', 'Aurore Bio', 'Biscuits chocolatés', 'innovation', 2.79, 5.5, 1.74, 1.08, 3.4, 9],
];

const RETAILERS = [
  ['r1', 'E.Leclerc', 'multi', 720, 'Julie Martin'],
  ['r2', 'Carrefour Hyper', 'hyper', 250, 'Thomas Bernard'],
  ['r3', 'Carrefour Market', 'super', 1000, 'Thomas Bernard'],
  ['r4', 'Intermarché', 'super', 1800, 'Sophie Durand'],
  ['r5', 'Système U', 'multi', 1600, 'Sophie Durand'],
  ['r6', 'Auchan', 'hyper', 120, 'Julie Martin'],
  ['r7', 'Monoprix', 'proxi', 600, 'Thomas Bernard'],
];

// Quarterly out-of-stock rates read from retailer data, oldest quarter first.
// [product, retailer, stores listed, weekly rotation, rates %, cause]
const OOS_SERIES = [
  ['p5', 'r4', 1500, 7.8, [4.6, 5.2, 6.1, 6.8], 'entrepot'],
  ['p1', 'r1', 690, 6.5, [3.5, 3.8, 4.4, 4.9], 'commande'],
  ['p2', 'r3', 700, 5.2, [9.1, 8.8, 8.6, 8.4], 'rayon'],
  ['p6', 'r5', 960, 5.9, [4.2, 4.8, 5.1, 5.6], 'entrepot'],
  ['p7', 'r4', 1200, 4.4, [5.5, 5.1, 4.9, 4.7], 'autre'],
  ['p3', 'r6', 120, 9.5, [10.5, 11.0, 11.6, 11.2], 'commande'],
  ['p5', 'r2', 250, 21, [7.8, 8.6, 9.1, 9.5], 'rayon'],
  ['p9', 'r5', 800, 2.3, [6.0, 6.4, 7.2, 5.0], 'entrepot'],
];

// Seasonality applied to quarterly volumes, oldest quarter first.
const SEASON = [0.97, 1.04, 0.95, 1.02];

/**
 * Builds the demo dataset. `newId()` must return a fresh unique id; references
 * between records are wired with the generated ids.
 */
export function buildDemoData(today, newId) {
  const ids = new Map();
  const id = (key) => {
    if (!ids.has(key)) ids.set(key, newId());
    return ids.get(key);
  };
  const day = (offset) => addDays(today, offset);

  const products = PRODUCTS.map(([key, name, brand, category, status, pvcTtc, vatRate, netPrice, unitCost, rot, unitsPerFacing], i) => ({
    id: id(key),
    ean: ean13(`2990417${String(100 + i * 7).padStart(5, '0')}`),
    name,
    brand,
    category,
    status,
    pvcTtc,
    vatRate,
    netPrice,
    unitCost,
    rot,
    unitsPerFacing,
  }));

  const retailers = RETAILERS.map(([key, name, format, stores, kam]) => ({ id: id(key), name, format, stores, kam }));

  const stockouts = [];
  for (const [p, r, stores, rot, rates, cause] of OOS_SERIES) {
    rates.forEach((rate, q) => {
      const end = day(-1 - (3 - q) * 91);
      const start = addDays(end, -90);
      stockouts.push({
        id: newId(),
        productId: id(p),
        retailerId: id(r),
        method: 'rate',
        startDate: start,
        endDate: end,
        soldUnits: Math.round(stores * rot * 13 * SEASON[q]),
        oosRate: rate,
        cause,
        comment: 'Taux de rupture issu du portail données de l’enseigne.',
      });
    });
  }
  const events = [
    ['p9', 'r2', 'Plateforme Sud (38 magasins)', 38, -40, -29, 2.3, 'entrepot', 'Rupture plateforme pendant l’inventaire.'],
    ['p6', 'r4', 'Région Ouest', 240, -24, -17, 5.9, 'industriel', 'Arrêt de ligne de conditionnement.'],
    ['p5', 'r2', '', 45, -9, null, 21, 'promo', 'Sur-demande après le prospectus concurrent.'],
    ['p3', 'r7', 'Paris intra-muros', 120, -60, -46, 4.1, 'rayon', ''],
    ['p1', 'r5', 'Super U Bretagne', 85, -15, -6, 6.5, 'commande', 'Paramètre de commande automatique à revoir.'],
    ['p2', 'r1', 'Magasin 0412', 1, -33, -13, 9.8, 'blocage', 'Article bloqué à la suite d’un changement de code.'],
  ];
  for (const [p, r, store, stores, from, to, rot, cause, comment] of events) {
    const record = {
      id: newId(),
      productId: id(p),
      retailerId: id(r),
      method: 'event',
      startDate: day(from),
      stores,
      rot,
      cause,
    };
    if (store) record.store = store;
    if (to !== null) record.endDate = day(to);
    if (comment) record.comment = comment;
    stockouts.push(record);
  }

  // [name, retailer, mechanic, start, end, product, discount %, funded %, uplift, targeted, active, oos days, actual units]
  const promoLines = [
    ['Prospectus Rentrée', 'r4', 'prospectus', -30, -17, 'p5', 25, 50, 3.2, 1500, 1180, 2.5, null],
    ['Prospectus Rentrée', 'r4', 'prospectus', -30, -17, 'p1', 25, 50, 2.8, 1500, 1180, 1.5, null],
    ['Prospectus Rentrée', 'r4', 'prospectus', -30, -17, 'p7', 25, 50, 2.6, 1200, 900, 1, null],
    ['Carte fidélité Goûter', 'r1', 'fidelite', -12, 2, 'p7', 34, 100, 2.4, 720, 610, 0.5, null],
    ['Carte fidélité Goûter', 'r1', 'fidelite', -12, 2, 'p8', 34, 100, 2.2, 400, 300, 0, null],
    ['Lot 2 + 1 offert Palets', 'r3', 'gratuite', -75, -62, 'p2', 33, 50, 3.5, 1000, 640, 3, 24800],
    ['Tête de gondole Noël', 'r5', 'tg', 40, 61, 'p6', 0, 100, 1.8, 1600, 900, 0, null],
    ['Tête de gondole Noël', 'r5', 'tg', 40, 61, 'p9', 0, 100, 2.5, 1600, 900, 0, null],
    ['Remise immédiate Cookies', 'r6', 'remise', 20, 33, 'p5', 40, 100, 3, 120, 95, 0, null],
  ];
  const promotions = promoLines.map(([name, r, mechanic, from, to, p, discountPct, fundedPct, uplift, storesTargeted, storesActive, oosDays, actualUnits]) => {
    const record = {
      id: newId(),
      name,
      retailerId: id(r),
      mechanic,
      startDate: day(from),
      endDate: day(to),
      productId: id(p),
      discountPct,
      fundedPct,
      uplift,
      storesTargeted,
      storesActive,
      oosDays,
    };
    if (p === 'p5' && r === 'r6') record.baseRot = 9.5;
    if (actualUnits !== null) record.actualUnits = actualUnits;
    return record;
  });

  // [product, retailer, launch offset, target, listed, rot, cannibalization %, delay weeks, listing cost]
  const listingRows = [
    ['p10', 'r1', -60, 720, 410, 3.0, 20, 0, 25000],
    ['p10', 'r3', -45, 1000, 380, 2.6, 20, 3, 30000],
    ['p10', 'r5', -30, 1600, 950, 2.4, 20, 0, 35000],
    ['p11', 'r4', 14, 1400, 780, 3.4, 25, 0, 40000],
    ['p11', 'r6', -20, 120, 118, 4.0, 20, 2, null],
    ['p8', 'r2', -90, 250, 140, 3.6, 15, 0, 12000],
  ];
  const listings = listingRows.map(([p, r, launch, storesTarget, storesListed, rot, cannibalization, delayWeeks, listingCost]) => {
    const record = {
      id: newId(),
      productId: id(p),
      retailerId: id(r),
      launchDate: day(launch),
      storesTarget,
      storesListed,
      rot,
      delayWeeks,
    };
    // Horizon, ramp-up and the default 20 % cannibalisation follow the settings.
    if (cannibalization !== 20) record.cannibalization = cannibalization;
    if (listingCost !== null) record.listingCost = listingCost;
    return record;
  });

  // [product, retailer, stores, current, proposed, rot, restock days, oos now %, oos after %, PDM %, segment facings]
  const facingRows = [
    ['p2', 'r1', 500, 2, 3, 5.2, 3, 6, 4, 4.5, 90],
    ['p5', 'r4', 1500, 2, 3, 7.8, 2, 6.8, 3.5, null, null],
    ['p5', 'r2', 250, 1, 2, 21, 4, 9.5, 4, 6.2, 70],
    ['p1', 'r5', 900, 3, 4, 6.5, 3, null, null, null, null],
    ['p6', 'r3', 1000, 2, 3, 5.9, 2, null, null, 5.1, 48],
    ['p3', 'r7', 600, 1, 2, 4.1, 3, null, null, 6, 30],
  ];
  const facings = facingRows.map(([p, r, stores, currentFacings, proposedFacings, rot, restockDays, oosNow, oosAfter, marketShare, segmentFacings]) => {
    const record = {
      id: newId(),
      productId: id(p),
      retailerId: id(r),
      stores,
      currentFacings,
      proposedFacings,
      rot,
    };
    // Elasticity and horizon follow the settings; restocking only when unusual.
    if (restockDays !== 3) record.restockDays = restockDays;
    if (oosNow !== null) Object.assign(record, { currentOosRate: oosNow, targetOosRate: oosAfter });
    if (marketShare !== null) Object.assign(record, { marketShare, segmentFacings });
    return record;
  });

  return { products, retailers, stockouts, promotions, listings, facings };
}
