// SQLite storage (built-in node:sqlite). Every business record lives in one
// `records` table as validated JSON, always scoped by organisation.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { COLLECTION_KEYS, LEVERS } from '../public/js/core/schema.js';

const MIGRATIONS = [
  `
  CREATE TABLE orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE INDEX users_org ON users(org_id);
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE records (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    collection TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by TEXT,
    updated_by TEXT
  );
  CREATE INDEX records_org_collection ON records(org_id, collection);
  `,
];

function migrate(db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let i = version; i < MIGRATIONS.length; i += 1) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

const toRecord = (row) => ({
  id: row.id,
  ...JSON.parse(row.data),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toUser = (row) => row && {
  id: row.id,
  orgId: row.org_id,
  email: row.email,
  name: row.name,
  role: row.role,
  passwordHash: row.password_hash,
  mustChangePassword: Boolean(row.must_change_password),
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at,
};

const toOrg = (row) => row && {
  id: row.id,
  name: row.name,
  settings: JSON.parse(row.settings),
  createdAt: row.created_at,
};

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  migrate(db);

  const stmt = new Map();
  const q = (sql) => {
    if (!stmt.has(sql)) stmt.set(sql, db.prepare(sql));
    return stmt.get(sql);
  };

  let depth = 0;
  const repo = {
    /** Runs `fn` atomically; nested calls join the outer transaction. */
    transaction(fn) {
      if (depth > 0) return fn();
      depth += 1;
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        depth -= 1;
      }
    },

    close() {
      db.close();
    },

    // ---------------------------------------------------------------- orgs
    createOrg({ id, name, settings, createdAt }) {
      q('INSERT INTO orgs (id, name, settings, created_at) VALUES (?, ?, ?, ?)')
        .run(id, name, JSON.stringify(settings), createdAt);
    },
    getOrg(id) {
      return toOrg(q('SELECT * FROM orgs WHERE id = ?').get(id));
    },
    updateOrgName(id, name) {
      q('UPDATE orgs SET name = ? WHERE id = ?').run(name, id);
    },
    updateOrgSettings(id, settings) {
      q('UPDATE orgs SET settings = ? WHERE id = ?').run(JSON.stringify(settings), id);
    },
    deleteOrg(id) {
      q('DELETE FROM orgs WHERE id = ?').run(id);
    },

    // --------------------------------------------------------------- users
    createUser({ id, orgId, email, name, role, passwordHash, mustChangePassword = false, createdAt }) {
      q(`INSERT INTO users (id, org_id, email, name, role, password_hash, must_change_password, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, orgId, email, name, role, passwordHash, mustChangePassword ? 1 : 0, createdAt);
    },
    getUserByEmail(email) {
      return toUser(q('SELECT * FROM users WHERE email = ?').get(email));
    },
    getUser(orgId, id) {
      return toUser(q('SELECT * FROM users WHERE org_id = ? AND id = ?').get(orgId, id));
    },
    listUsers(orgId) {
      return q('SELECT * FROM users WHERE org_id = ? ORDER BY created_at').all(orgId).map(toUser);
    },
    countAdmins(orgId) {
      return q("SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND role = 'admin'").get(orgId).n;
    },
    updateUserRole(id, role) {
      q('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    },
    updateUserPassword(id, passwordHash, mustChangePassword) {
      q('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?')
        .run(passwordHash, mustChangePassword ? 1 : 0, id);
    },
    touchLogin(id, at) {
      q('UPDATE users SET last_login_at = ? WHERE id = ?').run(at, id);
    },
    deleteUser(id) {
      q('DELETE FROM users WHERE id = ?').run(id);
    },

    // ------------------------------------------------------------ sessions
    createSession(tokenHash, userId, createdAt, expiresAt) {
      q('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(tokenHash, userId, createdAt, expiresAt);
    },
    /** Session with its user and organisation, or undefined. */
    getSession(tokenHash) {
      const row = q(`SELECT s.token_hash, s.expires_at, u.*
                     FROM sessions s JOIN users u ON u.id = s.user_id
                     WHERE s.token_hash = ?`).get(tokenHash);
      if (!row) return undefined;
      return { tokenHash: row.token_hash, expiresAt: row.expires_at, user: toUser(row) };
    },
    deleteSession(tokenHash) {
      q('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    },
    deleteUserSessions(userId, exceptTokenHash = '') {
      q('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, exceptTokenHash);
    },
    purgeExpiredSessions(now) {
      return q('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
    },

    // ------------------------------------------------------------- records
    listRecords(orgId, collection) {
      return q('SELECT * FROM records WHERE org_id = ? AND collection = ? ORDER BY created_at, rowid')
        .all(orgId, collection).map(toRecord);
    },
    listAllRecords(orgId) {
      const out = Object.fromEntries(COLLECTION_KEYS.map((key) => [key, []]));
      for (const row of q('SELECT * FROM records WHERE org_id = ? ORDER BY created_at, rowid').iterate(orgId)) {
        if (out[row.collection]) out[row.collection].push(toRecord(row));
      }
      return out;
    },
    getRecord(orgId, collection, id) {
      const row = q('SELECT * FROM records WHERE org_id = ? AND collection = ? AND id = ?').get(orgId, collection, id);
      return row ? toRecord(row) : undefined;
    },
    recordExists(orgId, collection, id) {
      return Boolean(q('SELECT 1 FROM records WHERE org_id = ? AND collection = ? AND id = ?').get(orgId, collection, id));
    },
    countRecords(orgId) {
      return q('SELECT COUNT(*) AS n FROM records WHERE org_id = ?').get(orgId).n;
    },
    insertRecord(orgId, collection, id, data, userId, at) {
      q(`INSERT INTO records (id, org_id, collection, data, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, orgId, collection, JSON.stringify(data), at, at, userId, userId);
      return { id, ...data, createdAt: at, updatedAt: at };
    },
    updateRecord(orgId, collection, id, data, userId, at) {
      const { changes } = q(`UPDATE records SET data = ?, updated_at = ?, updated_by = ?
                             WHERE org_id = ? AND collection = ? AND id = ?`)
        .run(JSON.stringify(data), at, userId, orgId, collection, id);
      return changes > 0;
    },
    deleteRecord(orgId, collection, id) {
      return q('DELETE FROM records WHERE org_id = ? AND collection = ? AND id = ?').run(orgId, collection, id).changes > 0;
    },
    deleteCollection(orgId, collection) {
      return q('DELETE FROM records WHERE org_id = ? AND collection = ?').run(orgId, collection).changes;
    },
    deleteAllRecords(orgId) {
      return q('DELETE FROM records WHERE org_id = ?').run(orgId).changes;
    },
    /** Lever records pointing at a product or retailer. */
    countReferences(orgId, field, id) {
      const placeholders = LEVERS.map(() => '?').join(', ');
      return q(`SELECT COUNT(*) AS n FROM records
                WHERE org_id = ? AND collection IN (${placeholders}) AND json_extract(data, '$.' || ?) = ?`)
        .get(orgId, ...LEVERS, field, id).n;
    },
    deleteReferences(orgId, field, id) {
      const placeholders = LEVERS.map(() => '?').join(', ');
      return q(`DELETE FROM records
                WHERE org_id = ? AND collection IN (${placeholders}) AND json_extract(data, '$.' || ?) = ?`)
        .run(orgId, ...LEVERS, field, id).changes;
    },
  };
  return repo;
}
