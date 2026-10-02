// Application state, derived results and the mutations shared by every page.

import { COLLECTION_KEYS, LEVERS } from './core/schema.js';
import { DEFAULT_SETTINGS } from './core/settings.js';
import { computeAll, measureValue, VIEWS, MEASURES } from './core/calc.js';
import { periodWindow, todayISO, isISODate } from './core/dates.js';
import { fmtEuro, fmtUnits } from './core/format.js';

const FILTER_KEY = 'gondole-filters';

export const PERIODS = [
  ['last-12-months', '12 derniers mois'],
  ['last-90-days', '90 derniers jours'],
  ['current-quarter', 'Trimestre en cours'],
  ['current-year', 'Année en cours'],
  ['last-year', 'Année dernière'],
  ['all', 'Tout l’historique'],
  ['custom', 'Personnalisée…'],
];

const DEFAULT_FILTERS = {
  period: 'last-12-months',
  from: '',
  to: '',
  retailerId: '',
  brand: '',
  view: 'mfg',
  measure: 'revenue',
};

function loadFilters() {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(FILTER_KEY) || 'null');
    if (stored && typeof stored === 'object') {
      const filters = { ...DEFAULT_FILTERS, ...stored };
      if (!VIEWS[filters.view]) filters.view = DEFAULT_FILTERS.view;
      if (!MEASURES[filters.measure]) filters.measure = DEFAULT_FILTERS.measure;
      if (!PERIODS.some(([key]) => key === filters.period)) filters.period = DEFAULT_FILTERS.period;
      if (!isISODate(filters.from)) filters.from = '';
      if (!isISODate(filters.to)) filters.to = '';
      return filters;
    }
  } catch {
    // Storage unavailable: defaults are fine.
  }
  return { ...DEFAULT_FILTERS };
}

export const state = {
  store: null,
  mode: 'demo',
  session: null,
  orgName: '',
  data: Object.fromEntries(COLLECTION_KEYS.map((key) => [key, []])),
  settings: { ...DEFAULT_SETTINGS },
  filters: loadFilters(),
  today: todayISO(),
  version: 0,
};

export function saveFilters() {
  try {
    globalThis.localStorage?.setItem(FILTER_KEY, JSON.stringify(state.filters));
  } catch {
    // Not persisted; the filters still apply for this visit.
  }
}

export function setData({ collections, settings, org }) {
  for (const key of COLLECTION_KEYS) state.data[key] = collections?.[key] || [];
  if (settings) state.settings = settings;
  if (org?.name) state.orgName = org.name;
  if (state.filters.retailerId && !state.data.retailers.some((r) => r.id === state.filters.retailerId)) {
    state.filters.retailerId = '';
  }
  bump();
}

export function bump() {
  state.version += 1;
}

export function currentWindow() {
  return periodWindow(state.filters.period, state.today, state.filters);
}

let cache = { key: '', results: [] };

/** Results for the period filter, before the retailer / brand filters. */
export function windowedResults() {
  const win = currentWindow();
  const key = `${state.version}|${win.from}|${win.to}|${state.today}`;
  if (cache.key !== key) {
    cache = { key, results: computeAll(state.data, state.settings, { today: state.today, window: win }) };
  }
  return cache.results;
}

export function matchesFilters(result) {
  const { retailerId, brand } = state.filters;
  return result.inWindow
    && (!retailerId || result.retailerId === retailerId)
    && (!brand || result.brand === brand);
}

export function filteredResults() {
  return windowedResults().filter(matchesFilters);
}

export function brands() {
  return [...new Set(state.data.products.map((p) => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
}

export function role() {
  return state.session?.user?.role || 'viewer';
}

export function can(permission) {
  const r = role();
  if (permission === 'edit') return r === 'editor' || r === 'admin';
  if (permission === 'admin') return r === 'admin';
  return true;
}

/** Formatting and labels for the current view / measure. */
export function measureContext() {
  const { view, measure } = state.filters;
  const isUnits = measure === 'units';
  return {
    view,
    measure,
    label: isUnits ? 'Volume (UVC)' : VIEWS[view][measure],
    value: (result) => measureValue(result, view, measure),
    format: (v) => (isUnits ? fmtUnits(v) : fmtEuro(v)),
    compact: (v) => (isUnits ? fmtUnits(v, { compact: true }) : fmtEuro(v, { compact: true })),
  };
}

// ----------------------------------------------------------------- mutations

function upsertLocal(collection, record) {
  const list = state.data[collection];
  const index = list.findIndex((r) => r.id === record.id);
  if (index >= 0) list[index] = record;
  else list.push(record);
  bump();
}

export async function saveRecord(collection, id, input) {
  const record = id
    ? await state.store.update(collection, id, input)
    : await state.store.create(collection, input);
  upsertLocal(collection, record);
  return record;
}

export async function deleteRecord(collection, id, { cascade = false } = {}) {
  const result = await state.store.remove(collection, id, { cascade });
  state.data[collection] = state.data[collection].filter((r) => r.id !== id);
  const field = collection === 'products' ? 'productId' : collection === 'retailers' ? 'retailerId' : null;
  if (field) for (const lever of LEVERS) state.data[lever] = state.data[lever].filter((r) => r[field] !== id);
  bump();
  return result;
}

export async function reload() {
  setData(await state.store.load());
}

export async function saveSettings(settings) {
  state.settings = await state.store.saveSettings(settings);
  bump();
  return state.settings;
}
