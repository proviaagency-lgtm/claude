// Data tables with search, sorting and pagination. Table state survives page
// re-renders; the app wires the data-action buttons back to `tableAction`.

import { html, attrs } from './dom.js';
import { icon } from './icons.js';
import { normalizeKey } from '../core/parse.js';
import { fmtNumber } from '../core/format.js';

const states = new Map();

function tableState(key, defaults) {
  if (!states.has(key)) states.set(key, { query: '', page: 0, sortKey: defaults.sortKey, sortDir: defaults.sortDir || 'desc' });
  return states.get(key);
}

/** Handles sort / page / search events; returns true when the table changed. */
export function tableAction(element, event) {
  const key = element.dataset.table;
  const s = states.get(key);
  if (!s) return false;
  const action = element.dataset.action;
  if (action === 'table-sort') {
    const col = element.dataset.col;
    if (s.sortKey === col) s.sortDir = s.sortDir === 'asc' ? 'desc' : 'asc';
    else {
      s.sortKey = col;
      s.sortDir = element.dataset.dir || 'asc';
    }
    s.page = 0;
    return true;
  }
  if (action === 'table-page') {
    s.page = Math.max(0, Number(element.dataset.page) || 0);
    return true;
  }
  if (action === 'table-search') {
    s.query = event.target.value;
    s.page = 0;
    return true;
  }
  return false;
}

function compare(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });
}

/**
 * columns: [{ key, label, align, sort(row), render(row), className, defaultDir }]
 * Options: key, rows, search(row) → text, rowAttrs(row), pageSize, empty, groupBy(row) → { key, render(rows) }
 */
export function dataTable({ key, columns, rows, search, rowAttrs, pageSize = 50, empty = 'Aucune ligne.', defaultSort, footer, tools }) {
  const s = tableState(key, defaultSort || {});
  const q = normalizeKey(s.query);
  let visible = q && search ? rows.filter((row) => normalizeKey(search(row)).includes(q)) : rows;
  const sortCol = columns.find((c) => c.key === s.sortKey && c.sort);
  if (sortCol) {
    const dir = s.sortDir === 'asc' ? 1 : -1;
    visible = [...visible].sort((a, b) => {
      const va = sortCol.sort(a);
      const vb = sortCol.sort(b);
      const blankA = va === null || va === undefined || va === '';
      const blankB = vb === null || vb === undefined || vb === '';
      if (blankA || blankB) return compare(va, vb);
      return dir * compare(va, vb);
    });
  }
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  if (s.page >= pages) s.page = pages - 1;
  const pageRows = visible.slice(s.page * pageSize, (s.page + 1) * pageSize);

  const header = columns.map((c) => {
    const sorted = sortCol && sortCol.key === c.key;
    const ariaSort = sorted ? (s.sortDir === 'asc' ? 'ascending' : 'descending') : null;
    const label = c.sort
      ? html`<button type="button"${attrs({ 'data-action': 'table-sort', 'data-table': key, 'data-col': c.key, 'data-dir': c.defaultDir || (c.align === 'right' ? 'desc' : 'asc') })}>${c.label}${icon(sorted ? (s.sortDir === 'asc' ? 'sortUp' : 'sortDown') : 'sort')}</button>`
      : c.label;
    return html`<th${attrs({ class: c.align === 'right' ? 'right' : null, 'aria-sort': ariaSort, scope: 'col' })}>${label}</th>`;
  });

  const body = pageRows.length
    ? pageRows.map((row) => html`<tr${attrs(rowAttrs ? rowAttrs(row) : {})}>${columns.map((c) => html`<td${attrs({ class: [c.align === 'right' ? 'right' : '', c.className || ''].join(' ').trim() || null })}>${c.render(row)}</td>`)}</tr>`)
    : html`<tr><td colspan="${columns.length}" class="muted">${q ? 'Aucune ligne ne correspond à la recherche.' : empty}</td></tr>`;

  const searchId = `search-${key}`;
  return html`
    <div class="table-tools">
      ${search ? html`<label class="visually-hidden" for="${searchId}">Rechercher</label>
        <input type="search" id="${searchId}" placeholder="Rechercher…" value="${s.query}" data-action="table-search" data-table="${key}" autocomplete="off">` : ''}
      ${tools || ''}
      <span class="table-count">${visible.length === rows.length ? `${fmtNumber(rows.length)} ligne${rows.length > 1 ? 's' : ''}` : `${fmtNumber(visible.length)} sur ${fmtNumber(rows.length)} lignes`}</span>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr>${header}</tr></thead>
        <tbody>${body}</tbody>
        ${footer ? html`<tfoot>${footer}</tfoot>` : ''}
      </table>
    </div>
    ${pages > 1 ? html`<div class="pagination">
      <span>Page ${s.page + 1} sur ${pages}</span>
      <button type="button" class="btn btn-secondary btn-small" data-action="table-page" data-table="${key}" data-page="${s.page - 1}" ${s.page === 0 ? 'disabled' : ''}>Précédente</button>
      <button type="button" class="btn btn-secondary btn-small" data-action="table-page" data-table="${key}" data-page="${s.page + 1}" ${s.page >= pages - 1 ? 'disabled' : ''}>Suivante</button>
    </div>` : ''}`;
}
