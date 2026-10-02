import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let server;
let base;
let clock = Date.parse('2026-10-02T08:00:00Z');

before(async () => {
  const repo = openDatabase(':memory:');
  const config = {
    publicDir: path.join(here, '..', 'public'),
    allowSignup: true,
    cookieSecure: 'false',
    trustProxy: false,
    sessionDays: 30,
    log: false,
    rateLimits: { signup: 1000 },
  };
  server = http.createServer(createApp({ repo, config, now: () => new Date(clock) }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

/** Minimal client keeping its own session cookie. */
function client() {
  let cookie = '';
  return async function call(method, url, body, headers = {}) {
    const init = { method, headers: { ...headers } };
    if (cookie) init.headers.cookie = cookie;
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['content-type'] ??= 'application/json';
    }
    const res = await fetch(base + url, init);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0].endsWith('=') ? '' : setCookie.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  };
}

/** Sends a path exactly as written (fetch would normalise "..") and returns the status. */
function rawStatus(rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: rawPath }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
}

const PRODUCT = { name: 'Cookies 200 g', ean: '2990417001006', pvcTtc: 2.39, netPrice: 1.52, unitCost: 0.95, rot: 7.8 };

async function signup(call, orgName, address) {
  const res = await call('POST', '/api/auth/signup', { orgName, name: 'Admin', email: address, password: 'motdepasse-solide' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res;
}

test('health and anonymous session', async () => {
  const call = client();
  assert.deepEqual((await call('GET', '/api/health')).data, { ok: true });
  const session = await call('GET', '/api/session');
  assert.equal(session.data.authenticated, false);
  assert.equal(session.data.signupAllowed, true);
  assert.equal((await call('GET', '/api/data')).status, 401);
});

test('security headers are set', async () => {
  const res = await client()('GET', '/api/health');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

test('signup validates input and refuses duplicates', async () => {
  const call = client();
  const weak = await call('POST', '/api/auth/signup', { orgName: 'X', name: 'Y', email: 'weak@example.com', password: 'court' });
  assert.equal(weak.status, 422);
  const badEmail = await call('POST', '/api/auth/signup', { orgName: 'X', name: 'Y', email: 'pas-un-email', password: 'motdepasse-solide' });
  assert.equal(badEmail.status, 422);
  const res = await signup(call, 'Biscuiterie A', 'a@example.com');
  assert.equal(res.data.user.role, 'admin');
  assert.match(res.headers.get('set-cookie'), /HttpOnly/);
  assert.match(res.headers.get('set-cookie'), /SameSite=Lax/);
  const dup = await client()('POST', '/api/auth/signup', { orgName: 'Z', name: 'Z', email: 'A@example.com', password: 'motdepasse-solide' });
  assert.equal(dup.status, 409);
});

test('login, logout and wrong password', async () => {
  const call = client();
  await signup(call, 'Login SA', 'login@example.com');
  assert.equal((await call('POST', '/api/auth/logout', {})).status, 200);
  assert.equal((await call('GET', '/api/data')).status, 401);
  const wrong = await call('POST', '/api/auth/login', { email: 'login@example.com', password: 'mauvais-mot-de-passe' });
  assert.equal(wrong.status, 401);
  const unknown = await call('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'mauvais-mot-de-passe' });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.data.error, wrong.data.error);
  const ok = await call('POST', '/api/auth/login', { email: 'LOGIN@example.com', password: 'motdepasse-solide' });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/api/data')).status, 200);
});

test('records CRUD with validation', async () => {
  const call = client();
  await signup(call, 'CRUD SAS', 'crud@example.com');
  const invalid = await call('POST', '/api/records/products', { record: { name: '', pvcTtc: 'abc' } });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.data.fields.name, 'Champ obligatoire.');
  assert.equal(invalid.data.fields.pvcTtc, 'Nombre invalide.');

  const created = await call('POST', '/api/records/products', { record: { ...PRODUCT, injected: '<script>' } });
  assert.equal(created.status, 201);
  const product = created.data.record;
  assert.equal(product.injected, undefined);
  assert.ok(product.id && product.createdAt);

  const updated = await call('PUT', `/api/records/products/${product.id}`, { record: { ...PRODUCT, pvcTtc: '2,49' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.record.pvcTtc, 2.49);

  const data = await call('GET', '/api/data');
  assert.equal(data.data.collections.products.length, 1);
  assert.equal(data.data.settings.oosOtherBrand, 26);

  assert.equal((await call('POST', '/api/records/unknown', { record: {} })).status, 404);
  assert.equal((await call('DELETE', `/api/records/products/${product.id}`)).status, 200);
  assert.equal((await call('GET', '/api/data')).data.collections.products.length, 0);
});

test('organisations are isolated from each other', async () => {
  const a = client();
  const b = client();
  await signup(a, 'Org A', 'iso-a@example.com');
  await signup(b, 'Org B', 'iso-b@example.com');
  const product = (await a('POST', '/api/records/products', { record: PRODUCT })).data.record;
  const retailer = (await a('POST', '/api/records/retailers', { record: { name: 'Intermarché', stores: 1800 } })).data.record;

  assert.equal((await b('GET', '/api/data')).data.collections.products.length, 0);
  assert.equal((await b('PUT', `/api/records/products/${product.id}`, { record: PRODUCT })).status, 404);
  assert.equal((await b('DELETE', `/api/records/products/${product.id}`)).status, 404);

  const bRetailer = (await b('POST', '/api/records/retailers', { record: { name: 'Leclerc' } })).data.record;
  const crossRef = await b('POST', '/api/records/stockouts', {
    record: { productId: product.id, retailerId: bRetailer.id, startDate: '2026-09-01', stores: 1 },
  });
  assert.equal(crossRef.status, 422);
  assert.equal(crossRef.data.fields.productId, 'Produit introuvable.');

  const ok = await a('POST', '/api/records/stockouts', {
    record: { productId: product.id, retailerId: retailer.id, startDate: '2026-09-01', endDate: '2026-09-05', stores: 3 },
  });
  assert.equal(ok.status, 201);
});

test('deleting a referenced product needs confirmation, then cascades', async () => {
  const call = client();
  await signup(call, 'Cascade', 'cascade@example.com');
  const product = (await call('POST', '/api/records/products', { record: PRODUCT })).data.record;
  const retailer = (await call('POST', '/api/records/retailers', { record: { name: 'Auchan' } })).data.record;
  await call('POST', '/api/records/facings', {
    record: { productId: product.id, retailerId: retailer.id, stores: 10, currentFacings: 2, proposedFacings: 3 },
  });
  const blocked = await call('DELETE', `/api/records/products/${product.id}`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.references, 1);
  const cascade = await call('DELETE', `/api/records/products/${product.id}?cascade=1`);
  assert.equal(cascade.status, 200);
  assert.equal(cascade.data.removedReferences, 1);
  const data = (await call('GET', '/api/data')).data.collections;
  assert.equal(data.products.length, 0);
  assert.equal(data.facings.length, 0);
  assert.equal(data.retailers.length, 1);
});

test('bulk import: upsert, new retailers, atomic failure and replace', async () => {
  const call = client();
  await signup(call, 'Import', 'import@example.com');
  const first = await call('POST', '/api/records/products/import', {
    mode: 'upsert',
    records: [PRODUCT, { name: 'Galettes 130 g', pvcTtc: 2.15, netPrice: 1.38 }],
  });
  assert.deepEqual(first.data, { created: 2, updated: 0, removed: 0, retailersCreated: 0 });
  const second = await call('POST', '/api/records/products/import', {
    mode: 'upsert',
    records: [{ ...PRODUCT, name: 'Cookies renommés' }],
  });
  assert.equal(second.data.updated, 1);
  let data = (await call('GET', '/api/data')).data.collections;
  assert.equal(data.products.length, 2);
  assert.ok(data.products.some((p) => p.name === 'Cookies renommés' && p.rot === 7.8));

  const productId = data.products[0].id;
  const line = (retailerId) => ({ productId, retailerId, stores: 5, currentFacings: 1, proposedFacings: 2 });
  const failed = await call('POST', '/api/records/facings/import', {
    mode: 'append',
    newRetailers: [{ tempId: 'tmp-1', name: 'Lidl' }],
    records: [line('tmp-1'), { ...line('tmp-1'), proposedFacings: 'beaucoup' }],
  });
  assert.equal(failed.status, 422);
  assert.equal(failed.data.rows[0].index, 1);
  data = (await call('GET', '/api/data')).data.collections;
  assert.equal(data.retailers.length, 0, 'failed import must not leave new retailers behind');

  const imported = await call('POST', '/api/records/facings/import', {
    mode: 'append',
    newRetailers: [{ tempId: 'tmp-1', name: 'Lidl' }],
    records: [line('tmp-1'), line('tmp-1')],
  });
  assert.deepEqual(imported.data, { created: 2, updated: 0, removed: 0, retailersCreated: 1 });
  const replaced = await call('POST', '/api/records/facings/import', {
    mode: 'replace',
    records: [line((await call('GET', '/api/data')).data.collections.retailers[0].id)],
  });
  assert.equal(replaced.data.removed, 2);
  assert.equal(replaced.data.created, 1);
  const badMode = await call('POST', '/api/records/products/import', { mode: 'replace', records: [] });
  assert.equal(badMode.status, 422);
});

test('settings are validated and saved', async () => {
  const call = client();
  await signup(call, 'Settings', 'settings@example.com');
  const bad = await call('PUT', '/api/settings', { settings: { oosNoPurchase: 50 } });
  assert.equal(bad.status, 422);
  assert.ok(bad.data.fields.oosBehavior);
  const ok = await call('PUT', '/api/settings', { settings: { shelfElasticity: 0.2, horizonWeeks: 26 } });
  assert.equal(ok.status, 200);
  const data = (await call('GET', '/api/data')).data;
  assert.equal(data.settings.shelfElasticity, 0.2);
  assert.equal(data.settings.horizonWeeks, 26);
});

test('team: invitations, forced password change and roles', async () => {
  const admin = client();
  await signup(admin, 'Team', 'team-admin@example.com');
  const invited = await admin('POST', '/api/team', { name: 'Chef de secteur', email: 'cds@example.com', role: 'viewer' });
  assert.equal(invited.status, 201);
  const temporary = invited.data.temporaryPassword;
  assert.match(temporary, /^\w{4}-\w{4}-\w{4}$/);

  const member = client();
  const login = await member('POST', '/api/auth/login', { email: 'cds@example.com', password: temporary });
  assert.equal(login.data.user.mustChangePassword, true);
  const blocked = await member('GET', '/api/data');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'PASSWORD_CHANGE_REQUIRED');
  const changed = await member('POST', '/api/account/password', { currentPassword: temporary, newPassword: 'nouveau-mot-de-passe' });
  assert.equal(changed.status, 200);
  assert.equal((await member('GET', '/api/data')).status, 200);

  assert.equal((await member('POST', '/api/records/retailers', { record: { name: 'Casino' } })).status, 403);
  assert.equal((await member('GET', '/api/team')).status, 403);

  const memberId = invited.data.user.id;
  assert.equal((await admin('PATCH', `/api/team/${memberId}`, { role: 'editor' })).status, 200);
  assert.equal((await member('POST', '/api/records/retailers', { record: { name: 'Casino' } })).status, 201);
  assert.equal((await member('PUT', '/api/settings', { settings: {} })).status, 403);

  const team = (await admin('GET', '/api/team')).data.users;
  const self = team.find((u) => u.email === 'team-admin@example.com');
  assert.equal((await admin('PATCH', `/api/team/${self.id}`, { role: 'viewer' })).status, 422);
  assert.equal((await admin('DELETE', `/api/team/${self.id}`)).status, 422);

  const reset = await admin('POST', `/api/team/${memberId}/reset-password`, {});
  assert.equal(reset.status, 200);
  assert.equal((await member('GET', '/api/data')).status, 401, 'reset logs the member out');
  assert.equal((await admin('DELETE', `/api/team/${memberId}`)).status, 200);
});

test('demo data load, export and organisation deletion', async () => {
  const call = client();
  await signup(call, 'Demo', 'demo@example.com');
  const loaded = await call('POST', '/api/demo', {});
  assert.equal(loaded.status, 200);
  assert.ok(loaded.data.loaded > 50);
  const data = (await call('GET', '/api/data')).data.collections;
  assert.equal(data.products.length, 11);
  const productIds = new Set(data.products.map((p) => p.id));
  assert.ok(data.stockouts.every((s) => productIds.has(s.productId)));

  const exported = await call('GET', '/api/export');
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  assert.equal(exported.data.users[0].email, 'demo@example.com');
  assert.equal(exported.data.users[0].passwordHash, undefined);

  assert.equal((await call('DELETE', '/api/org', { password: 'mauvais-mot-de-passe' })).status, 422);
  assert.equal((await call('DELETE', '/api/org', { password: 'motdepasse-solide' })).status, 200);
  assert.equal((await call('GET', '/api/data')).status, 401);
  const relogin = await client()('POST', '/api/auth/login', { email: 'demo@example.com', password: 'motdepasse-solide' });
  assert.equal(relogin.status, 401);
});

test('cross-site and non-JSON writes are refused', async () => {
  const call = client();
  await signup(call, 'Csrf', 'csrf@example.com');
  const foreign = await call('POST', '/api/records/retailers', { record: { name: 'X' } }, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  const form = await call('POST', '/api/records/retailers', { record: { name: 'X' } }, { 'content-type': 'text/plain' });
  assert.equal(form.status, 415);
  const sameOrigin = await call('POST', '/api/records/retailers', { record: { name: 'X' } }, { origin: base });
  assert.equal(sameOrigin.status, 201);
});

test('sessions expire', async () => {
  const call = client();
  await signup(call, 'Expiry', 'expiry@example.com');
  assert.equal((await call('GET', '/api/data')).status, 200);
  clock += 31 * 86400000;
  try {
    assert.equal((await call('GET', '/api/data')).status, 401);
  } finally {
    clock -= 31 * 86400000;
  }
});

test('login attempts are rate limited', async () => {
  const call = client();
  const attempts = [];
  for (let i = 0; i < 11; i += 1) {
    attempts.push((await call('POST', '/api/auth/login', { email: 'brute@example.com', password: `essai-numero-${i}` })).status);
  }
  assert.deepEqual(attempts.slice(0, 10), Array(10).fill(401));
  assert.equal(attempts[10], 429);
});

test('static files are served without leaving the public folder', async () => {
  const call = client();
  const js = await call('GET', '/js/core/calc.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const etag = js.headers.get('etag');
  assert.equal((await call('GET', '/js/core/calc.js', undefined, { 'if-none-match': etag })).status, 304);
  assert.equal((await call('GET', '/../server/app.js')).status, 404);
  assert.equal((await call('GET', '/%2e%2e/server/app.js')).status, 404);
  assert.equal((await call('GET', '/.env')).status, 404);
  assert.equal((await call('GET', '/nope.js')).status, 404);
  for (const raw of ['/../server/app.js', '/js/../../server/app.js', '/%2e%2e/%2e%2e/package.json', '/..%2fpackage.json']) {
    assert.equal(await rawStatus(raw), 404, raw);
  }
  assert.equal((await call('GET', '/%E0%A4%A')).status, 400);
});
