// SVG charts drawn at the container's real width. Every chart ships a table
// twin (toggled from its card) and per-mark tooltips; values never rely on
// hover alone because each row or column also carries a direct label.

import { html, raw, setHtml, escapeHtml } from './dom.js';
import { fmtDecimal } from '../core/format.js';

const BAR = 14;
const GAP = 2;
const RADIUS = 4;

function tip(data) {
  return escapeHtml(JSON.stringify(data));
}

/** Rectangle whose right end is rounded (data end), left end square (baseline). */
function barPath(x, y, w, h, roundLeft = false, roundRight = true) {
  if (w <= 0) return '';
  const r = Math.min(RADIUS, w / 2, h / 2);
  const rl = roundLeft ? r : 0;
  const rr = roundRight ? r : 0;
  return `M${x + rl},${y}H${x + w - rr}${rr ? `Q${x + w},${y} ${x + w},${y + rr}` : ''}V${y + h - rr}${rr ? `Q${x + w},${y + h} ${x + w - rr},${y + h}` : ''}H${x + rl}${rl ? `Q${x},${y + h} ${x},${y + h - rl}` : ''}V${y + rl}${rl ? `Q${x},${y} ${x + rl},${y}` : ''}Z`;
}

function columnPath(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function niceStep(max, count = 4) {
  if (!(max > 0)) return 1;
  const rawStep = max / count;
  const pow = 10 ** Math.floor(Math.log10(rawStep));
  const n = rawStep / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

/** Axis tick labels sharing one unit, chosen from the top tick (k€, M€, UVC). */
export function axisFormatter(top, unit) {
  const units = unit === 'units';
  if (top >= 1e6) return (v) => (v === 0 ? '0' : `${fmtDecimal(v / 1e6, 1)} ${units ? 'M UVC' : 'M€'}`);
  if (top >= 1e3) return (v) => (v === 0 ? '0' : `${fmtDecimal(v / 1e3, 1)} ${units ? 'k UVC' : 'k€'}`);
  return (v) => `${fmtDecimal(v, 0)} ${units ? 'UVC' : '€'}`;
}

// --------------------------------------------------------------- legends

export function legend(series) {
  if (!series || series.length < 2) return '';
  return html`<div class="chart-legend">${series.map((s) => html`<span><i class="key ${s.className}" aria-hidden="true"></i>${s.label}</span>`)}</div>`;
}

// ---------------------------------------------------------- stacked bars

/**
 * Horizontal bars, one row per category, each split into series segments.
 * spec: { rows: [{ label, values: { key: number } }], series: [{ key, label, className }], format }
 * A single-series spec is a plain bar chart. Negative parts are not drawn;
 * the row total label still shows the true sum.
 */
function drawBars(spec, width) {
  const { rows, series, format } = spec;
  const formatLabel = spec.formatLabel || format;
  const rowHeight = 46;
  const top = 2;
  const height = top + rows.length * rowHeight;
  const totals = rows.map((row) => series.reduce((sum, s) => sum + (row.values[s.key] || 0), 0));
  const positives = rows.map((row) => series.reduce((sum, s) => sum + Math.max(0, row.values[s.key] || 0), 0));
  const max = Math.max(...positives, 0) || 1;
  const hasNegative = rows.some((row) => series.some((s) => (row.values[s.key] || 0) < 0));
  let out = '';
  rows.forEach((row, i) => {
    const y = top + i * rowHeight;
    const barY = y + 22;
    const parts = series
      .map((s) => ({ s, value: row.values[s.key] || 0 }))
      .filter((p) => p.value > 0);
    const rowTip = tip({
      value: format(totals[i]),
      title: row.label,
      rows: series.length > 1 ? series.map((s) => ({ series: s.className, text: `${s.label} : ${format(row.values[s.key] || 0)}` })) : [],
    });
    out += `<g data-tip="${rowTip}" tabindex="0" role="img" aria-label="${escapeHtml(`${row.label} : ${format(totals[i])}`)}">`;
    out += `<rect class="hit" x="0" y="${y}" width="${width}" height="${rowHeight - 4}"/>`;
    out += `<text x="0" y="${y + 13}" class="label-ink">${escapeHtml(row.label)}</text>`;
    out += `<text x="${width}" y="${y + 13}" text-anchor="end" class="label-strong">${escapeHtml(formatLabel(totals[i]))}</text>`;
    out += `<rect x="0" y="${barY}" width="${width}" height="${BAR}" rx="3" fill="var(--surface-2)"/>`;
    let x = 0;
    parts.forEach((p, j) => {
      const w = (p.value / max) * width;
      const isLast = j === parts.length - 1;
      const drawW = Math.max(0, w - (isLast ? 0 : GAP));
      out += `<path class="mark fill-${p.s.className}" d="${barPath(x, barY, drawW, BAR, false, isLast)}"/>`;
      x += w;
    });
    out += '</g>';
  });
  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group">${out}</svg>`;
  const note = hasNegative ? '<p class="chart-note">Les valeurs négatives ne sont pas dessinées ; les totaux en tiennent compte.</p>' : '';
  return svg + note;
}

// --------------------------------------------------------------- columns

/**
 * Vertical columns over an ordered axis (months).
 * spec: { points: [{ label, title, value }], className, format, formatAxis }
 */
function drawColumns(spec, width) {
  const { points, className, format } = spec;
  const height = 210;
  const margin = { top: 22, right: 4, bottom: 26, left: 52 };
  const plotW = Math.max(10, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const max = Math.max(...points.map((p) => p.value), 0);
  const step = niceStep(max || 1, 4);
  const top = Math.max(step, Math.ceil((max || 1) / step) * step);
  const formatAxis = spec.unit ? axisFormatter(top, spec.unit) : format;
  const formatLabel = spec.formatLabel || formatAxis;
  const yOf = (v) => margin.top + plotH - (Math.max(0, v) / top) * plotH;
  const band = plotW / points.length;
  const colW = Math.min(24, band * 0.62);
  const labelEvery = Math.max(1, Math.ceil(52 / band));
  let out = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = yOf(v);
    out += `<line class="${v === 0 ? 'baseline' : 'gridline'}" x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}"/>`;
    out += `<text x="${margin.left - 8}" y="${y + 4}" text-anchor="end">${escapeHtml(formatAxis(v))}</text>`;
  }
  const maxIndex = points.reduce((best, p, i) => (p.value > points[best].value ? i : best), 0);
  points.forEach((p, i) => {
    const cx = margin.left + band * i + band / 2;
    const y = yOf(p.value);
    const h = margin.top + plotH - y;
    out += `<g data-tip="${tip({ value: format(p.value), title: p.title || p.label })}" tabindex="0" role="img" aria-label="${escapeHtml(`${p.title || p.label} : ${format(p.value)}`)}">`;
    out += `<rect class="hit" x="${cx - band / 2}" y="${margin.top}" width="${band}" height="${plotH}"/>`;
    out += `<path class="mark fill-${className}" d="${columnPath(cx - colW / 2, y, colW, h)}"/>`;
    out += '</g>';
    if ((i === maxIndex || i === points.length - 1) && p.value > 0) {
      out += `<text x="${cx}" y="${y - 6}" text-anchor="middle" class="label-strong">${escapeHtml(formatLabel(p.value))}</text>`;
    }
    if (i % labelEvery === 0 || i === points.length - 1) {
      if (i === points.length - 1 && i % labelEvery !== 0 && labelEvery > 1) return;
      out += `<text x="${cx}" y="${height - 8}" text-anchor="middle">${escapeHtml(p.label)}</text>`;
    }
  });
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group">${out}</svg>`;
}

// ----------------------------------------------------------------- curve

/**
 * Sales index against number of facings, with current and proposed points.
 * spec: { current, proposed, elasticity, className }
 */
function drawCurve(spec, width) {
  const { current, proposed, elasticity, className = 'series-4' } = spec;
  const height = 170;
  const margin = { top: 24, right: 14, bottom: 28, left: 40 };
  const maxF = Math.max(current, proposed) + 2;
  const plotW = Math.max(10, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const index = (f) => 100 * (f / current) ** elasticity;
  const values = Array.from({ length: maxF }, (_, i) => index(i + 1));
  // One spare step below the lowest point leaves room for its label.
  const lo = Math.floor(Math.min(...values) / 10) * 10 - 10;
  const hi = Math.ceil(Math.max(...values) / 10) * 10 || 110;
  const xOf = (f) => margin.left + ((f - 1) / Math.max(1, maxF - 1)) * plotW;
  const yOf = (v) => margin.top + plotH - ((v - lo) / Math.max(1, hi - lo)) * plotH;
  const step = niceStep(hi - lo, 3);
  let out = '';
  for (let v = lo; v <= hi + 1e-9; v += step) {
    out += `<line class="${v === lo ? 'baseline' : 'gridline'}" x1="${margin.left}" x2="${width - margin.right}" y1="${yOf(v)}" y2="${yOf(v)}"/>`;
    out += `<text x="${margin.left - 8}" y="${yOf(v) + 4}" text-anchor="end">${Math.round(v)}</text>`;
  }
  const labelEvery = Math.max(1, Math.ceil(maxF / Math.max(1, plotW / 28)));
  for (let f = 1; f <= maxF; f += 1) {
    if ((f - 1) % labelEvery === 0) out += `<text x="${xOf(f)}" y="${height - 8}" text-anchor="middle">${f}</text>`;
  }
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i + 1).toFixed(1)},${yOf(v).toFixed(1)}`).join('');
  out += `<path d="${line}" fill="none" class="stroke-${className}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  for (const [f, label, filled] of [[current, 'Actuel', false], [proposed, 'Proposé', true]]) {
    const x = xOf(f);
    const y = yOf(index(f));
    out += `<circle cx="${x}" cy="${y}" r="5" class="ring ${filled ? `fill-${className}` : ''}" ${filled ? '' : 'fill="var(--surface)"'} stroke-width="2" ${filled ? '' : `stroke="var(--${className})"`}/>`;
    // The curve rises to the right, so the area below-right of a point is
    // clear of the line; near the right edge the label flips to the left.
    const text = `${label} ${Math.round(index(f))}`;
    let anchor = 'start';
    let tx = x + 9;
    const ty = y + 17;
    if (tx + text.length * 6.6 > width - margin.right) {
      anchor = 'end';
      tx = x - 9;
    }
    out += `<text x="${tx}" y="${ty}" text-anchor="${anchor}" class="label-strong">${text}</text>`;
  }
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Indice de ventes selon le nombre de facings">${out}</svg>`;
}

// ------------------------------------------------------------- table twin

export function chartTable(spec) {
  if (spec.type === 'columns') {
    return html`<table class="data"><thead><tr><th>${spec.axisLabel || 'Période'}</th><th class="right">${spec.valueLabel || 'Valeur'}</th></tr></thead>
      <tbody>${spec.points.map((p) => html`<tr><td>${p.title || p.label}</td><td class="right num">${spec.format(p.value)}</td></tr>`)}</tbody></table>`;
  }
  if (spec.type === 'bars') {
    const multi = spec.series.length > 1;
    return html`<table class="data"><thead><tr><th>${spec.categoryLabel || ''}</th>
      ${multi ? spec.series.map((s) => html`<th class="right">${s.label}</th>`) : ''}<th class="right">Total</th></tr></thead>
      <tbody>${spec.rows.map((row) => {
        const total = spec.series.reduce((sum, s) => sum + (row.values[s.key] || 0), 0);
        return html`<tr><td>${row.label}</td>${multi ? spec.series.map((s) => html`<td class="right num">${spec.format(row.values[s.key] || 0)}</td>`) : ''}<td class="right num strong">${spec.format(total)}</td></tr>`;
      })}</tbody></table>`;
  }
  return '';
}

const DRAW = { bars: drawBars, columns: drawColumns, curve: drawCurve };

/** Draws `spec` inside `element` (a .chart container) at its current width. */
export function drawChart(element, spec) {
  const width = Math.max(200, Math.floor(element.clientWidth || element.parentElement?.clientWidth || 600));
  let svgHost = element.querySelector('.chart-svg');
  if (!svgHost) {
    setHtml(element, html`${spec.series ? legend(spec.series) : ''}<div class="chart-svg"></div>
      <div class="chart-table" hidden>${chartTable(spec)}</div>`);
    svgHost = element.querySelector('.chart-svg');
  }
  if (!spec.rows?.length && !spec.points?.length && spec.type !== 'curve') {
    setHtml(svgHost, html`<p class="muted">Aucune donnée pour ce filtre.</p>`);
    return;
  }
  setHtml(svgHost, raw(DRAW[spec.type](spec, width)));
}
