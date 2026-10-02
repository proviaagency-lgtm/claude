// Compte et données: password, company name, demo data, export and deletion.

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { badge } from '../ui/components.js';
import { toast, confirmDialog, openModal } from '../ui/overlay.js';
import { offerFile } from '../ui/download.js';
import { state, reload, can } from '../state.js';
import { todayISO } from '../core/dates.js';

const ROLE_LABELS = { admin: 'Administrateur', editor: 'Éditeur', viewer: 'Lecteur' };

function section(title, text, content) {
  return html`<div class="settings-section"><div><h2>${title}</h2>${text ? html`<p>${text}</p>` : ''}</div><div>${content}</div></div>`;
}

export default {
  id: 'compte',
  title: 'Compte et données',
  subtitle: 'Votre accès et les données de l’espace',

  render() {
    const demo = state.mode !== 'server';
    const user = state.session?.user;
    const admin = can('admin');
    return html`<section class="card">
      ${demo ? section('Mode démonstration', 'Les données sont enregistrées dans ce navigateur uniquement. Elles ne sont ni partagées ni envoyées à un serveur.', html`
        <div class="empty-actions">
          <button type="button" class="btn btn-secondary" data-action="demo-reset">${icon('refresh')}<span>Recharger l’exemple complet</span></button>
          <button type="button" class="btn btn-secondary" data-action="data-clear">${icon('trash')}<span>Vider pour saisir mes données</span></button>
        </div>`) : section('Mon profil', null, html`
        <p><strong>${user.name}</strong> · ${user.email}</p>
        <p style="margin-top:6px">${badge('neutral', ROLE_LABELS[user.role] || user.role)}</p>
        <form class="fieldset" data-password-form style="margin-top:16px" novalidate>
          <div class="field"><label class="field-label" for="pw-current">Mot de passe actuel</label><input type="password" id="pw-current" name="current" autocomplete="current-password" required></div>
          <div class="field"><label class="field-label" for="pw-new">Nouveau mot de passe</label><input type="password" id="pw-new" name="next" autocomplete="new-password" minlength="10" required><span class="field-help">10 caractères minimum.</span></div>
          <div class="field wide"><button type="submit" class="btn btn-secondary" style="align-self:flex-start">Changer le mot de passe</button></div>
        </form>`)}
      ${admin ? section('Entreprise', 'Nom affiché dans l’application et sur les argumentaires.', html`
        <form class="fieldset" data-org-form novalidate>
          <div class="field"><label class="field-label" for="org-name">Nom de l’entreprise</label><input type="text" id="org-name" name="name" maxlength="120" value="${state.orgName}" required></div>
          <div class="field" style="justify-content:flex-end"><button type="submit" class="btn btn-secondary" style="align-self:flex-start">Renommer</button></div>
        </form>`) : ''}
      ${!demo && admin ? section('Données de l’espace', 'Exportez toutes vos données (format JSON) ou repartez d’un exemple.', html`
        <div class="empty-actions">
          <button type="button" class="btn btn-secondary" data-action="data-export">${icon('download')}<span>Exporter toutes les données</span></button>
          <button type="button" class="btn btn-secondary" data-action="load-demo">${icon('refresh')}<span>Charger l’exemple de démonstration</span></button>
          <button type="button" class="btn btn-secondary" data-action="data-clear">${icon('trash')}<span>Vider les données</span></button>
        </div>`) : ''}
      ${!demo && admin ? section('Supprimer l’espace', 'Supprime définitivement l’entreprise, ses utilisateurs et toutes ses données.', html`
        <button type="button" class="btn btn-danger" data-action="org-delete">${icon('trash')}<span>Supprimer l’espace</span></button>`) : ''}
    </section>`;
  },

  mount(root, ctx) {
    root.querySelector('[data-password-form]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        state.session = await state.store.changePassword(form.elements.current.value, form.elements.next.value);
        form.reset();
        toast('Mot de passe modifié. Vos autres sessions ont été fermées.');
      } catch (error) {
        toast(error.message, { tone: 'error' });
      }
    });
    root.querySelector('[data-org-form]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const org = await state.store.renameOrg(event.currentTarget.elements.name.value);
        state.orgName = org.name;
        toast('Nom de l’entreprise mis à jour.');
        ctx.refreshShell();
      } catch (error) {
        toast(error.message, { tone: 'error' });
      }
    });
  },

  handlers: {
    async 'demo-reset'(el, event, ctx) {
      const ok = await confirmDialog({ title: 'Recharger l’exemple ?', message: 'Vos modifications dans la démonstration seront remplacées par l’exemple d’origine.', confirmLabel: 'Recharger' });
      if (!ok) return;
      await state.store.resetDemo();
      await reload();
      state.orgName = (await state.store.session()).org.name;
      toast('Exemple rechargé.');
      ctx.refreshShell();
    },
    async 'data-clear'(el, event, ctx) {
      const ok = await confirmDialog({ title: 'Vider toutes les données ?', message: 'Produits, enseignes et analyses seront supprimés. Les hypothèses sont conservées.', confirmLabel: 'Tout vider' });
      if (!ok) return;
      try {
        await state.store.clearAll();
        await reload();
        toast('Données vidées.');
        ctx.navigate('tableau-de-bord');
      } catch (error) {
        toast(error.message, { tone: 'error' });
      }
    },
    async 'data-export'() {
      try {
        const data = await state.store.exportData();
        offerFile(`gondole-export-${todayISO()}.json`, JSON.stringify(data, null, 2), 'application/json');
      } catch (error) {
        toast(error.message, { tone: 'error' });
      }
    },
    'org-delete'() {
      openModal({
        title: 'Supprimer définitivement l’espace ?',
        subtitle: 'Tous les utilisateurs perdent l’accès et les données sont effacées. Exportez-les avant si besoin.',
        size: 'sm',
        body: html`<form novalidate><div class="modal-body"><div class="field"><label class="field-label" for="delete-pw">Confirmez avec votre mot de passe</label>
          <input type="password" id="delete-pw" name="password" autocomplete="current-password" required></div></div>
          <div class="form-actions"><button type="button" class="btn btn-secondary" data-close>Annuler</button><button type="submit" class="btn btn-danger">Supprimer l’espace</button></div></form>`,
        onMount(root) {
          root.querySelector('form').addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
              await state.store.deleteOrg(event.currentTarget.elements.password.value);
              window.location.hash = '';
              window.location.reload();
            } catch (error) {
              toast(error.message, { tone: 'error' });
            }
          });
        },
      });
    },
  },
};
