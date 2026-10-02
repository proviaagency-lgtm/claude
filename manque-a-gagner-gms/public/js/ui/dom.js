// Tiny templating layer: `html` escapes every interpolated value unless it is
// already safe markup, so user data can never inject HTML.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export class SafeHtml {
  constructor(markup) {
    this.markup = markup;
  }

  toString() {
    return this.markup;
  }
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Marks trusted markup (icons, already-built fragments) as safe. */
export function raw(markup) {
  return new SafeHtml(String(markup ?? ''));
}

function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.markup;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += renderValue(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Attribute list from an object: true → bare attribute, false/null → omitted. */
export function attrs(map) {
  let out = '';
  for (const [key, value] of Object.entries(map)) {
    if (value === false || value === null || value === undefined) continue;
    out += value === true ? ` ${key}` : ` ${key}="${escapeHtml(value)}"`;
  }
  return raw(out);
}

export function setHtml(element, content) {
  element.innerHTML = content instanceof SafeHtml ? content.markup : escapeHtml(content ?? '');
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Delegated listener: handler(event, matchedElement). Returns an unsubscribe function. */
export function on(root, type, selector, handler) {
  const listener = (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

let idCounter = 0;
export function uid(prefix = 'id') {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function debounce(fn, wait = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
