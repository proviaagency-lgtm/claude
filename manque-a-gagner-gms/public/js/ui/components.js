// Small presentational building blocks shared by the pages.

import { html, attrs } from './dom.js';
import { icon } from './icons.js';
import { fmtPct } from '../core/format.js';

export const LEVER_META = {
  stockouts: { label: 'Ruptures', route: 'ruptures', series: 'series-1', icon: 'alert' },
  promotions: { label: 'Opérations', route: 'operations', series: 'series-2', icon: 'chart' },
  listings: { label: 'Nouveaux produits', route: 'nouveaux-produits', series: 'series-3', icon: 'box' },
  facings: { label: 'Facings', route: 'facings', series: 'series-4', icon: 'table' },
};

export function button({ label, iconName, action, variant = 'secondary', size, title, disabled, type = 'button', data = {} }) {
  const classes = ['btn', `btn-${variant}`, size === 'small' ? 'btn-small' : '', !label ? 'btn-icon' : ''].filter(Boolean).join(' ');
  const dataAttrs = Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, v]));
  return html`<button${attrs({
    type,
    class: classes,
    'data-action': action,
    title: title || null,
    'aria-label': label ? null : title,
    disabled: Boolean(disabled),
    ...dataAttrs,
  })}>${iconName ? icon(iconName) : ''}${label ? html`<span>${label}</span>` : ''}</button>`;
}

/** Icon button switching a chart card between the chart and its table. */
export function chartToggle(chartKey) {
  return button({ title: 'Afficher en tableau', iconName: 'table', action: 'toggle-chart-table', variant: 'ghost', size: 'small', data: { for: chartKey } });
}

export function leverKey(lever) {
  return html`<span class="key ${LEVER_META[lever].series}" aria-hidden="true"></span>`;
}

export function leverChip(lever) {
  return html`<span class="chip">${leverKey(lever)}${LEVER_META[lever].label}</span>`;
}

const STATUS = {
  good: { icon: 'check', className: 'badge-good' },
  warning: { icon: 'alert', className: 'badge-warning' },
  critical: { icon: 'critical', className: 'badge-critical' },
  info: { icon: 'info', className: 'badge-info' },
  neutral: { icon: null, className: 'badge-neutral' },
};

export function badge(level, label) {
  const s = STATUS[level] || STATUS.neutral;
  return html`<span class="badge ${s.className}">${s.icon ? icon(s.icon) : ''}${label}</span>`;
}

export function warningList(warnings) {
  if (!warnings?.length) return '';
  const iconFor = { critical: 'critical', warning: 'alert', info: 'info' };
  return html`<ul class="warn-list">${warnings.map((w) => html`
    <li class="warn-${w.level}">${icon(iconFor[w.level] || 'info')}<span>${w.message}</span></li>`)}</ul>`;
}

/** Progress of a ratio (DN, implantation) with its label. */
export function meter(ratio, label) {
  const safe = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  return html`<div class="meter" role="img" aria-label="${label}">
    <div class="meter-track"><div class="meter-fill" style="width:${(safe * 100).toFixed(1)}%"></div></div>
    <span class="meter-label num">${label}</span>
  </div>`;
}

export function kpis(items) {
  return html`<div class="card kpis">${items.map((item) => html`
    <div class="kpi">
      <span class="kpi-label">${item.label}</span>
      <span class="kpi-value">${item.value}</span>
      ${item.sub ? html`<span class="kpi-sub">${item.sub}</span>` : ''}
    </div>`)}</div>`;
}

export function emptyState({ title, text, actions = [] }) {
  return html`<div class="empty">
    <h2>${title}</h2>
    <p>${text}</p>
    ${actions.length ? html`<div class="empty-actions">${actions}</div>` : ''}
  </div>`;
}

export function card({ title, subtitle, tools, body, foot, className = '' }) {
  return html`<section class="card ${className}">
    ${title ? html`<div class="card-head"><div><h2>${title}</h2>${subtitle ? html`<p>${subtitle}</p>` : ''}</div>
      ${tools ? html`<div class="card-tools">${tools}</div>` : ''}</div>` : ''}
    <div class="card-body">${body}</div>
    ${foot ? html`<div class="card-foot">${foot}</div>` : ''}
  </section>`;
}

export function shareOf(value, total) {
  return total > 0 ? fmtPct(value / total, 0) : '—';
}
