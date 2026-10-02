// Server mode: every change goes through the JSON API under ./api/.

import { StoreError } from './store-error.js';

export class ApiStore {
  constructor() {
    this.mode = 'server';
  }

  async request(method, path, body) {
    const init = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(`api/${path}`, init);
    } catch {
      throw new StoreError('Connexion au serveur impossible. Vérifiez votre réseau puis réessayez.', { status: 0 });
    }
    const isJson = (response.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await response.json() : null;
    if (!response.ok) {
      if (response.status === 401 && !path.startsWith('auth/') && path !== 'session' && path !== 'account/password') {
        window.dispatchEvent(new Event('gondole:unauthorized'));
      }
      throw new StoreError(data?.error || `Erreur ${response.status}.`, { status: response.status, ...(data || {}) });
    }
    return data;
  }

  session() { return this.request('GET', 'session'); }
  login(email, password) { return this.request('POST', 'auth/login', { email, password }); }
  signup(payload) { return this.request('POST', 'auth/signup', payload); }
  logout() { return this.request('POST', 'auth/logout', {}); }
  changePassword(currentPassword, newPassword) { return this.request('POST', 'account/password', { currentPassword, newPassword }); }

  load() { return this.request('GET', 'data'); }

  async create(collection, record) {
    return (await this.request('POST', `records/${collection}`, { record })).record;
  }

  async update(collection, id, record) {
    return (await this.request('PUT', `records/${collection}/${encodeURIComponent(id)}`, { record })).record;
  }

  remove(collection, id, { cascade = false } = {}) {
    return this.request('DELETE', `records/${collection}/${encodeURIComponent(id)}${cascade ? '?cascade=1' : ''}`);
  }

  import(collection, payload) { return this.request('POST', `records/${collection}/import`, payload); }

  async saveSettings(settings) {
    return (await this.request('PUT', 'settings', { settings })).settings;
  }

  async renameOrg(name) {
    return (await this.request('PUT', 'org', { name })).org;
  }

  loadDemo() { return this.request('POST', 'demo', {}); }
  clearAll() { return this.request('DELETE', 'data'); }
  exportData() { return this.request('GET', 'export'); }
  deleteOrg(password) { return this.request('DELETE', 'org', { password }); }

  listTeam() { return this.request('GET', 'team'); }
  invite(member) { return this.request('POST', 'team', member); }
  setRole(id, role) { return this.request('PATCH', `team/${encodeURIComponent(id)}`, { role }); }
  resetPassword(id) { return this.request('POST', `team/${encodeURIComponent(id)}/reset-password`, {}); }
  removeMember(id) { return this.request('DELETE', `team/${encodeURIComponent(id)}`); }
}

/** True when this page is served by the Gondole server (not a static host). */
export async function detectServer() {
  try {
    const response = await fetch('api/session', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!(response.headers.get('content-type') || '').includes('application/json')) return null;
    const data = await response.json();
    return typeof data?.authenticated === 'boolean' ? data : null;
  } catch {
    return null;
  }
}
