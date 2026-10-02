// Modal dialogs, confirmations, toasts and the shared chart tooltip.
// Everything is built in the page itself: native alert/confirm dialogs are
// unavailable in some embedded viewers.

import { html, setHtml, $$ } from './dom.js';
import { icon } from './icons.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Opens a modal. `render(close)` returns the body markup; `onMount(root, close)`
 * binds behaviour. Returns { root, close }.
 */
export function openModal({ title, subtitle, size = 'lg', body, onMount, onClose, dismissible = true }) {
  const previousFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const titleId = `modal-title-${Date.now()}`;
  setHtml(backdrop, html`
    <div class="modal ${size === 'sm' ? 'modal-sm' : size === 'md' ? 'modal-md' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="modal-head">
        <div><h2 id="${titleId}">${title}</h2>${subtitle ? html`<p>${subtitle}</p>` : ''}</div>
        ${dismissible ? html`<button type="button" class="btn btn-ghost btn-icon" data-close aria-label="Fermer">${icon('x')}</button>` : ''}
      </div>
      <div class="modal-content">${body}</div>
    </div>`);
  document.body.append(backdrop);
  document.body.style.overflow = 'hidden';
  const modal = backdrop.querySelector('.modal');

  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    if (!document.querySelector('.modal-backdrop')) document.body.style.overflow = '';
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
    onClose?.(result);
  }

  function onKey(event) {
    if (event.key === 'Escape' && dismissible) {
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      const items = $$(FOCUSABLE, modal).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) close();
    else if (event.target === backdrop && dismissible) close();
  });

  onMount?.(modal, close);
  const autofocus = modal.querySelector('[autofocus]') || modal.querySelector('.modal-content ' + FOCUSABLE) || modal;
  autofocus.focus({ preventScroll: true });
  return { root: modal, close };
}

/** In-page confirmation. Resolves true when confirmed. */
export function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = true }) {
  return new Promise((resolve) => {
    let answer = false;
    openModal({
      title,
      size: 'sm',
      body: html`<div class="modal-body"><p>${message}</p></div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" data-close>Annuler</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm autofocus>${confirmLabel}</button>
        </div>`,
      onMount(root, close) {
        root.querySelector('[data-confirm]').addEventListener('click', () => {
          answer = true;
          close();
        });
      },
      onClose: () => resolve(answer),
    });
  });
}

let toastRoot;
export function toast(message, { tone = 'info', timeout = 4500 } = {}) {
  if (!toastRoot) {
    toastRoot = document.createElement('div');
    toastRoot.className = 'toasts';
    toastRoot.setAttribute('role', 'status');
    toastRoot.setAttribute('aria-live', 'polite');
    document.body.append(toastRoot);
  }
  const item = document.createElement('div');
  item.className = `toast ${tone === 'error' ? 'toast-error' : ''}`;
  setHtml(item, html`${icon(tone === 'error' ? 'critical' : 'check')}<span></span>`);
  item.querySelector('span').textContent = message;
  toastRoot.append(item);
  setTimeout(() => item.remove(), timeout);
}

// ------------------------------------------------------------------ tooltip

let tooltip;
function ensureTooltip() {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.hidden = true;
    tooltip.setAttribute('role', 'presentation');
    document.body.append(tooltip);
  }
  return tooltip;
}

/** Fills the tooltip from data-tip JSON ({ value, title, rows }) using textContent only. */
function showTip(target, x, y) {
  let data;
  try {
    data = JSON.parse(target.getAttribute('data-tip'));
  } catch {
    return;
  }
  const tip = ensureTooltip();
  tip.replaceChildren();
  const value = document.createElement('div');
  value.className = 'tooltip-value';
  value.textContent = data.value ?? '';
  tip.append(value);
  if (data.title) {
    const title = document.createElement('div');
    title.className = 'tooltip-title';
    title.textContent = data.title;
    tip.append(title);
  }
  for (const row of data.rows || []) {
    const line = document.createElement('div');
    line.className = 'tooltip-row';
    if (row.series) {
      const key = document.createElement('span');
      key.className = `key-line ${row.series}`;
      line.append(key);
    }
    const label = document.createElement('span');
    label.textContent = row.text;
    line.append(label);
    tip.append(line);
  }
  tip.hidden = false;
  const rect = tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - rect.width - 8, Math.max(8, x + 14));
  const top = y - rect.height - 12 < 8 ? y + 16 : y - rect.height - 12;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideTip() {
  if (tooltip) tooltip.hidden = true;
}

export function installTooltips(root = document) {
  root.addEventListener('pointermove', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
    if (target) showTip(target, event.clientX, event.clientY);
    else hideTip();
  });
  root.addEventListener('pointerleave', hideTip, true);
  root.addEventListener('focusin', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
    if (!target) return;
    const box = target.getBoundingClientRect();
    showTip(target, box.left + box.width / 2, box.top);
  });
  root.addEventListener('focusout', hideTip);
  window.addEventListener('scroll', hideTip, { passive: true, capture: true });
}
