// Password hashing (scrypt), session tokens and a small in-memory rate limiter.

import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const MAXMEM = 64 * 1024 * 1024;

function scrypt(password, salt, keylen, options) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { ...options, maxmem: MAXMEM }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = await scrypt(password, salt, keylen, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Compared against when the e-mail is unknown, so a failed login takes the
// same time whether or not the account exists.
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(18).toString('base64url'));

export function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Readable one-time password such as "kq7m-Pz2r-Wd9t". */
export function temporaryPassword() {
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    if (i > 0 && i % 4 === 0) out += '-';
    out += TEMP_ALPHABET[bytes[i] % TEMP_ALPHABET.length];
  }
  return out;
}

/** Fixed-window counter: `hit(key)` is false once `limit` is reached. */
export class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  hit(key, now = Date.now()) {
    let entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    if (this.hits.size > 10000) this.sweep(now);
    return entry.count <= this.limit;
  }

  clear(key) {
    this.hits.delete(key);
  }

  sweep(now = Date.now()) {
    for (const [key, entry] of this.hits) if (entry.reset <= now) this.hits.delete(key);
  }
}
