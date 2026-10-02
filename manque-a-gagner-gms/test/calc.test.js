import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  unitEconomics,
  lossRates,
  effectiveWeeks,
  facingsFactor,
  createContext,
  computeStockout,
  computePromotion,
  computeListing,
  computeFacing,
  computeAll,
  summarize,
  groupResults,
  monthlyStockouts,
  actionLabel,
  groupActions,
} from '../public/js/core/calc.js';
import { DEFAULT_SETTINGS } from '../public/js/core/settings.js';
import { buildDemoData } from '../public/js/core/demo-data.js';

const close = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);
};

// PVC 2,11 € TTC at 5,5 % VAT is exactly 2,00 € HT.
const product = { id: 'p', name: 'Cookies', pvcTtc: 2.11, vatRate: 5.5, netPrice: 1.5, unitCost: 0.9, rot: 7 };
const retailer = { id: 'r', name: 'Enseigne A' };
const data = { products: [product], retailers: [retailer] };
const settings = { ...DEFAULT_SETTINGS };
const ctx = (overrides = {}) => createContext(data, { ...settings, ...overrides.settings }, {
  today: overrides.today ?? '2026-03-31',
  window: overrides.window,
});

test('unit economics derive HT price and both margins', () => {
  const e = unitEconomics(product, settings);
  close(e.pvcHt, 2);
  close(e.mfgMargin, 0.6);
  close(e.retailMargin, 0.5);
  assert.equal(e.marginEstimated, false);
});

test('unit economics estimate the margin when cost is missing', () => {
  const e = unitEconomics({ ...product, unitCost: undefined }, settings);
  close(e.mfgMargin, 1.5 * 0.35);
  assert.equal(e.marginEstimated, true);
});

test('loss rates follow the consumer behaviour split', () => {
  const rates = lossRates(settings);
  close(rates.mfg, 0.35);
  close(rates.retail, 0.4);
  assert.deepEqual(lossRates({ ...settings, applyOosBehavior: false }), { mfg: 1, retail: 1 });
});

test('stock-out event: rotation × days / 7 × stores', () => {
  const record = { id: 's', productId: 'p', retailerId: 'r', method: 'event', startDate: '2026-03-01', endDate: '2026-03-10', stores: 3 };
  const res = computeStockout(record, ctx());
  close(res.units.gross, 30);
  close(res.units.mfg, 10.5);
  close(res.units.retail, 12);
  close(res.mfg.revenue, 15.75);
  close(res.mfg.margin, 6.3);
  close(res.retail.revenue, 25.32);
  close(res.retail.margin, 6);
  assert.equal(res.details.days, 10);
});

test('stock-out event is prorated to the period window', () => {
  const record = { id: 's', productId: 'p', retailerId: 'r', method: 'event', startDate: '2026-03-01', endDate: '2026-03-10', stores: 3 };
  const res = computeStockout(record, ctx({ window: { from: '2026-03-06', to: '2026-03-31' } }));
  assert.equal(res.details.days, 5);
  close(res.units.gross, 15);
  const outside = computeStockout(record, ctx({ window: { from: '2026-04-01', to: null } }));
  assert.equal(outside.inWindow, false);
  close(outside.units.gross, 0);
});

test('ongoing stock-out runs until today', () => {
  const record = { id: 's', productId: 'p', retailerId: 'r', method: 'event', startDate: '2026-03-01', stores: 3 };
  const res = computeStockout(record, ctx({ today: '2026-03-04' }));
  assert.equal(res.details.ongoing, true);
  close(res.units.gross, 12);
});

test('stock-out rate: sales × rate / (1 − rate)', () => {
  const record = { id: 's', productId: 'p', retailerId: 'r', method: 'rate', startDate: '2026-01-01', endDate: '2026-03-31', soldUnits: 940, oosRate: 6 };
  const res = computeStockout(record, ctx());
  close(res.units.gross, 60);
  const noBehaviour = computeStockout(record, ctx({ settings: { applyOosBehavior: false } }));
  close(noBehaviour.units.mfg, 60);
});

test('stock-out rate is prorated by overlapping days', () => {
  // 1 Jan → 31 Mar 2026 is 90 days; the window keeps March only (31 days).
  const record = { id: 's', productId: 'p', retailerId: 'r', method: 'rate', startDate: '2026-01-01', endDate: '2026-03-31', soldUnits: 940, oosRate: 6 };
  const res = computeStockout(record, ctx({ window: { from: '2026-03-01', to: '2026-03-31' } }));
  close(res.units.gross, (60 * 31) / 90);
});

const promoRecord = {
  id: 'o',
  name: 'Prospectus',
  productId: 'p',
  retailerId: 'r',
  startDate: '2026-03-01',
  endDate: '2026-03-14',
  baseRot: 10,
  uplift: 3,
  discountPct: 25,
  fundedPct: 100,
  storesTargeted: 100,
  storesActive: 80,
  oosDays: 3.5,
};

test('promotion: non-implementation loses the incremental promo volume', () => {
  const res = computePromotion(promoRecord, ctx());
  const ni = res.details.nonImplementation;
  close(res.details.weeks, 2);
  close(res.details.fundingPerUnit, 0.5);
  close(ni.units, 800);
  close(ni.mfgRevenue, 600);
  close(ni.mfgMargin, -120);
  close(ni.retailRevenue, 1055);
  close(ni.retailMargin, 400);
});

test('promotion: out-of-stock days in implemented stores', () => {
  const res = computePromotion(promoRecord, ctx());
  const oos = res.details.outOfStock;
  close(oos.unitsGross, 1200);
  close(oos.mfgRevenue, 420);
  close(oos.mfgMargin, 42);
  close(oos.retailRevenue, 480 * 1.5825);
  close(res.units.mfg, 1220);
  close(res.mfg.revenue, 1020);
  close(res.mfg.margin, -78);
  close(res.details.implantationRate, 0.8);
});

test('promotion warnings: unprofitable operation and discount above the alert', () => {
  const res = computePromotion(promoRecord, ctx());
  close(res.details.potential.incrementalMfgMargin, -600);
  assert.ok(res.warnings.some((w) => w.message.includes('non rentable')));
  assert.ok(!res.warnings.some((w) => w.message.includes('seuil')));
  const deep = computePromotion({ ...promoRecord, discountPct: 40 }, ctx());
  assert.ok(deep.warnings.some((w) => w.message.includes('seuil d’alerte de 34 %')));
});

test('promotion: retailer-funded discount leaves the manufacturer price intact', () => {
  const res = computePromotion({ ...promoRecord, fundedPct: 0 }, ctx());
  close(res.details.promo.mfgRevenue, 1.5);
  close(res.details.promo.retailMargin, 0);
});

test('effective weeks with a linear ramp-up', () => {
  close(effectiveWeeks(52, 8), 48);
  close(effectiveWeeks(4, 8), 1);
  close(effectiveWeeks(10, 0), 10);
  close(effectiveWeeks(0, 8), 0);
  close(effectiveWeeks(-3, 8), 0);
});

test('listing: missing stores, launch delay and cannibalisation', () => {
  const record = {
    id: 'l',
    productId: 'p',
    retailerId: 'r',
    storesTarget: 100,
    storesListed: 60,
    rot: 2,
    weeks: 52,
    rampWeeks: 8,
    cannibalization: 25,
    delayWeeks: 4,
    listingCost: 2000,
  };
  const res = computeListing(record, ctx());
  close(res.details.missingUnits, 3840);
  close(res.details.delayUnits, 480);
  close(res.units.gross, 4320);
  close(res.units.mfg, 3240);
  close(res.mfg.revenue, 4860);
  close(res.details.dn, 0.6);
  close(res.details.potential.mfgMargin, 4320);
  close(res.details.roi, 1.16);
});

test('listing uses settings when fields are empty', () => {
  const record = { id: 'l', productId: 'p', retailerId: 'r', storesTarget: 10, storesListed: 0 };
  const res = computeListing(record, ctx());
  // rot 7 from the product, 52 weeks with an 8-week ramp, 20 % cannibalisation
  close(res.units.gross, 7 * 48 * 10);
  close(res.units.mfg, 7 * 48 * 10 * 0.8);
});

test('facings: elasticity uplift plus fewer stock-outs', () => {
  const record = {
    id: 'f',
    productId: 'p',
    retailerId: 'r',
    stores: 10,
    currentFacings: 2,
    proposedFacings: 4,
    rot: 5,
    elasticity: 0.2,
    weeks: 52,
    currentOosRate: 10,
    targetOosRate: 5,
  };
  const res = computeFacing(record, ctx());
  const factor = 2 ** 0.2;
  close(res.details.factor, factor);
  close(res.details.elasticityUnits, 2600 * (factor - 1));
  close(res.details.oosUnits, 2600 * factor * (0.95 / 0.9 - 1));
  close(res.units.gross, res.details.elasticityUnits + res.details.oosUnits);
  close(res.mfg.revenue, res.units.gross * 1.5);
});

test('facings: shelf capacity diagnosis and share of shelf', () => {
  const record = {
    id: 'f',
    productId: 'p',
    retailerId: 'r',
    stores: 1,
    currentFacings: 2,
    proposedFacings: 4,
    rot: 35,
    unitsPerFacing: 6,
    restockDays: 3,
    marketShare: 10,
    segmentFacings: 40,
  };
  const res = computeFacing(record, ctx());
  const cap = res.details.capacity;
  close(cap.coverageCurrent, 2.4);
  close(cap.coverageProposed, 4.8);
  assert.equal(cap.statusCurrent, 'critical');
  assert.equal(cap.statusProposed, 'good');
  assert.equal(cap.minFacings, 4);
  close(res.details.shelfShare.pdl, 0.05);
  assert.equal(res.details.shelfShare.facingsAtPdm, 4);
});

test('facings factor guards against zero facings', () => {
  assert.equal(facingsFactor(0, 3, 0.2), 1);
  close(facingsFactor(3, 3, 0.2), 1);
});

test('missing product yields zero values and a critical warning', () => {
  const res = computeStockout({ id: 's', productId: 'nope', retailerId: 'r', method: 'event', startDate: '2026-03-01', endDate: '2026-03-02' }, ctx());
  close(res.mfg.revenue, 0);
  assert.equal(res.warnings[0].level, 'critical');
});

test('summaries and groups add up per lever', () => {
  const full = {
    ...data,
    stockouts: [{ id: 's', productId: 'p', retailerId: 'r', method: 'event', startDate: '2026-03-01', endDate: '2026-03-10', stores: 3 }],
    promotions: [promoRecord],
    listings: [],
    facings: [],
  };
  const results = computeAll(full, settings, { today: '2026-03-31' });
  const summary = summarize(results, 'mfg', 'revenue');
  close(summary.byLever.stockouts.value, 15.75);
  close(summary.byLever.promotions.value, 1020);
  close(summary.total, 1035.75);
  const groups = groupResults(results, (r) => r.retailerId, 'mfg', 'revenue');
  assert.equal(groups.length, 1);
  close(groups[0].value, 1035.75);
  assert.match(actionLabel(results[1]), /Implanter « Prospectus » dans tous les magasins prévus et sécuriser les stocks/);
});

test('identical actions are merged across lines', () => {
  const line = (id, startDate, endDate) => ({ id, productId: 'p', retailerId: 'r', method: 'event', startDate, endDate, stores: 1, cause: 'rayon' });
  const full = {
    ...data,
    stockouts: [line('a', '2026-03-01', '2026-03-07'), line('b', '2026-03-10', '2026-03-23')],
    promotions: [promoRecord, { ...promoRecord, id: 'o2', storesActive: 90 }],
  };
  const results = computeAll(full, settings, { today: '2026-03-31' });
  const groups = groupActions(results, (r) => r.mfg.revenue);
  assert.equal(groups.length, 2);
  const stockout = groups.find((g) => g.lever === 'stockouts');
  assert.equal(stockout.results.length, 2);
  close(stockout.units.gross, 7 * 3);
  assert.equal(stockout.results[0].id, 'b', 'largest line first');
  assert.match(stockout.label, /Fiabiliser la mise en rayon : Cookies/);
});

test('monthly stock-outs are spread by day', () => {
  const full = {
    ...data,
    stockouts: [{ id: 's', productId: 'p', retailerId: 'r', method: 'event', startDate: '2026-01-25', endDate: '2026-02-03', stores: 3 }],
  };
  const results = computeAll(full, settings, { today: '2026-03-31' });
  const months = monthlyStockouts(results, 'mfg', 'units', ['2026-01', '2026-02', '2026-03']);
  close(months[0].value, 10.5 * 0.7);
  close(months[1].value, 10.5 * 0.3);
  close(months[2].value, 0);
});

test('demo facings follow the elasticity setting', () => {
  let n = 0;
  const demo = buildDemoData('2026-10-02', () => `id-${(n += 1)}`);
  const at = (elasticity) => summarize(computeAll(demo, { ...settings, shelfElasticity: elasticity }, { today: '2026-10-02' }), 'mfg', 'revenue').byLever.facings.value;
  assert.ok(at(0.25) > at(0.17) * 1.3);
});

test('demo dataset computes without critical warnings', () => {
  let n = 0;
  const demo = buildDemoData('2026-10-02', () => `id-${(n += 1)}`);
  const results = computeAll(demo, settings, { today: '2026-10-02' });
  assert.ok(results.length > 40);
  assert.ok(results.every((r) => !r.warnings.some((w) => w.level === 'critical')));
  const summary = summarize(results, 'mfg', 'revenue');
  for (const lever of Object.keys(summary.byLever)) assert.ok(summary.byLever[lever].value > 0, lever);
  assert.ok(demo.products.every((p) => /^\d{13}$/.test(p.ean)));
});
