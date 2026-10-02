// Hypothèses: the organisation-wide assumptions behind every calculation.

import { html } from '../ui/dom.js';
import { badge } from '../ui/components.js';
import { toast, confirmDialog } from '../ui/overlay.js';
import { renderField, readForm, showErrors } from '../ui/forms.js';
import { state, saveSettings, can } from '../state.js';
import { SETTINGS_SECTIONS, SETTINGS_FIELDS, DEFAULT_SETTINGS, oosBehaviorTotal, validateSettings } from '../core/settings.js';
import { fmtPercentValue, fmtPct } from '../core/format.js';
import { lossRates } from '../core/calc.js';

function lossText(settings) {
  const total = oosBehaviorTotal(settings);
  const ok = Math.abs(total - 100) <= 0.5;
  const loss = lossRates(settings);
  return html`${ok ? badge('good', `Total ${fmtPercentValue(total)}`) : badge('critical', `Total ${fmtPercentValue(total)} : doit faire 100 %`)}
    <span class="ink-2">Perte en rupture : ${fmtPct(loss.mfg, 0)} pour l’industriel, ${fmtPct(loss.retail, 0)} pour l’enseigne.</span>`;
}

export default {
  id: 'hypotheses',
  title: 'Hypothèses de calcul',
  subtitle: 'Partagées par toute l’équipe',

  render() {
    const editable = can('admin');
    const s = state.settings;
    return html`
      <form class="card" data-settings-form novalidate>
        ${editable ? '' : html`<div class="banner" style="margin:16px 16px 0">Seul un administrateur peut modifier les hypothèses.</div>`}
        <fieldset style="border:0;margin:0;padding:0;min-width:0" ${editable ? '' : 'disabled'}>
        ${SETTINGS_SECTIONS.map((section) => html`<div class="settings-section">
          <div><h2>${section.title}</h2>${section.intro ? html`<p>${section.intro}</p>` : ''}</div>
          <div class="settings-fields">
            ${section.fields.map((field) => renderField({ ...field, help: field.help || field.note }, s[field.key], { idPrefix: 'set', wide: field.type === 'boolean' }))}
            ${section.id === 'oos' ? html`<div class="oos-total" data-oos-total>${lossText(s)}</div>` : ''}
          </div>
        </div>`)}
        </fieldset>
        ${editable ? html`<div class="form-actions">
          <button type="button" class="btn btn-ghost spacer" data-action="settings-reset">Revenir aux valeurs par défaut</button>
          <button type="submit" class="btn btn-primary">Enregistrer les hypothèses</button>
        </div>` : ''}
      </form>`;
  },

  mount(root, ctx) {
    const form = root.querySelector('[data-settings-form]');
    if (!form) return;
    const totalBox = form.querySelector('[data-oos-total]');
    form.addEventListener('input', () => {
      const { value } = validateSettings(readForm(form, SETTINGS_FIELDS));
      if (totalBox) totalBox.innerHTML = lossText(value).markup;
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const { value, errors, ok } = validateSettings(readForm(form, SETTINGS_FIELDS));
      if (!ok) {
        showErrors(form, errors);
        toast(errors.oosBehavior || 'Corrigez les valeurs signalées.', { tone: 'error' });
        return;
      }
      try {
        await saveSettings(value);
        toast('Hypothèses enregistrées : tous les calculs sont à jour.');
        ctx.rerender();
      } catch (error) {
        if (error.fields) showErrors(form, error.fields);
        toast(error.message, { tone: 'error' });
      }
    });
  },

  handlers: {
    async 'settings-reset'(el, event, ctx) {
      const ok = await confirmDialog({
        title: 'Revenir aux valeurs par défaut ?',
        message: 'Toutes les hypothèses reprennent leur valeur d’origine. Les données saisies ne changent pas.',
        confirmLabel: 'Rétablir',
        danger: false,
      });
      if (!ok) return;
      try {
        await saveSettings({ ...DEFAULT_SETTINGS });
        toast('Valeurs par défaut rétablies.');
        ctx.rerender();
      } catch (error) {
        toast(error.message, { tone: 'error' });
      }
    },
  },
};
