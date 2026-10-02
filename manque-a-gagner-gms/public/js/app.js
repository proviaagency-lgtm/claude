// Bootstrap and shell: picks the store (server or browser demo), renders the
// navigation, routes between pages and dispatches every data-action.

import { html, setHtml, $, $$, on, debounce } from './ui/dom.js';
import { icon, brandMark } from './ui/icons.js';
import { LEVER_META, leverKey } from './ui/components.js';
import { toast, confirmDialog, installTooltips } from './ui/overlay.js';
import { drawChart } from './ui/charts.js';
import { tableAction } from './ui/table.js';
import { openRecordForm, confirmAndDelete } from './ui/record-form.js';
import { state, setData, saveFilters, brands, reload, PERIODS } from './state.js';
import { LocalStore } from './store/local-store.js';
import { ApiStore, detectServer } from './store/api-store.js';
import { exportCollection } from './pages/shared.js';
import { renderAuth } from './pages/auth.js';
import dashboard from './pages/dashboard.js';
import stockouts from './pages/stockouts.js';
import promotions from './pages/promotions.js';
import listings from './pages/listings.js';
import facings from './pages/facings.js';
import { products, retailers } from './pages/catalog.js';
import importPage, { presetImport } from './pages/import.js';
import pitch, { presetPitch } from './pages/pitch.js';
import settingsPage from './pages/settings.js';
import team, { resetTeamCache } from './pages/team.js';
import account from './pages/account.js';

const PAGES = {
  'tableau-de-bord': dashboard,
  ruptures: stockouts,
  operations: promotions,
  'nouveaux-produits': listings,
  facings,
  produits: products,
  enseignes: retailers,
  import: importPage,
  argumentaire: pitch,
  hypotheses: settingsPage,
  equipe: team,
  compte: account,
};

const NAV = [
  { label: 'Piloter', items: [['tableau-de-bord', 'Tableau de bord', 'dashboard'], ['argumentaire', 'Argumentaire enseigne', 'pitch']] },
  { label: 'Leviers', items: [['ruptures', 'Ruptures', 'stockouts'], ['operations', 'Opérations', 'promotions'], ['nouveaux-produits', 'Nouveaux produits', 'listings'], ['facings', 'Facings', 'facings']] },
  { label: 'Données', items: [['produits', 'Produits', 'box'], ['enseignes', 'Enseignes', 'store'], ['import', 'Import CSV', 'upload']] },
  { label: 'Réglages', items: [['hypotheses', 'Hypothèses', 'sliders'], ['equipe', 'Équipe', 'users'], ['compte', 'Compte et données', 'user']] },
];

const ROLE_LABELS = { admin: 'Administrateur', editor: 'Éditeur', viewer: 'Lecteur' };

const root = document.getElementById('app');
let shellMounted = false;

function routeFromHash() {
  const id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
  return PAGES[id] ? id : null;
}

state.route = routeFromHash() || 'tableau-de-bord';

function navigate(id) {
  state.route = PAGES[id] ? id : 'tableau-de-bord';
  closeNav();
  if (window.location.hash !== `#${state.route}`) {
    try {
      window.history.pushState(null, '', `#${state.route}`);
    } catch {
      // Some embedded viewers forbid history changes; in-memory routing still works.
    }
  }
  renderPage();
  window.scrollTo({ top: 0 });
  $('#main')?.focus({ preventScroll: true });
}

window.addEventListener('popstate', () => {
  const id = routeFromHash() || 'tableau-de-bord';
  if (id !== state.route) {
    state.route = id;
    renderPage();
  }
});

// -------------------------------------------------------------------- shell

function navMarkup() {
  return NAV.map((group) => html`<div class="nav-group">
    <span class="nav-label">${group.label}</span>
    ${group.items.map(([id, label, glyph]) => html`<a href="#${id}" data-route="${id}"${state.route === id ? html` aria-current="page"` : ''}>
      ${LEVER_META[glyph] ? leverKey(glyph) : icon(glyph)}<span>${label}</span></a>`)}
  </div>`);
}

function mountShell() {
  shellMounted = true;
  const user = state.session?.user;
  setHtml(root, html`
    <button type="button" class="skip-link" data-action="skip">Aller au contenu</button>
    <div class="app">
      <aside class="rail" id="rail" aria-label="Navigation">
        <a class="brand" href="#tableau-de-bord">${brandMark()}<span><span class="brand-name">Gondole</span><span class="brand-org">${state.orgName}</span></span></a>
        <nav class="nav" aria-label="Navigation principale">${navMarkup()}</nav>
        <div class="rail-footer">
          <span><span class="rail-user">${user?.name || ''}</span><br>${state.mode === 'server' ? ROLE_LABELS[user?.role] || '' : 'Démonstration · données locales'}</span>
          ${state.mode === 'server' ? html`<button type="button" data-action="logout">${icon('logout')}<span>Se déconnecter</span></button>` : ''}
        </div>
      </aside>
      <div class="nav-scrim" data-action="close-nav" hidden></div>
      <div class="main">
        <header class="topbar">
          <div class="topbar-row">
            <button type="button" class="btn btn-ghost btn-icon menu-button" data-action="open-nav" aria-label="Ouvrir le menu" aria-controls="rail" aria-expanded="false">${icon('menu')}</button>
            <div class="topbar-title"><h1 id="page-title"></h1><p class="topbar-sub" id="page-sub"></p></div>
            <div class="topbar-actions" id="page-actions"></div>
          </div>
          <div class="filters" id="filters"></div>
        </header>
        <main class="content" id="main" tabindex="-1"></main>
      </div>
    </div>`);
  renderPage();
}

function openNav() {
  $('.app')?.classList.add('nav-open');
  const scrim = $('.nav-scrim');
  if (scrim) scrim.hidden = false;
  $('.menu-button')?.setAttribute('aria-expanded', 'true');
  $('#rail a')?.focus();
}

function closeNav() {
  $('.app')?.classList.remove('nav-open');
  const scrim = $('.nav-scrim');
  if (scrim) scrim.hidden = true;
  $('.menu-button')?.setAttribute('aria-expanded', 'false');
}

function filtersMarkup() {
  const f = state.filters;
  const retailerOptions = [...state.data.retailers].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const brandOptions = brands();
  const segmented = (key, label, options) => html`<div class="filter"><span id="label-${key}">${label}</span>
    <div class="segmented" role="group" aria-labelledby="label-${key}">${options.map(([value, text]) => html`
      <button type="button" data-action="filter-set" data-key="${key}" data-value="${value}" aria-pressed="${f[key] === value}">${text}</button>`)}</div></div>`;
  return html`
    <label class="filter"><span>Période</span>
      <select id="filter-period" data-action="filter" data-key="period">${PERIODS.map(([value, text]) => html`<option value="${value}" ${f.period === value ? 'selected' : ''}>${text}</option>`)}</select></label>
    ${f.period === 'custom' ? html`
      <label class="filter"><span>Du</span><input type="date" id="filter-from" data-action="filter" data-key="from" value="${f.from}"></label>
      <label class="filter"><span>Au</span><input type="date" id="filter-to" data-action="filter" data-key="to" value="${f.to}"></label>` : ''}
    <label class="filter"><span>Enseigne</span>
      <select id="filter-retailer" data-action="filter" data-key="retailerId"><option value="">Toutes les enseignes</option>${retailerOptions.map((r) => html`<option value="${r.id}" ${f.retailerId === r.id ? 'selected' : ''}>${r.name}</option>`)}</select></label>
    ${brandOptions.length > 1 ? html`<label class="filter"><span>Marque</span>
      <select id="filter-brand" data-action="filter" data-key="brand"><option value="">Toutes les marques</option>${brandOptions.map((b) => html`<option value="${b}" ${f.brand === b ? 'selected' : ''}>${b}</option>`)}</select></label>` : ''}
    ${segmented('view', 'Point de vue', [['mfg', 'Industriel'], ['retail', 'Enseigne']])}
    ${segmented('measure', 'Mesure', [['revenue', 'CA'], ['margin', 'Marge'], ['units', 'Volume']])}`;
}

function context() {
  return { rerender: renderPage, navigate, refreshShell: mountShell };
}

function captureFocus() {
  const active = document.activeElement;
  if (!active || !active.id || !root.contains(active)) return null;
  return { id: active.id, start: active.selectionStart, end: active.selectionEnd };
}

function restoreFocus(saved) {
  if (!saved) return;
  const element = document.getElementById(saved.id);
  if (!element) return;
  element.focus({ preventScroll: true });
  if (typeof saved.start === 'number' && element.setSelectionRange) {
    try {
      element.setSelectionRange(saved.start, saved.end);
    } catch {
      // Inputs such as type="date" do not support selection ranges.
    }
  }
}

function drawCharts(page) {
  const main = $('#main');
  if (!main || !page.charts) return;
  const specs = page.charts(context()) || {};
  for (const element of $$('.chart[data-chart]', main)) {
    const spec = specs[element.dataset.chart];
    if (spec) drawChart(element, spec);
  }
}

function renderPage() {
  if (!shellMounted) return;
  const page = PAGES[state.route];
  const ctx = context();
  const focus = captureFocus();
  document.title = `${page.title} · Gondole`;
  $('#page-title').textContent = page.title;
  $('#page-sub').textContent = page.subtitle || '';
  setHtml($('#page-actions'), page.headerActions ? page.headerActions() : '');
  const filters = $('#filters');
  filters.hidden = !page.filters;
  if (page.filters) setHtml(filters, filtersMarkup());
  for (const link of $$('.nav a[data-route]')) {
    if (link.dataset.route === state.route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const main = $('#main');
  const banner = state.mode !== 'server' && state.route === 'tableau-de-bord'
    ? html`<div class="banner"><span class="tag">Démo</span><span>Données fictives d’une biscuiterie, enregistrées dans ce navigateur : modifiez, importez, testez librement.</span>
      <button type="button" class="link-button" data-action="go" data-route="compte">Recharger ou vider la démo</button></div>`
    : '';
  setHtml(main, html`${banner}${page.render(ctx)}`);
  page.mount?.(main, ctx);
  drawCharts(page);
  restoreFocus(focus);
}

window.addEventListener('resize', debounce(() => {
  if (shellMounted) drawCharts(PAGES[state.route]);
}, 150));

// ------------------------------------------------------------------ actions

const GLOBAL_ACTIONS = {
  skip() {
    $('#main')?.focus();
  },
  go(el) {
    navigate(el.dataset.route);
  },
  'open-nav': openNav,
  'close-nav': closeNav,
  'add-record'(el) {
    openRecordForm(el.dataset.collection, null, { onDone: renderPage });
  },
  'open-record'(el) {
    const record = state.data[el.dataset.collection]?.find((r) => r.id === el.dataset.id);
    if (record) openRecordForm(el.dataset.collection, record, { onDone: renderPage });
  },
  async 'delete-record'(el) {
    const record = state.data[el.dataset.collection]?.find((r) => r.id === el.dataset.id);
    if (record && (await confirmAndDelete(el.dataset.collection, record))) renderPage();
  },
  export(el) {
    exportCollection(el.dataset.collection);
  },
  'import-preset'(el) {
    presetImport(el.dataset.collection);
    navigate('import');
  },
  'open-pitch'(el) {
    presetPitch(el.dataset.id);
    navigate('argumentaire');
  },
  'toggle-chart-table'(el) {
    const card = el.closest('.card');
    const chart = card?.querySelector(`.chart[data-chart="${el.dataset.for}"]`);
    if (!chart) return;
    const svg = chart.querySelector('.chart-svg');
    const table = chart.querySelector('.chart-table');
    const legend = chart.querySelector('.chart-legend');
    const showTable = table.hidden;
    table.hidden = !showTable;
    svg.hidden = showTable;
    if (legend) legend.hidden = showTable;
    el.title = showTable ? 'Afficher le graphique' : 'Afficher en tableau';
    el.setAttribute('aria-label', el.title);
    setHtml(el, icon(showTable ? 'chart' : 'table'));
  },
  filter(el) {
    state.filters[el.dataset.key] = el.value;
    saveFilters();
    renderPage();
  },
  'filter-set'(el) {
    state.filters[el.dataset.key] = el.dataset.value;
    saveFilters();
    renderPage();
  },
  'reset-filters'() {
    Object.assign(state.filters, { period: 'last-12-months', from: '', to: '', retailerId: '', brand: '' });
    saveFilters();
    renderPage();
  },
  async 'load-demo'() {
    const hasData = Object.values(state.data).some((list) => list.length);
    if (hasData) {
      const ok = await confirmDialog({
        title: 'Charger l’exemple de démonstration ?',
        message: 'Les produits, enseignes et analyses actuels seront remplacés par les données fictives de démonstration.',
        confirmLabel: 'Remplacer par la démo',
      });
      if (!ok) return;
    }
    try {
      await state.store.loadDemo();
      await reload();
      toast('Données de démonstration chargées.');
      renderPage();
    } catch (error) {
      toast(error.message, { tone: 'error' });
    }
  },
  async logout() {
    try {
      await state.store.logout();
    } finally {
      window.location.hash = '';
      window.location.reload();
    }
  },
};

const TABLE_ACTIONS = new Set(['table-sort', 'table-page', 'table-search']);

async function dispatch(action, el, event) {
  try {
    if (TABLE_ACTIONS.has(action)) {
      if (tableAction(el, event)) renderPage();
      return;
    }
    const page = PAGES[state.route];
    if (page.handlers?.[action]) {
      await page.handlers[action](el, event, context());
      return;
    }
    await GLOBAL_ACTIONS[action]?.(el, event);
  } catch (error) {
    console.error(error);
    toast(error.message || 'Une erreur est survenue.', { tone: 'error' });
  }
}

const isChoiceControl = (el) => el.matches('select, input[type="radio"], input[type="checkbox"], input[type="date"]');

on(document, 'click', '[data-action]', (event, el) => {
  if (isChoiceControl(el) || el.matches('input[type="search"], textarea')) return;
  if (el.tagName === 'A') event.preventDefault();
  dispatch(el.dataset.action, el, event);
});

on(document, 'change', '[data-action]', (event, el) => {
  if (isChoiceControl(el)) dispatch(el.dataset.action, el, event);
});

let searchTimer;
on(document, 'input', 'input[type="search"][data-action]', (event, el) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => dispatch(el.dataset.action, el, event), 180);
});

// In-page links (#route) go through the router so they also work where the
// address bar cannot change.
on(document, 'click', 'a[href^="#"]', (event, el) => {
  const id = el.getAttribute('href').slice(1);
  if (!PAGES[id] || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  navigate(id);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('.app.nav-open')) closeNav();
});

installTooltips(document);

// -------------------------------------------------------------------- boot

async function startDemo() {
  state.store = new LocalStore({ today: state.today });
  state.mode = 'demo';
  setData(await state.store.load());
  state.session = await state.store.session();
  state.orgName = state.session.org.name;
  mountShell();
}

function showAuth(screen, signupAllowed = true) {
  shellMounted = false;
  renderAuth(root, {
    screen,
    signupAllowed,
    store: state.store,
    onSession: (session) => enterServer(session),
    onDemo: () => startDemo(),
  });
}

async function enterServer(session) {
  if (!session.authenticated) return showAuth('login', session.signupAllowed);
  state.session = session;
  if (session.user.mustChangePassword) return showAuth('change-password', session.signupAllowed);
  state.orgName = session.org.name;
  resetTeamCache();
  try {
    setData(await state.store.load());
  } catch (error) {
    if (error.status === 401) return showAuth('login', session.signupAllowed);
    if (error.code === 'PASSWORD_CHANGE_REQUIRED') return showAuth('change-password', session.signupAllowed);
    throw error;
  }
  mountShell();
  return undefined;
}

window.addEventListener('gondole:unauthorized', () => {
  if (state.mode === 'server') {
    toast('Votre session a expiré : reconnectez-vous.', { tone: 'error' });
    showAuth('login');
  }
});

async function boot() {
  const forcedDemo = document.querySelector('meta[name="gondole-mode"]')?.content === 'demo';
  const session = forcedDemo ? null : await detectServer();
  if (!session) {
    await startDemo();
    return;
  }
  state.store = new ApiStore();
  state.mode = 'server';
  await enterServer(session);
}

boot().catch((error) => {
  console.error(error);
  setHtml(root, html`<div class="loading"><p>Gondole n’a pas pu démarrer : ${error.message}. Rechargez la page.</p></div>`);
});
