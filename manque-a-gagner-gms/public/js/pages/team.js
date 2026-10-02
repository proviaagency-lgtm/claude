// Équipe (server mode): members, roles, invitations with a one-time password.

import { html } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { badge } from '../ui/components.js';
import { toast, confirmDialog, openModal } from '../ui/overlay.js';
import { copyText } from '../ui/download.js';
import { state, can } from '../state.js';
import { fmtDate } from '../core/format.js';

const ROLES = [
  { value: 'admin', label: 'Administrateur', text: 'Tout, y compris hypothèses, équipe et suppression de l’espace' },
  { value: 'editor', label: 'Éditeur', text: 'Saisit, importe et modifie les données' },
  { value: 'viewer', label: 'Lecteur', text: 'Consulte les analyses et les argumentaires' },
];

const local = { users: null, loading: false, error: '' };

async function loadTeam(ctx) {
  local.loading = true;
  try {
    local.users = (await state.store.listTeam()).users;
    local.error = '';
  } catch (error) {
    local.error = error.message;
  } finally {
    local.loading = false;
    ctx.rerender();
  }
}

function showTemporaryPassword(name, password) {
  openModal({
    title: 'Mot de passe temporaire',
    subtitle: `Transmettez-le à ${name} : il ne sera plus affiché. Il devra le changer à sa première connexion.`,
    size: 'sm',
    body: html`<div class="modal-body"><p class="preview-figure" style="font-size:24px;letter-spacing:0.04em" data-secret></p></div>
      <div class="form-actions"><button type="button" class="btn btn-secondary" data-close>Fermer</button>
      <button type="button" class="btn btn-primary" data-copy>${icon('copy')}<span>Copier</span></button></div>`,
    onMount(root) {
      root.querySelector('[data-secret]').textContent = password;
      root.querySelector('[data-copy]').addEventListener('click', async () => {
        toast((await copyText(password)) ? 'Mot de passe copié.' : 'Copie impossible : notez-le manuellement.');
      });
    },
  });
}

export default {
  id: 'equipe',
  title: 'Équipe',
  subtitle: 'Accès et rôles de vos collaborateurs',

  render(ctx) {
    if (state.mode !== 'server') {
      return html`<section class="card"><div class="empty"><h2>Gestion d’équipe dans la version hébergée</h2>
        <p>En mode démonstration, les données restent dans ce navigateur. Une fois l’application installée sur votre serveur, chaque entreprise dispose de son espace et l’administrateur invite ses KAM, chefs de secteur et le trade marketing avec un rôle adapté.</p></div></section>`;
    }
    if (!can('admin')) {
      return html`<section class="card"><div class="empty"><h2>Réservé aux administrateurs</h2><p>Demandez à un administrateur de votre espace pour inviter un collaborateur.</p></div></section>`;
    }
    if (!local.users && !local.loading) {
      loadTeam(ctx);
      return html`<p class="loading">Chargement de l’équipe…</p>`;
    }
    if (local.error) return html`<p class="form-errors">${local.error}</p>`;
    const me = state.session.user.id;
    return html`
      <section class="card">
        <div class="table-wrap"><table class="data">
          <thead><tr><th scope="col">Membre</th><th scope="col">Rôle</th><th scope="col">Dernière connexion</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
          <tbody>${(local.users || []).map((u) => html`<tr>
            <td><span class="cell-main">${u.name}${u.id === me ? ' (vous)' : ''}</span><span class="cell-sub">${u.email}</span></td>
            <td>${u.id === me ? badge('neutral', ROLES.find((r) => r.value === u.role)?.label)
              : html`<label class="visually-hidden" for="role-${u.id}">Rôle de ${u.name}</label>
                <select id="role-${u.id}" data-action="team-role" data-id="${u.id}">${ROLES.map((r) => html`<option value="${r.value}" ${r.value === u.role ? 'selected' : ''}>${r.label}</option>`)}</select>`}</td>
            <td>${u.mustChangePassword ? badge('warning', 'Invitation en attente') : u.lastLoginAt ? fmtDate(u.lastLoginAt.slice(0, 10)) : '—'}</td>
            <td class="actions">${u.id === me ? '' : html`
              <button type="button" class="btn btn-ghost btn-small" data-action="team-reset" data-id="${u.id}">Nouveau mot de passe</button>
              <button type="button" class="btn btn-ghost btn-icon" data-action="team-remove" data-id="${u.id}" title="Retirer de l’équipe" aria-label="Retirer ${u.name}">${icon('trash')}</button>`}</td>
          </tr>`)}</tbody>
        </table></div>
      </section>
      <form class="card" data-invite-form novalidate>
        <div class="card-head"><div><h2>Inviter un collaborateur</h2><p>Un mot de passe temporaire est généré ; il le changera à sa première connexion.</p></div></div>
        <div class="card-body">
          <div class="fieldset">
            <div class="field"><label class="field-label" for="invite-name">Nom</label><input type="text" id="invite-name" name="name" maxlength="120" required autocomplete="off"></div>
            <div class="field"><label class="field-label" for="invite-email">E-mail</label><input type="email" id="invite-email" name="email" maxlength="254" required autocomplete="off"></div>
            <div class="field wide"><span class="field-label">Rôle</span>
              ${ROLES.map((r) => html`<label class="checkbox"><input type="radio" name="role" value="${r.value}" ${r.value === 'editor' ? 'checked' : ''}> <span><strong>${r.label}</strong> · ${r.text}</span></label>`)}
            </div>
          </div>
        </div>
        <div class="form-actions"><button type="submit" class="btn btn-primary">${icon('plus')}<span>Inviter</span></button></div>
      </form>`;
  },

  mount(root, ctx) {
    const form = root.querySelector('[data-invite-form]');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        const result = await state.store.invite({ name: data.get('name'), email: data.get('email'), role: data.get('role') });
        local.users = [...(local.users || []), result.user];
        ctx.rerender();
        showTemporaryPassword(result.user.name, result.temporaryPassword);
      } catch (error) {
        toast(error.message, { tone: 'error' });
      }
    });
  },

  handlers: {
    async 'team-role'(el, event, ctx) {
      try {
        const { user } = await state.store.setRole(el.dataset.id, el.value);
        local.users = local.users.map((u) => (u.id === user.id ? { ...u, role: user.role } : u));
        toast('Rôle mis à jour.');
      } catch (error) {
        toast(error.message, { tone: 'error' });
      }
      ctx.rerender();
    },
    async 'team-reset'(el) {
      const user = local.users.find((u) => u.id === el.dataset.id);
      const ok = await confirmDialog({
        title: `Nouveau mot de passe pour ${user.name} ?`,
        message: 'Ses sessions ouvertes seront fermées et il devra choisir un nouveau mot de passe.',
        confirmLabel: 'Générer',
        danger: false,
      });
      if (!ok) return;
      try {
        const { temporaryPassword } = await state.store.resetPassword(user.id);
        showTemporaryPassword(user.name, temporaryPassword);
      } catch (error) {
        toast(error.message, { tone: 'error' });
      }
    },
    async 'team-remove'(el, event, ctx) {
      const user = local.users.find((u) => u.id === el.dataset.id);
      const ok = await confirmDialog({ title: `Retirer ${user.name} ?`, message: 'Son accès est supprimé immédiatement. Les données qu’il a saisies restent.', confirmLabel: 'Retirer' });
      if (!ok) return;
      try {
        await state.store.removeMember(user.id);
        local.users = local.users.filter((u) => u.id !== user.id);
        toast('Membre retiré.');
        ctx.rerender();
      } catch (error) {
        toast(error.message, { tone: 'error' });
      }
    },
  },
};

export function resetTeamCache() {
  local.users = null;
  local.error = '';
}
