// Import and export of collections as French CSV, shared by the browser
// (file import, downloads) and the server (bulk endpoint, exports).

import { COLLECTIONS, validateRecord } from './schema.js';
import { normalizeKey } from './parse.js';
import { parseCSV, toCSV, csvNumber, protectCell } from './csv.js';
import { fmtDate } from './format.js';

/** Natural key used to update instead of duplicate on re-import. */
export function naturalKey(collectionKey, record) {
  if (collectionKey === 'products') {
    return record.ean ? `ean:${record.ean}` : `name:${normalizeKey(record.name)}`;
  }
  if (collectionKey === 'retailers') return `name:${normalizeKey(record.name)}`;
  return null;
}

export const IMPORT_MODES = {
  products: ['upsert', 'append'],
  retailers: ['upsert', 'append'],
  stockouts: ['append', 'replace'],
  promotions: ['append', 'replace'],
  listings: ['append', 'replace'],
  facings: ['append', 'replace'],
};

export const IMPORT_MODE_LABELS = {
  upsert: 'Mettre à jour les existants et ajouter les nouveaux',
  append: 'Ajouter à l’existant',
  replace: 'Remplacer toutes les lignes existantes',
};

/**
 * Applies an import to a list of stored records. Returns the operations to
 * perform: { create: [record], update: [{ id, record }], removeAll: bool }.
 */
export function planImport(collectionKey, existing, incoming, mode) {
  const plan = { create: [], update: [], removeAll: mode === 'replace' };
  if (mode !== 'upsert') {
    plan.create = incoming;
    return plan;
  }
  const index = new Map();
  for (const record of existing) {
    const key = naturalKey(collectionKey, record);
    if (key && !index.has(key)) index.set(key, record);
  }
  const seen = new Map();
  for (const record of incoming) {
    const key = naturalKey(collectionKey, record);
    const match = key && index.get(key);
    if (match) {
      plan.update.push({ id: match.id, record: { ...match, ...record, id: match.id } });
    } else if (key && seen.has(key)) {
      Object.assign(seen.get(key), record);
    } else {
      plan.create.push(record);
      if (key) seen.set(key, record);
    }
  }
  return plan;
}

// ------------------------------------------------------------------ Export

function cellValue(field, record) {
  const value = record[field.key];
  if (value === undefined || value === null) return '';
  switch (field.type) {
    case 'number':
    case 'integer':
    case 'percent':
      return csvNumber(value);
    case 'date':
      return fmtDate(value);
    case 'boolean':
      return value ? 'oui' : 'non';
    case 'select':
      return field.options.find((o) => o.value === value)?.label ?? value;
    default:
      return protectCell(value);
  }
}

/**
 * Column definitions for exporting a collection: references become readable
 * columns (EAN + Produit, Enseigne) so the file can be re-imported.
 */
export function exportColumns(collectionKey) {
  const columns = [];
  for (const field of COLLECTIONS[collectionKey].fields) {
    if (field.type === 'ref' && field.collection === 'products') {
      columns.push({ header: 'EAN', get: (r, l) => l.products.get(r.productId)?.ean ?? '' });
      columns.push({ header: 'Produit', get: (r, l) => protectCell(l.products.get(r.productId)?.name ?? '') });
    } else if (field.type === 'ref' && field.collection === 'retailers') {
      columns.push({ header: 'Enseigne', get: (r, l) => protectCell(l.retailers.get(r.retailerId)?.name ?? '') });
    } else {
      columns.push({ header: field.label, get: (r) => cellValue(field, r) });
    }
  }
  return columns;
}

export function makeLookups(data) {
  return {
    products: new Map((data.products || []).map((p) => [p.id, p])),
    retailers: new Map((data.retailers || []).map((r) => [r.id, r])),
  };
}

/** CSV text for a collection; `extraColumns` appends computed columns. */
export function exportCSV(collectionKey, records, data, extraColumns = []) {
  const lookups = makeLookups(data);
  const columns = [...exportColumns(collectionKey), ...extraColumns];
  return toCSV(
    columns.map((c) => c.header),
    records.map((r) => columns.map((c) => c.get(r, lookups))),
  );
}

/** Empty file with the expected headers, offered as an import template. */
export function templateCSV(collectionKey) {
  const headers = exportColumns(collectionKey).map((c) => c.header);
  return toCSV(headers, []);
}

// ------------------------------------------------------------------ Import

function headerCandidates(field) {
  const labelWithoutUnit = field.label.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  return [field.label, labelWithoutUnit, field.key, ...(field.aliases || [])].map(normalizeKey);
}

/**
 * Maps CSV headers to fields. Returns { fields: { key: index }, product:
 * { ean, name }, retailer: { name }, unmatched: [header] }.
 */
export function mapHeaders(collectionKey, headers) {
  const collection = COLLECTIONS[collectionKey];
  const normalized = headers.map(normalizeKey);
  const used = new Set();
  const take = (candidates) => {
    for (let i = 0; i < normalized.length; i += 1) {
      if (!used.has(i) && candidates.includes(normalized[i])) {
        used.add(i);
        return i;
      }
    }
    return -1;
  };

  const map = { fields: {}, product: { ean: -1, name: -1 }, retailer: { name: -1 }, unmatched: [] };
  const refFields = collection.fields.filter((f) => f.type === 'ref');
  if (refFields.some((f) => f.collection === 'products')) {
    map.product.ean = take(['ean', 'gencod', 'codeean', 'ean13', 'codebarre']);
    map.product.name = take(['produit', 'libelle', 'designation', 'reference', 'libelleproduit']);
  }
  if (refFields.some((f) => f.collection === 'retailers')) {
    map.retailer.name = take(['enseigne', 'client', 'distributeur']);
  }
  for (const field of collection.fields) {
    if (field.type === 'ref') continue;
    const index = take(headerCandidates(field));
    if (index >= 0) map.fields[field.key] = index;
  }
  map.unmatched = headers.filter((h, i) => !used.has(i) && h.trim() !== '');
  return map;
}

function buildIndexes(data) {
  const productsByEan = new Map();
  const productsByName = new Map();
  for (const p of data.products || []) {
    if (p.ean) productsByEan.set(String(p.ean).replace(/\D/g, ''), p);
    productsByName.set(normalizeKey(p.name), p);
  }
  const retailersByName = new Map((data.retailers || []).map((r) => [normalizeKey(r.name), r]));
  return { productsByEan, productsByName, retailersByName };
}

/**
 * Turns parsed CSV rows into validated records.
 * Options: createMissingRetailers (bool), newId() for created retailers.
 * Returns { records, errors: [{ line, messages }], newRetailers, map }.
 */
export function rowsToRecords(collectionKey, parsed, data, options = {}) {
  const map = mapHeaders(collectionKey, parsed.headers);
  const indexes = buildIndexes(data);
  const collection = COLLECTIONS[collectionKey];
  const needsProduct = collection.fields.some((f) => f.type === 'ref' && f.collection === 'products');
  const needsRetailer = collection.fields.some((f) => f.type === 'ref' && f.collection === 'retailers');
  const records = [];
  const errors = [];
  const newRetailers = new Map();

  parsed.rows.forEach((cells, i) => {
    const line = parsed.lines?.[i] ?? i + 2;
    const input = {};
    const messages = [];
    for (const [key, index] of Object.entries(map.fields)) input[key] = cells[index];

    if (needsProduct) {
      const ean = map.product.ean >= 0 ? String(cells[map.product.ean] ?? '').replace(/\D/g, '') : '';
      const name = map.product.name >= 0 ? String(cells[map.product.name] ?? '').trim() : '';
      const product = (ean && indexes.productsByEan.get(ean)) || (name && indexes.productsByName.get(normalizeKey(name)));
      if (product) input.productId = product.id;
      else if (ean || name) messages.push(`Produit inconnu : ${ean || name}. Importez-le d’abord dans Produits.`);
    }
    if (needsRetailer) {
      const name = map.retailer.name >= 0 ? String(cells[map.retailer.name] ?? '').trim() : '';
      const key = normalizeKey(name);
      let retailer = key && indexes.retailersByName.get(key);
      if (!retailer && key && options.createMissingRetailers) {
        if (!newRetailers.has(key)) {
          newRetailers.set(key, { id: options.newId(), name, format: 'multi' });
        }
        retailer = newRetailers.get(key);
      }
      if (retailer) input.retailerId = retailer.id;
      else if (name) messages.push(`Enseigne inconnue : ${name}.`);
    }

    const { value, errors: fieldErrors } = validateRecord(collectionKey, input);
    for (const [key, message] of Object.entries(fieldErrors)) {
      if ((key === 'productId' || key === 'retailerId') && messages.length) continue;
      const label = collection.fields.find((f) => f.key === key)?.label ?? key;
      messages.push(`${label} : ${message}`);
    }
    if (messages.length) errors.push({ line, messages });
    else records.push(value);
  });

  return { records, errors, newRetailers: [...newRetailers.values()], map };
}

/** Convenience wrapper: CSV text → records. */
export function importCSV(collectionKey, text, data, options = {}) {
  const parsed = parseCSV(text);
  return { parsed, ...rowsToRecords(collectionKey, parsed, data, options) };
}
