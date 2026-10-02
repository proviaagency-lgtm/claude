import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseNumber, parseDate, normalizeKey } from '../public/js/core/parse.js';
import { parseCSV, toCSV, protectCell, detectDelimiter } from '../public/js/core/csv.js';
import { validateRecord, newRecord } from '../public/js/core/schema.js';
import { validateSettings, normalizeSettings } from '../public/js/core/settings.js';
import { importCSV, exportCSV, planImport, mapHeaders } from '../public/js/core/io.js';
import { fmtEuro, fmtPct, fmtNumber, fmtDate } from '../public/js/core/format.js';
import { periodWindow, daysInclusive } from '../public/js/core/dates.js';

test('numbers typed the French or English way', () => {
  assert.equal(parseNumber('1 234,56'), 1234.56);
  assert.equal(parseNumber('1.234,56'), 1234.56);
  assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber('12,5 %'), 12.5);
  assert.equal(parseNumber('2,15 €'), 2.15);
  assert.equal(parseNumber('-3,5'), -3.5);
  assert.equal(parseNumber('1.5'), 1.5);
  assert.equal(parseNumber('1 000 000'), 1000000);
  assert.equal(parseNumber(''), undefined);
  assert.ok(Number.isNaN(parseNumber('abc')));
  assert.ok(Number.isNaN(parseNumber('12-3')));
});

test('dates in ISO and French formats', () => {
  assert.equal(parseDate('03/02/2026'), '2026-02-03');
  assert.equal(parseDate('2026-02-03'), '2026-02-03');
  assert.equal(parseDate('3/2/26'), '2026-02-03');
  assert.equal(parseDate('03.02.2026'), '2026-02-03');
  assert.equal(parseDate('2026/02/03'), '2026-02-03');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('demain'), null);
  assert.equal(parseDate(''), undefined);
});

test('accent-insensitive keys', () => {
  assert.equal(normalizeKey('Coût de revient (€)'), 'coutderevient');
  assert.equal(normalizeKey('  Intermarché '), 'intermarche');
});

test('CSV parsing: BOM, quotes, embedded newlines and line numbers', () => {
  const text = '\ufeffProduit;Commentaire;Ventes\r\n"Cookies; 200 g";"Ligne 1\nLigne 2";"1 234,5"\r\n\r\nGalettes;"Dit ""top""";12\r\n';
  const parsed = parseCSV(text);
  assert.equal(parsed.delimiter, ';');
  assert.deepEqual(parsed.headers, ['Produit', 'Commentaire', 'Ventes']);
  assert.deepEqual(parsed.rows[0], ['Cookies; 200 g', 'Ligne 1\nLigne 2', '1 234,5']);
  assert.deepEqual(parsed.rows[1], ['Galettes', 'Dit "top"', '12']);
  assert.deepEqual(parsed.lines, [2, 5]);
});

test('CSV delimiter detection', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(detectDelimiter('"a;b",c,d'), ',');
});

test('CSV writing escapes and protects formulas', () => {
  assert.equal(protectCell('=SUM(A1)'), '\'=SUM(A1)');
  assert.equal(protectCell('Cookies'), 'Cookies');
  assert.equal(toCSV(['a', 'b'], [['x;y', 'say "hi"']]), 'a;b\r\n"x;y";"say ""hi"""');
});

test('record validation coerces, whitelists and reports errors', () => {
  const ok = validateRecord('products', { name: ' Cookies ', pvcTtc: '2,39', netPrice: '1,52', hacked: 'x', ean: '2990417001006' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.name, 'Cookies');
  assert.equal(ok.value.pvcTtc, 2.39);
  assert.equal(ok.value.status, 'permanent');
  assert.equal('hacked' in ok.value, false);

  const bad = validateRecord('products', { pvcTtc: 'deux euros', netPrice: -1, ean: '123' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.name, 'Champ obligatoire.');
  assert.equal(bad.errors.pvcTtc, 'Nombre invalide.');
  assert.equal(bad.errors.netPrice, 'Minimum : 0.');
  assert.match(bad.errors.ean, /EAN/);
});

test('stock-out rate method requires its own fields and hides event fields', () => {
  const res = validateRecord('stockouts', {
    productId: 'p',
    retailerId: 'r',
    method: 'Taux de rupture sur une période',
    startDate: '01/01/2026',
    stores: 12,
  });
  assert.equal(res.value.method, 'rate');
  assert.equal('stores' in res.value, false);
  assert.equal(res.errors.soldUnits, 'Champ obligatoire.');
  assert.equal(res.errors.oosRate, 'Champ obligatoire.');
  assert.equal(res.errors.endDate, 'Champ obligatoire.');
});

test('cross-field checks and reference existence', () => {
  const dates = validateRecord('promotions', {
    name: 'Opé',
    retailerId: 'r',
    productId: 'p',
    startDate: '2026-03-10',
    endDate: '2026-03-01',
    uplift: 2,
    storesTargeted: 10,
    storesActive: 5,
  }, { refExists: (collection) => collection === 'retailers' });
  assert.match(dates.errors.endDate, /postérieure/);
  assert.equal(dates.errors.productId, 'Produit introuvable.');

  const facings = validateRecord('facings', {
    productId: 'p', retailerId: 'r', stores: 1, currentFacings: 2, proposedFacings: 3, currentOosRate: 5,
  });
  assert.match(facings.errors.targetOosRate, /deux taux/);
});

test('new records get fixed defaults and leave settings-driven fields empty', () => {
  const listing = newRecord('listings');
  assert.equal(listing.weeks, undefined);
  assert.equal(listing.cannibalization, undefined);
  assert.equal(listing.delayWeeks, 0);
  const promo = newRecord('promotions');
  assert.equal(promo.uplift, 2.5);
  assert.equal(promo.fundedPct, 100);
  assert.equal(promo.mechanic, 'remise');
});

test('settings must split consumer behaviour to 100 %', () => {
  assert.equal(validateSettings({ oosNoPurchase: 9 }).ok, true);
  const bad = validateSettings({ oosNoPurchase: 20 });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.oosBehavior, /111 %/);
  const normalized = normalizeSettings({ oosNoPurchase: 20, shelfElasticity: '0,25' });
  assert.equal(normalized.oosNoPurchase, 9);
  assert.equal(normalized.shelfElasticity, 0.25);
});

const refData = {
  products: [{ id: 'p1', ean: '2990417001006', name: 'Cookies pépites 200 g' }],
  retailers: [{ id: 'r1', name: 'Intermarché' }],
};

test('CSV import resolves products by EAN or name and retailers by name', () => {
  const csv = [
    'EAN;Produit;Enseigne;Méthode de calcul;Début;Fin;Magasins concernés;Rotation;Cause',
    '2990417001006;;intermarche;Jours de rupture × magasins;01/03/2026;10/03/2026;3;7;Défaut de mise en rayon',
    ';Cookies pépites 200 g;Intermarché;;05/03/2026;;1;;',
    '123;Inconnu;Lidl;;05/03/2026;;1;;',
  ].join('\n');
  const result = importCSV('stockouts', csv, refData);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].productId, 'p1');
  assert.equal(result.records[0].retailerId, 'r1');
  assert.equal(result.records[0].cause, 'rayon');
  assert.equal(result.records[0].stores, 3);
  assert.equal(result.records[1].method, 'event');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 4);
  assert.match(result.errors[0].messages.join(' '), /Produit inconnu : 123/);
  assert.match(result.errors[0].messages.join(' '), /Enseigne inconnue : Lidl/);
});

test('CSV import can create missing retailers', () => {
  let n = 0;
  const csv = 'EAN;Enseigne;Magasins concernés;Facings actuels;Facings proposés\n2990417001006;Lidl;100;1;2\n2990417001006;LIDL;50;2;3';
  const result = importCSV('facings', csv, refData, { createMissingRetailers: true, newId: () => `new-${(n += 1)}` });
  assert.equal(result.errors.length, 0);
  assert.equal(result.newRetailers.length, 1);
  assert.equal(result.records[0].retailerId, 'new-1');
  assert.equal(result.records[1].retailerId, 'new-1');
});

test('export then re-import gives the same records', () => {
  const records = [{
    id: 'x',
    productId: 'p1',
    retailerId: 'r1',
    method: 'rate',
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    soldUnits: 1234.5,
    oosRate: 6.5,
    cause: 'entrepot',
    comment: '=danger',
  }];
  const csv = exportCSV('stockouts', records, refData);
  assert.match(csv, /'=danger/);
  const back = importCSV('stockouts', csv, refData);
  assert.equal(back.errors.length, 0);
  const { id, comment, ...expected } = records[0];
  const { comment: backComment, ...actual } = back.records[0];
  assert.deepEqual(actual, expected);
  assert.equal(backComment, '\'=danger');
});

test('header mapping accepts aliases and ignores unknown columns', () => {
  const map = mapHeaders('products', ['Gencod', 'Désignation', 'PVC TTC', 'Prix net', 'Couleur']);
  assert.equal(map.fields.ean, 0);
  assert.equal(map.fields.name, 1);
  assert.equal(map.fields.pvcTtc, 2);
  assert.equal(map.fields.netPrice, 3);
  assert.deepEqual(map.unmatched, ['Couleur']);
});

test('upsert matches products by EAN, then by name', () => {
  const existing = [{ id: 'a', ean: '2990417001006', name: 'Ancien nom', pvcTtc: 2 }, { id: 'b', name: 'Sans EAN' }];
  const incoming = [
    { ean: '2990417001006', name: 'Nouveau nom', pvcTtc: 2.2 },
    { name: 'sans ean', pvcTtc: 1 },
    { name: 'Nouveau produit' },
  ];
  const plan = planImport('products', existing, incoming, 'upsert');
  assert.equal(plan.update.length, 2);
  assert.equal(plan.update[0].record.name, 'Nouveau nom');
  assert.equal(plan.update[0].id, 'a');
  assert.equal(plan.create.length, 1);
  assert.equal(planImport('stockouts', [], incoming, 'replace').removeAll, true);
});

test('French formatting', () => {
  assert.equal(fmtEuro(1234567.4), '1\u00a0234\u00a0567\u00a0€');
  assert.equal(fmtEuro(1234567, { compact: true }), '1,23\u00a0M€');
  assert.equal(fmtEuro(125400, { compact: true }), '125\u00a0k€');
  assert.equal(fmtEuro(12540, { compact: true }), '12,5\u00a0k€');
  assert.equal(fmtEuro(980, { compact: true }), '980\u00a0€');
  assert.equal(fmtPct(0.125), '12,5\u00a0%');
  assert.equal(fmtNumber(NaN), '—');
  assert.equal(fmtDate('2026-03-02'), '02/03/2026');
});

test('period windows', () => {
  assert.deepEqual(periodWindow('current-year', '2026-10-02'), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(periodWindow('current-quarter', '2026-11-15'), { from: '2026-10-01', to: '2026-12-31' });
  assert.deepEqual(periodWindow('current-quarter', '2026-02-10'), { from: '2026-01-01', to: '2026-03-31' });
  const rolling = periodWindow('last-12-months', '2026-10-02');
  assert.equal(daysInclusive(rolling.from, '2026-10-02'), 365);
  assert.equal(rolling.to, null);
  assert.deepEqual(periodWindow('all', '2026-10-02'), { from: null, to: null });
  assert.deepEqual(periodWindow('custom', '2026-10-02', { from: '2026-01-01', to: 'bad' }), { from: '2026-01-01', to: null });
});
