// Sign-in, sign-up and forced password change screens (server mode).

import { html, setHtml } from '../ui/dom.js';
import { brandMark, icon } from '../ui/icons.js';

const POINTS = [
  'Ruptures : ventes perdues, nettes du report des clients',
  'Opérations : non-implantation et ruptures promo',
  'Nouveaux produits : DN manquante et retards d’implantation',
  'Facings : gain d’élasticité et capacité du rayon',
];

function side() {
  return html`<aside class="auth-side">
    <div class="brand">${brandMark()}<span class="brand-name">Gondole</span></div>
    <div>
      <h1>Chiffrez ce que vos références laissent en rayon.</h1>
      <p>Le manque à gagner de vos produits en grande distribution, levier par levier et enseigne par enseigne, prêt à présenter en rendez-vous.</p>
    </div>
    <ul class="auth-points">${POINTS.map((p) => html`<li>${icon('check')}<span>${p}</span></li>`)}</ul>
  </aside>`;
}

const SCREENS = {
  login: (signupAllowed) => html`
    <h2>Connexion</h2>
    <form data-auth-form novalidate>
      <div class="field"><label class="field-label" for="auth-email">E-mail professionnel</label><input type="email" id="auth-email" name="email" autocomplete="username" required autofocus></div>
      <div class="field"><label class="field-label" for="auth-password">Mot de passe</label><input type="password" id="auth-password" name="password" autocomplete="current-password" required></div>
      <p class="form-errors" role="alert" hidden></p>
      <button type="submit" class="btn btn-primary">Se connecter</button>
    </form>
    ${signupAllowed ? html`<p class="auth-switch">Pas encore d’espace ? <button type="button" class="link-button" data-auth-go="signup">Créer l’espace de votre entreprise</button></p>` : ''}
    <p class="auth-switch">Envie de voir avant ? <button type="button" class="link-button" data-auth-demo>Essayer la démonstration</button></p>`,
  signup: () => html`
    <h2>Créer votre espace</h2>
    <form data-auth-form novalidate>
      <div class="field"><label class="field-label" for="auth-org">Entreprise</label><input type="text" id="auth-org" name="orgName" maxlength="120" autocomplete="organization" required autofocus></div>
      <div class="field"><label class="field-label" for="auth-name">Votre nom</label><input type="text" id="auth-name" name="name" maxlength="120" autocomplete="name" required></div>
      <div class="field"><label class="field-label" for="auth-email">E-mail professionnel</label><input type="email" id="auth-email" name="email" autocomplete="email" required></div>
      <div class="field"><label class="field-label" for="auth-password">Mot de passe</label><input type="password" id="auth-password" name="password" autocomplete="new-password" minlength="10" required><span class="field-help">10 caractères minimum.</span></div>
      <p class="form-errors" role="alert" hidden></p>
      <button type="submit" class="btn btn-primary">Créer l’espace</button>
    </form>
    <p class="auth-switch">Déjà inscrit ? <button type="button" class="link-button" data-auth-go="login">Se connecter</button></p>`,
  'change-password': () => html`
    <h2>Choisissez votre mot de passe</h2>
    <p class="ink-2">Vous vous connectez avec un mot de passe temporaire. Remplacez-le pour accéder à l’espace.</p>
    <form data-auth-form novalidate>
      <div class="field"><label class="field-label" for="auth-current">Mot de passe temporaire</label><input type="password" id="auth-current" name="currentPassword" autocomplete="current-password" required autofocus></div>
      <div class="field"><label class="field-label" for="auth-new">Nouveau mot de passe</label><input type="password" id="auth-new" name="newPassword" autocomplete="new-password" minlength="10" required><span class="field-help">10 caractères minimum.</span></div>
      <p class="form-errors" role="alert" hidden></p>
      <button type="submit" class="btn btn-primary">Enregistrer et continuer</button>
    </form>`,
};

/**
 * Renders an auth screen into `root`. Callbacks: onSession(session) after a
 * successful sign-in, onDemo() to switch to the browser-only demo.
 */
export function renderAuth(root, { screen, signupAllowed, store, onSession, onDemo }) {
  document.title = 'Connexion · Gondole';
  setHtml(root, html`<div class="auth">${side()}<main class="auth-main"><div class="auth-card">${SCREENS[screen](signupAllowed)}</div></main></div>`);
  root.querySelector('[autofocus]')?.focus();
  root.querySelectorAll('[data-auth-go]').forEach((el) => el.addEventListener('click', () => {
    renderAuth(root, { screen: el.dataset.authGo, signupAllowed, store, onSession, onDemo });
  }));
  root.querySelector('[data-auth-demo]')?.addEventListener('click', onDemo);

  const form = root.querySelector('[data-auth-form]');
  const errors = form.querySelector('.form-errors');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    errors.hidden = true;
    try {
      let session;
      if (screen === 'login') session = await store.login(data.email, data.password);
      else if (screen === 'signup') session = await store.signup(data);
      else session = await store.changePassword(data.currentPassword, data.newPassword);
      await onSession(session);
    } catch (error) {
      errors.textContent = error.message;
      errors.hidden = false;
      submit.disabled = false;
    }
  });
}
