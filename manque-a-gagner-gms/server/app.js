// Request handler: JSON API under /api, static web app everywhere else.

import crypto from 'node:crypto';
import { COLLECTION_KEYS, LEVERS, validateRecord } from '../public/js/core/schema.js';
import { DEFAULT_SETTINGS, normalizeSettings, validateSettings } from '../public/js/core/settings.js';
import { IMPORT_MODES, planImport } from '../public/js/core/io.js';
import { buildDemoData, DEMO_COMPANY } from '../public/js/core/demo-data.js';
import { todayISO } from '../public/js/core/dates.js';
import {
  DUMMY_HASH,
  RateLimiter,
  hashPassword,
  hashToken,
  newSessionToken,
  temporaryPassword,
  verifyPassword,
} from './auth.js';
import {
  HttpError,
  parseCookies,
  readJson,
  sendJson,
  serializeCookie,
  serveStatic,
  setSecurityHeaders,
} from './http.js';

const COOKIE = 'gondole_session';
const ROLES = ['viewer', 'editor', 'admin'];
const ROLE_LABELS = { admin: 'Administrateur', editor: 'Éditeur', viewer: 'Lecteur' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 10;
const MAX_IMPORT_ROWS = 20000;
const MAX_RECORDS_PER_ORG = 200000;
const JSON_LIMIT = 1024 * 1024;
const IMPORT_LIMIT = 20 * 1024 * 1024;

const newId = () => crypto.randomUUID();

function text(value, label, { min = 1, max = 120 } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < min) throw new HttpError(422, `${label} : champ obligatoire.`);
  if (s.length > max) throw new HttpError(422, `${label} : ${max} caractères maximum.`);
  return s;
}

function email(value) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(s) || s.length > 254) throw new HttpError(422, 'Adresse e-mail invalide.');
  return s;
}

function password(value, label = 'Mot de passe') {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD) {
    throw new HttpError(422, `${label} : ${MIN_PASSWORD} caractères minimum.`);
  }
  if (value.length > 200) throw new HttpError(422, `${label} : 200 caractères maximum.`);
  return value;
}

export function createApp({ repo, config, now = () => new Date() }) {
  const quotas = { login: 10, loginIp: 50, signup: 10, ...config.rateLimits };
  const limits = {
    login: new RateLimiter(quotas.login, 15 * 60 * 1000),
    loginIp: new RateLimiter(quotas.loginIp, 15 * 60 * 1000),
    signup: new RateLimiter(quotas.signup, 60 * 60 * 1000),
  };

  const iso = () => now().toISOString();

  function clientIp(req) {
    if (config.trustProxy) {
      const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (forwarded) return forwarded;
    }
    return req.socket.remoteAddress || 'unknown';
  }

  function isSecure(req) {
    if (config.cookieSecure === 'true') return true;
    if (config.cookieSecure === 'false') return false;
    if (req.socket.encrypted) return true;
    return config.trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  }

  function checkOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return;
    const host = (config.trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'Origine refusée.');
    }
    if (originHost !== host) throw new HttpError(403, 'Origine refusée.');
  }

  // ------------------------------------------------------------- sessions
  function startSession(ctx, user) {
    const token = newSessionToken();
    const created = now();
    const expires = new Date(created.getTime() + config.sessionDays * 86400000);
    repo.createSession(hashToken(token), user.id, created.toISOString(), expires.toISOString());
    repo.touchLogin(user.id, created.toISOString());
    ctx.res.setHeader('Set-Cookie', serializeCookie(COOKIE, token, {
      maxAge: config.sessionDays * 86400,
      secure: ctx.secure,
    }));
    return hashToken(token);
  }

  function clearCookie(ctx) {
    ctx.res.setHeader('Set-Cookie', serializeCookie(COOKIE, '', { maxAge: 0, secure: ctx.secure }));
  }

  function loadSession(ctx) {
    const token = parseCookies(ctx.req.headers.cookie)[COOKIE];
    if (!token) return;
    const tokenHash = hashToken(token);
    const session = repo.getSession(tokenHash);
    if (!session) return;
    if (session.expiresAt <= iso()) {
      repo.deleteSession(tokenHash);
      return;
    }
    ctx.tokenHash = tokenHash;
    ctx.user = session.user;
    ctx.org = repo.getOrg(session.user.orgId);
  }

  function sessionPayload(user, org) {
    return {
      authenticated: true,
      signupAllowed: config.allowSignup,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      org: { id: org.id, name: org.name },
    };
  }

  function requireUser(ctx, role = 'viewer') {
    if (!ctx.user || !ctx.org) throw new HttpError(401, 'Connectez-vous pour continuer.');
    if (ctx.user.mustChangePassword) {
      throw new HttpError(403, 'Choisissez d’abord votre mot de passe personnel.', { code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    if (ROLES.indexOf(ctx.user.role) < ROLES.indexOf(role)) {
      throw new HttpError(403, `Action réservée au rôle ${ROLE_LABELS[role]}.`);
    }
  }

  function collectionParam(name) {
    if (!COLLECTION_KEYS.includes(name)) throw new HttpError(404, 'Collection inconnue.');
    return name;
  }

  function validateOrThrow(ctx, collection, input, extraRefs) {
    const { value, errors, ok } = validateRecord(collection, input, {
      refExists: (refCollection, id) => (extraRefs?.has(id) && refCollection === 'retailers')
        || repo.recordExists(ctx.org.id, refCollection, id),
    });
    if (!ok) throw new HttpError(422, 'Certains champs sont invalides.', { fields: errors });
    return value;
  }

  function ensureCapacity(ctx, adding) {
    if (repo.countRecords(ctx.org.id) + adding > MAX_RECORDS_PER_ORG) {
      throw new HttpError(422, `Limite de ${MAX_RECORDS_PER_ORG.toLocaleString('fr-FR')} lignes atteinte pour cet espace.`);
    }
  }

  // --------------------------------------------------------------- routes
  const routes = [];
  const route = (method, pattern, handler, options = {}) => routes.push({ method, pattern, handler, options });

  route('GET', /^\/api\/health$/, () => ({ ok: true }));

  route('GET', /^\/api\/session$/, (ctx) => {
    if (!ctx.user || !ctx.org) return { authenticated: false, signupAllowed: config.allowSignup };
    return sessionPayload(ctx.user, ctx.org);
  });

  route('POST', /^\/api\/auth\/signup$/, async (ctx) => {
    if (!config.allowSignup) throw new HttpError(403, 'Les inscriptions sont fermées : demandez une invitation.');
    if (!limits.signup.hit(ctx.ip)) throw new HttpError(429, 'Trop de tentatives. Réessayez dans une heure.');
    const body = ctx.body;
    const orgName = text(body.orgName, 'Entreprise');
    const name = text(body.name, 'Nom');
    const address = email(body.email);
    const secret = password(body.password);
    if (repo.getUserByEmail(address)) throw new HttpError(409, 'Un compte existe déjà avec cette adresse e-mail.');
    const passwordHash = await hashPassword(secret);
    const org = { id: newId(), name: orgName, settings: { ...DEFAULT_SETTINGS }, createdAt: iso() };
    const user = {
      id: newId(),
      orgId: org.id,
      email: address,
      name,
      role: 'admin',
      passwordHash,
      mustChangePassword: false,
      createdAt: iso(),
    };
    repo.transaction(() => {
      repo.createOrg(org);
      repo.createUser(user);
    });
    startSession(ctx, user);
    ctx.status = 201;
    return sessionPayload(user, org);
  });

  route('POST', /^\/api\/auth\/login$/, async (ctx) => {
    const address = typeof ctx.body.email === 'string' ? ctx.body.email.trim().toLowerCase() : '';
    const secret = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    const key = `${ctx.ip}|${address}`;
    if (!limits.loginIp.hit(ctx.ip) || !limits.login.hit(key)) {
      throw new HttpError(429, 'Trop de tentatives de connexion. Réessayez dans 15 minutes.');
    }
    const user = address ? repo.getUserByEmail(address) : undefined;
    const valid = user
      ? await verifyPassword(secret, user.passwordHash)
      : (await verifyPassword(secret, DUMMY_HASH), false);
    if (!valid) throw new HttpError(401, 'E-mail ou mot de passe incorrect.');
    limits.login.clear(key);
    startSession(ctx, user);
    return sessionPayload(user, repo.getOrg(user.orgId));
  });

  route('POST', /^\/api\/auth\/logout$/, (ctx) => {
    if (ctx.tokenHash) repo.deleteSession(ctx.tokenHash);
    clearCookie(ctx);
    return { authenticated: false, signupAllowed: config.allowSignup };
  });

  route('POST', /^\/api\/account\/password$/, async (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'Connectez-vous pour continuer.');
    const current = typeof ctx.body.currentPassword === 'string' ? ctx.body.currentPassword : '';
    const next = password(ctx.body.newPassword, 'Nouveau mot de passe');
    if (!(await verifyPassword(current, ctx.user.passwordHash))) {
      throw new HttpError(422, 'Mot de passe actuel incorrect.', { fields: { currentPassword: 'Mot de passe actuel incorrect.' } });
    }
    if (current === next) throw new HttpError(422, 'Choisissez un mot de passe différent de l’actuel.');
    repo.updateUserPassword(ctx.user.id, await hashPassword(next), false);
    repo.deleteUserSessions(ctx.user.id, ctx.tokenHash);
    const user = { ...ctx.user, mustChangePassword: false };
    return sessionPayload(user, ctx.org);
  });

  route('GET', /^\/api\/data$/, (ctx) => {
    requireUser(ctx);
    return {
      org: { id: ctx.org.id, name: ctx.org.name },
      settings: normalizeSettings(ctx.org.settings),
      collections: repo.listAllRecords(ctx.org.id),
    };
  });

  route('POST', /^\/api\/records\/([a-z]+)$/, (ctx, [name]) => {
    requireUser(ctx, 'editor');
    const collection = collectionParam(name);
    ensureCapacity(ctx, 1);
    const value = validateOrThrow(ctx, collection, ctx.body.record);
    ctx.status = 201;
    return { record: repo.insertRecord(ctx.org.id, collection, newId(), value, ctx.user.id, iso()) };
  });

  route('PUT', /^\/api\/records\/([a-z]+)\/([\w-]{1,64})$/, (ctx, [name, id]) => {
    requireUser(ctx, 'editor');
    const collection = collectionParam(name);
    const existing = repo.getRecord(ctx.org.id, collection, id);
    if (!existing) throw new HttpError(404, 'Ligne introuvable.');
    const value = validateOrThrow(ctx, collection, ctx.body.record);
    const at = iso();
    repo.updateRecord(ctx.org.id, collection, id, value, ctx.user.id, at);
    return { record: { id, ...value, createdAt: existing.createdAt, updatedAt: at } };
  });

  route('DELETE', /^\/api\/records\/([a-z]+)\/([\w-]{1,64})$/, (ctx, [name, id]) => {
    requireUser(ctx, 'editor');
    const collection = collectionParam(name);
    if (!repo.recordExists(ctx.org.id, collection, id)) throw new HttpError(404, 'Ligne introuvable.');
    const field = collection === 'products' ? 'productId' : collection === 'retailers' ? 'retailerId' : null;
    let removedReferences = 0;
    repo.transaction(() => {
      if (field) {
        const references = repo.countReferences(ctx.org.id, field, id);
        if (references > 0 && ctx.url.searchParams.get('cascade') !== '1') {
          throw new HttpError(409, `Cette fiche est utilisée par ${references} ligne${references > 1 ? 's' : ''} d’analyse.`, { references });
        }
        removedReferences = repo.deleteReferences(ctx.org.id, field, id);
      }
      repo.deleteRecord(ctx.org.id, collection, id);
    });
    return { deleted: id, removedReferences };
  });

  route('POST', /^\/api\/records\/([a-z]+)\/import$/, (ctx, [name]) => {
    requireUser(ctx, 'editor');
    const collection = collectionParam(name);
    const { records, mode = 'append', newRetailers = [] } = ctx.body;
    if (!Array.isArray(records) || !Array.isArray(newRetailers)) throw new HttpError(400, 'Liste de lignes attendue.');
    if (!IMPORT_MODES[collection].includes(mode)) throw new HttpError(422, 'Mode d’import non disponible pour ces données.');
    if (records.length > MAX_IMPORT_ROWS) {
      throw new HttpError(422, `Import limité à ${MAX_IMPORT_ROWS.toLocaleString('fr-FR')} lignes par fichier.`);
    }
    if (newRetailers.length && !LEVERS.includes(collection)) throw new HttpError(422, 'Création d’enseignes non prévue ici.');
    ensureCapacity(ctx, records.length + newRetailers.length);

    return repo.transaction(() => {
      const at = iso();
      const tempIds = new Map();
      for (const retailer of newRetailers) {
        const value = validateOrThrow(ctx, 'retailers', retailer);
        const id = newId();
        repo.insertRecord(ctx.org.id, 'retailers', id, value, ctx.user.id, at);
        if (typeof retailer.tempId === 'string') tempIds.set(retailer.tempId, id);
      }
      const knownNew = new Set(tempIds.values());
      const rows = [];
      const rowErrors = [];
      records.forEach((input, index) => {
        const source = input && typeof input === 'object' ? { ...input } : {};
        if (tempIds.has(source.retailerId)) source.retailerId = tempIds.get(source.retailerId);
        const { value, errors, ok } = validateRecord(collection, source, {
          refExists: (refCollection, id) => (refCollection === 'retailers' && knownNew.has(id))
            || repo.recordExists(ctx.org.id, refCollection, id),
        });
        if (ok) rows.push(value);
        else if (rowErrors.length < 50) rowErrors.push({ index, fields: errors });
      });
      if (rowErrors.length) throw new HttpError(422, 'Certaines lignes sont invalides : rien n’a été importé.', { rows: rowErrors });

      const plan = planImport(collection, repo.listRecords(ctx.org.id, collection), rows, mode);
      const removed = plan.removeAll ? repo.deleteCollection(ctx.org.id, collection) : 0;
      for (const record of plan.create) repo.insertRecord(ctx.org.id, collection, newId(), record, ctx.user.id, at);
      for (const { id, record } of plan.update) {
        const { id: _id, createdAt, updatedAt, ...data } = record;
        const value = validateOrThrow(ctx, collection, data);
        repo.updateRecord(ctx.org.id, collection, id, value, ctx.user.id, at);
      }
      return {
        created: plan.create.length,
        updated: plan.update.length,
        removed,
        retailersCreated: tempIds.size,
      };
    });
  }, { limit: IMPORT_LIMIT });

  route('POST', /^\/api\/demo$/, (ctx) => {
    requireUser(ctx, 'admin');
    const demo = buildDemoData(todayISO(now()), newId);
    return repo.transaction(() => {
      repo.deleteAllRecords(ctx.org.id);
      const at = iso();
      let count = 0;
      for (const collection of COLLECTION_KEYS) {
        for (const { id, ...data } of demo[collection]) {
          repo.insertRecord(ctx.org.id, collection, id, data, ctx.user.id, at);
          count += 1;
        }
      }
      return { loaded: count, company: DEMO_COMPANY };
    });
  });

  route('DELETE', /^\/api\/data$/, (ctx) => {
    requireUser(ctx, 'admin');
    return { removed: repo.deleteAllRecords(ctx.org.id) };
  });

  route('PUT', /^\/api\/settings$/, (ctx) => {
    requireUser(ctx, 'admin');
    const { value, errors, ok } = validateSettings(ctx.body.settings);
    if (!ok) throw new HttpError(422, 'Certains paramètres sont invalides.', { fields: errors });
    repo.updateOrgSettings(ctx.org.id, value);
    return { settings: value };
  });

  route('PUT', /^\/api\/org$/, (ctx) => {
    requireUser(ctx, 'admin');
    const name = text(ctx.body.name, 'Entreprise');
    repo.updateOrgName(ctx.org.id, name);
    return { org: { id: ctx.org.id, name } };
  });

  route('DELETE', /^\/api\/org$/, async (ctx) => {
    requireUser(ctx, 'admin');
    const secret = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    if (!(await verifyPassword(secret, ctx.user.passwordHash))) {
      throw new HttpError(422, 'Mot de passe incorrect.', { fields: { password: 'Mot de passe incorrect.' } });
    }
    repo.deleteOrg(ctx.org.id);
    clearCookie(ctx);
    return { deleted: true };
  });

  route('GET', /^\/api\/export$/, (ctx) => {
    requireUser(ctx, 'admin');
    ctx.headers['Content-Disposition'] = `attachment; filename="gondole-export-${todayISO(now())}.json"`;
    return {
      exportedAt: iso(),
      org: { id: ctx.org.id, name: ctx.org.name, createdAt: ctx.org.createdAt },
      settings: normalizeSettings(ctx.org.settings),
      users: repo.listUsers(ctx.org.id).map(({ name, email: address, role, createdAt, lastLoginAt }) => ({
        name,
        email: address,
        role,
        createdAt,
        lastLoginAt,
      })),
      collections: repo.listAllRecords(ctx.org.id),
    };
  });

  const publicUser = (u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  });

  route('GET', /^\/api\/team$/, (ctx) => {
    requireUser(ctx, 'admin');
    return { users: repo.listUsers(ctx.org.id).map(publicUser) };
  });

  route('POST', /^\/api\/team$/, async (ctx) => {
    requireUser(ctx, 'admin');
    const name = text(ctx.body.name, 'Nom');
    const address = email(ctx.body.email);
    const role = ROLES.includes(ctx.body.role) ? ctx.body.role : 'editor';
    if (repo.getUserByEmail(address)) throw new HttpError(409, 'Un compte existe déjà avec cette adresse e-mail.');
    const temporary = temporaryPassword();
    const user = {
      id: newId(),
      orgId: ctx.org.id,
      email: address,
      name,
      role,
      passwordHash: await hashPassword(temporary),
      mustChangePassword: true,
      createdAt: iso(),
    };
    repo.createUser(user);
    ctx.status = 201;
    return { user: publicUser(user), temporaryPassword: temporary };
  });

  route('PATCH', /^\/api\/team\/([\w-]{1,64})$/, (ctx, [id]) => {
    requireUser(ctx, 'admin');
    const user = repo.getUser(ctx.org.id, id);
    if (!user) throw new HttpError(404, 'Utilisateur introuvable.');
    const role = ctx.body.role;
    if (!ROLES.includes(role)) throw new HttpError(422, 'Rôle inconnu.');
    if (user.role === 'admin' && role !== 'admin' && repo.countAdmins(ctx.org.id) <= 1) {
      throw new HttpError(422, 'L’espace doit garder au moins un administrateur.');
    }
    repo.updateUserRole(id, role);
    return { user: publicUser({ ...user, role }) };
  });

  route('POST', /^\/api\/team\/([\w-]{1,64})\/reset-password$/, async (ctx, [id]) => {
    requireUser(ctx, 'admin');
    const user = repo.getUser(ctx.org.id, id);
    if (!user) throw new HttpError(404, 'Utilisateur introuvable.');
    if (user.id === ctx.user.id) throw new HttpError(422, 'Changez votre propre mot de passe depuis « Mon compte ».');
    const temporary = temporaryPassword();
    repo.updateUserPassword(id, await hashPassword(temporary), true);
    repo.deleteUserSessions(id);
    return { temporaryPassword: temporary };
  });

  route('DELETE', /^\/api\/team\/([\w-]{1,64})$/, (ctx, [id]) => {
    requireUser(ctx, 'admin');
    const user = repo.getUser(ctx.org.id, id);
    if (!user) throw new HttpError(404, 'Utilisateur introuvable.');
    if (user.id === ctx.user.id) throw new HttpError(422, 'Vous ne pouvez pas supprimer votre propre compte ici.');
    repo.deleteUser(id);
    return { deleted: id };
  });

  // -------------------------------------------------------------- handler
  async function handleApi(ctx) {
    const { req, url } = ctx;
    const candidates = routes.filter((r) => r.pattern.test(url.pathname));
    if (!candidates.length) throw new HttpError(404, 'Route inconnue.');
    const match = candidates.find((r) => r.method === req.method);
    if (!match) throw new HttpError(405, 'Méthode non autorisée.');

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      checkOrigin(req);
      const hasBody = req.method !== 'DELETE' || Number(req.headers['content-length'] || 0) > 0;
      ctx.body = hasBody ? await readJson(req, match.options.limit || JSON_LIMIT) : {};
    } else {
      ctx.body = {};
    }
    loadSession(ctx);
    const params = match.pattern.exec(url.pathname).slice(1);
    const result = await match.handler(ctx, params);
    sendJson(ctx.res, ctx.status, result, ctx.headers);
  }

  return async function handler(req, res) {
    const started = Date.now();
    const ctx = {
      req,
      res,
      url: new URL(req.url || '/', 'http://localhost'),
      ip: clientIp(req),
      secure: isSecure(req),
      status: 200,
      headers: {},
    };
    if (config.log !== false) {
      res.on('finish', () => {
        console.log(`${req.method} ${ctx.url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
      });
    }
    setSecurityHeaders(res, ctx.secure);
    const isApi = ctx.url.pathname === '/api' || ctx.url.pathname.startsWith('/api/');
    try {
      if (isApi) await handleApi(ctx);
      else serveStatic(req, res, ctx.url.pathname, config.publicDir);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      const message = status === 500
        ? 'Erreur interne. Réessayez ; si le problème persiste, contactez le support.'
        : error.message;
      if (res.headersSent) {
        res.destroy();
      } else if (isApi) {
        sendJson(res, status, { error: message, ...(error.extra || {}) });
      } else {
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(message);
      }
    }
  };
}

export { ROLE_LABELS };
