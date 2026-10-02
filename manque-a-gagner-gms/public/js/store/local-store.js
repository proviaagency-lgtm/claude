// Demo / offline mode: the whole workspace lives in this browser
// (localStorage, or memory only when storage is unavailable). Applies the same
// validation and rules as the server so both modes behave alike.

import { COLLECTION_KEYS, LEVERS, validateRecord } from '../core/schema.js';
import { DEFAULT_SETTINGS, normalizeSettings, validateSettings } from '../core/settings.js';
import { IMPORT_MODES, planImport } from '../core/io.js';
import { buildDemoData, DEMO_COMPANY } from '../core/demo-data.js';
import { StoreError } from './store-error.js';

const KEY = 'gondole-demo-v1';

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class LocalStore {
  constructor({ today }) {
    this.mode = 'demo';
    this.today = today;
    this.workspace = null;
    this.persistent = false;
  }

  read() {
    try {
      const rawValue = globalThis.localStorage?.getItem(KEY);
      return rawValue ? JSON.parse(rawValue) : null;
    } catch {
      return null;
    }
  }

  write() {
    try {
      globalThis.localStorage.setItem(KEY, JSON.stringify(this.workspace));
      this.persistent = true;
    } catch {
      this.persistent = false;
    }
  }

  freshWorkspace(withDemo = true) {
    const collections = withDemo
      ? buildDemoData(this.today, newId)
      : Object.fromEntries(COLLECTION_KEYS.map((key) => [key, []]));
    const stamp = new Date().toISOString();
    for (const key of COLLECTION_KEYS) {
      collections[key] = collections[key].map((r) => ({ ...r, createdAt: stamp, updatedAt: stamp }));
    }
    return { version: 1, orgName: DEMO_COMPANY, settings: { ...DEFAULT_SETTINGS }, collections };
  }

  async session() {
    return {
      authenticated: true,
      demo: true,
      user: { name: 'Visiteur de la démo', role: 'admin' },
      org: { name: this.workspace?.orgName || DEMO_COMPANY },
    };
  }

  async load() {
    const stored = this.read();
    const valid = stored && stored.version === 1 && stored.collections && COLLECTION_KEYS.every((k) => Array.isArray(stored.collections[k]));
    this.workspace = valid ? stored : this.freshWorkspace();
    this.write();
    return this.snapshot();
  }

  snapshot() {
    return {
      org: { name: this.workspace.orgName },
      settings: normalizeSettings(this.workspace.settings),
      collections: structuredClone(this.workspace.collections),
    };
  }

  list(collection) {
    return this.workspace.collections[collection];
  }

  exists(collection, id) {
    return this.list(collection).some((r) => r.id === id);
  }

  validate(collection, input, extraRetailers) {
    const { value, errors, ok } = validateRecord(collection, input, {
      refExists: (refCollection, id) => (refCollection === 'retailers' && extraRetailers?.has(id)) || this.exists(refCollection, id),
    });
    if (!ok) throw new StoreError('Certains champs sont invalides.', { status: 422, fields: errors });
    return value;
  }

  async create(collection, input) {
    const value = this.validate(collection, input);
    const stamp = new Date().toISOString();
    const record = { id: newId(), ...value, createdAt: stamp, updatedAt: stamp };
    this.list(collection).push(record);
    this.write();
    return structuredClone(record);
  }

  async update(collection, id, input) {
    const list = this.list(collection);
    const index = list.findIndex((r) => r.id === id);
    if (index < 0) throw new StoreError('Ligne introuvable.', { status: 404 });
    const value = this.validate(collection, input);
    const record = { id, ...value, createdAt: list[index].createdAt, updatedAt: new Date().toISOString() };
    list[index] = record;
    this.write();
    return structuredClone(record);
  }

  async remove(collection, id, { cascade = false } = {}) {
    if (!this.exists(collection, id)) throw new StoreError('Ligne introuvable.', { status: 404 });
    const field = collection === 'products' ? 'productId' : collection === 'retailers' ? 'retailerId' : null;
    let removedReferences = 0;
    if (field) {
      const references = LEVERS.reduce((n, lever) => n + this.list(lever).filter((r) => r[field] === id).length, 0);
      if (references > 0 && !cascade) {
        throw new StoreError(`Cette fiche est utilisée par ${references} ligne${references > 1 ? 's' : ''} d’analyse.`, { status: 409, references });
      }
      for (const lever of LEVERS) {
        const before = this.list(lever).length;
        this.workspace.collections[lever] = this.list(lever).filter((r) => r[field] !== id);
        removedReferences += before - this.list(lever).length;
      }
    }
    this.workspace.collections[collection] = this.list(collection).filter((r) => r.id !== id);
    this.write();
    return { deleted: id, removedReferences };
  }

  async import(collection, { records, mode = 'append', newRetailers = [] }) {
    if (!IMPORT_MODES[collection].includes(mode)) throw new StoreError('Mode d’import non disponible pour ces données.', { status: 422 });
    const stamp = new Date().toISOString();
    const createdRetailers = [];
    const tempIds = new Map();
    for (const retailer of newRetailers) {
      const value = this.validate('retailers', retailer);
      const record = { id: newId(), ...value, createdAt: stamp, updatedAt: stamp };
      createdRetailers.push(record);
      tempIds.set(retailer.tempId, record.id);
    }
    const known = new Set(tempIds.values());
    const rows = [];
    const rowErrors = [];
    records.forEach((input, index) => {
      const source = { ...input };
      if (tempIds.has(source.retailerId)) source.retailerId = tempIds.get(source.retailerId);
      const { value, errors, ok } = validateRecord(collection, source, {
        refExists: (refCollection, id) => (refCollection === 'retailers' && known.has(id)) || this.exists(refCollection, id),
      });
      if (ok) rows.push(value);
      else if (rowErrors.length < 50) rowErrors.push({ index, fields: errors });
    });
    if (rowErrors.length) throw new StoreError('Certaines lignes sont invalides : rien n’a été importé.', { status: 422, rows: rowErrors });

    this.workspace.collections.retailers.push(...createdRetailers);
    const plan = planImport(collection, this.list(collection), rows, mode);
    let removed = 0;
    if (plan.removeAll) {
      removed = this.list(collection).length;
      this.workspace.collections[collection] = [];
    }
    for (const record of plan.create) this.list(collection).push({ id: newId(), ...record, createdAt: stamp, updatedAt: stamp });
    for (const { id, record } of plan.update) {
      const list = this.list(collection);
      const index = list.findIndex((r) => r.id === id);
      const { id: _id, createdAt, updatedAt, ...data } = record;
      list[index] = { id, ...this.validate(collection, data), createdAt: list[index].createdAt, updatedAt: stamp };
    }
    this.write();
    return { created: plan.create.length, updated: plan.update.length, removed, retailersCreated: createdRetailers.length };
  }

  async saveSettings(settings) {
    const { value, errors, ok } = validateSettings(settings);
    if (!ok) throw new StoreError('Certains paramètres sont invalides.', { status: 422, fields: errors });
    this.workspace.settings = value;
    this.write();
    return value;
  }

  async renameOrg(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new StoreError('Nom de l’entreprise : champ obligatoire.', { status: 422 });
    this.workspace.orgName = trimmed.slice(0, 120);
    this.write();
    return { name: this.workspace.orgName };
  }

  async loadDemo() {
    const settings = this.workspace?.settings;
    this.workspace = this.freshWorkspace(true);
    if (settings) this.workspace.settings = settings;
    this.write();
    return { company: DEMO_COMPANY };
  }

  async clearAll() {
    const { orgName, settings } = this.workspace;
    this.workspace = { ...this.freshWorkspace(false), orgName, settings };
    this.write();
    return {};
  }

  async resetDemo() {
    this.workspace = this.freshWorkspace(true);
    this.write();
    return {};
  }
}
