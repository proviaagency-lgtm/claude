// Form rendering from the shared schema, and reading values back.

import { html, attrs, $$ } from './dom.js';
import { COLLECTIONS, fieldVisible, fieldRequired } from '../core/schema.js';
import { fmtDecimal } from '../core/format.js';

/** Value shown in an input: numbers with a decimal comma, ISO dates as-is. */
function displayValue(field, value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return fmtDecimal(value, 4).replace(/\u00a0/g, '');
  return String(value);
}

function sortedByName(items) {
  return [...items].sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
}

/**
 * One field. `options.data` supplies products/retailers for reference
 * selects; `options.placeholder` overrides the placeholder.
 */
export function renderField(field, value, { error, data, placeholder, idPrefix = 'f', wide } = {}) {
  const id = `${idPrefix}-${field.key}`;
  const helpId = field.help ? `${id}-help` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || null;
  const required = Boolean(field.required);
  const common = {
    id,
    name: field.key,
    'aria-invalid': error ? 'true' : null,
    'aria-describedby': describedBy,
  };
  let control;
  switch (field.type) {
    case 'textarea':
      control = html`<textarea${attrs({ ...common, maxlength: field.maxLength ?? 2000, rows: 2 })}>${displayValue(field, value)}</textarea>`;
      break;
    case 'select':
      control = html`<select${attrs(common)}>${field.options.map((o) => html`<option${attrs({ value: o.value, selected: o.value === value })}>${o.label}</option>`)}</select>`;
      break;
    case 'ref': {
      const items = sortedByName(data?.[field.collection] || []);
      const empty = field.collection === 'products' ? 'Choisir un produit…' : 'Choisir une enseigne…';
      control = html`<select${attrs(common)}>
        <option value="">${empty}</option>
        ${items.map((item) => html`<option${attrs({ value: item.id, selected: item.id === value })}>${item.name}</option>`)}
      </select>`;
      break;
    }
    case 'boolean':
      return html`<div class="field ${wide ? 'wide' : ''}" data-field="${field.key}">
        <label class="checkbox"><input type="checkbox"${attrs({ ...common, checked: Boolean(value) })}> <span>${field.label}</span></label>
        ${field.help ? html`<span class="field-help" id="${helpId}">${field.help}</span>` : ''}
        ${error ? html`<span class="field-error" id="${errorId}">${error}</span>` : ''}
      </div>`;
    case 'date':
      control = html`<input type="date"${attrs({ ...common, value: displayValue(field, value) })}>`;
      break;
    case 'number':
    case 'integer':
    case 'percent':
      control = html`<input type="text"${attrs({
        ...common,
        inputmode: field.type === 'integer' ? 'numeric' : 'decimal',
        autocomplete: 'off',
        value: displayValue(field, value),
        placeholder: placeholder ?? null,
      })}>`;
      break;
    default:
      control = html`<input type="text"${attrs({
        ...common,
        maxlength: field.maxLength ?? 200,
        value: displayValue(field, value),
        placeholder: placeholder ?? null,
        inputmode: field.key === 'ean' ? 'numeric' : null,
      })}>`;
  }
  return html`<div class="field ${wide || field.type === 'textarea' ? 'wide' : ''}" data-field="${field.key}">
    <label class="field-label" for="${id}">${field.label}${required ? html` <span class="req" aria-hidden="true">*</span>` : ''}</label>
    ${control}
    ${field.help ? html`<span class="field-help" id="${helpId}">${field.help}</span>` : ''}
    ${error ? html`<span class="field-error" id="${errorId}">${error}</span>` : ''}
  </div>`;
}

/** Raw values of a form, keyed by field (strings, booleans for checkboxes). */
export function readForm(form, fields) {
  const values = {};
  for (const field of fields) {
    const input = form.elements.namedItem(field.key);
    if (!input) continue;
    values[field.key] = field.type === 'boolean' ? input.checked : input.value;
  }
  return values;
}

/** Shows or hides conditional fields and refreshes the required markers. */
export function syncVisibility(form, collectionKey, values) {
  for (const field of COLLECTIONS[collectionKey].fields) {
    const wrapper = form.querySelector(`[data-field="${field.key}"]`);
    if (!wrapper) continue;
    wrapper.hidden = !fieldVisible(field, values);
    const label = wrapper.querySelector('.field-label');
    if (label) {
      const marker = label.querySelector('.req');
      const required = fieldRequired(field, values);
      if (required && !marker) label.insertAdjacentHTML('beforeend', ' <span class="req" aria-hidden="true">*</span>');
      if (!required && marker) marker.remove();
    }
  }
}

/** Replaces inline error messages after a validation pass. */
export function showErrors(form, errors) {
  for (const node of $$('.field-error', form)) node.remove();
  for (const input of $$('[aria-invalid]', form)) input.removeAttribute('aria-invalid');
  let first = null;
  for (const [key, message] of Object.entries(errors || {})) {
    const wrapper = form.querySelector(`[data-field="${key}"]`);
    if (!wrapper) continue;
    const input = wrapper.querySelector('input, select, textarea');
    const node = document.createElement('span');
    node.className = 'field-error';
    node.id = `${input?.id || key}-error`;
    node.textContent = message;
    wrapper.append(node);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      const described = new Set((input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
      described.add(node.id);
      input.setAttribute('aria-describedby', [...described].join(' '));
      if (!first && !wrapper.hidden) first = input;
    }
  }
  return first;
}
