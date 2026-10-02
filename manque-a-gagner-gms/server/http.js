// HTTP plumbing: JSON bodies, cookies, security headers and static files.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function sendJson(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export function readJson(req, limitBytes) {
  const type = String(req.headers['content-type'] || '');
  if (!type.toLowerCase().startsWith('application/json')) {
    return Promise.reject(new HttpError(415, 'Le corps de la requête doit être au format JSON.'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new HttpError(413, 'Requête trop volumineuse.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0) return resolve({});
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          reject(new HttpError(400, 'Objet JSON attendu.'));
        } else {
          resolve(value);
        }
      } catch {
        reject(new HttpError(400, 'JSON invalide.'));
      }
    });
    req.on('error', reject);
  });
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key || key in out) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Lax', path: cookiePath = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${cookiePath}`, `SameSite=${sameSite}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function setSecurityHeaders(res, secure) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.csv', '.webmanifest']);
const gzipCache = new Map();

/** Serves a file from `root`; never escapes it and never serves dotfiles. */
export function serveStatic(req, res, pathname, root) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(405, 'Méthode non autorisée.');
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Adresse invalide.');
  }
  if (decoded.includes('\0')) throw new HttpError(400, 'Adresse invalide.');
  let relative = path.posix.normalize(decoded).replace(/^\/+/, '');
  if (relative === '' || relative.endsWith('/')) relative += 'index.html';
  if (relative.split('/').some((segment) => segment.startsWith('.'))) throw new HttpError(404, 'Introuvable.');

  const base = path.resolve(root);
  let file = path.resolve(base, relative);
  if (!file.startsWith(base + path.sep)) throw new HttpError(404, 'Introuvable.');

  let stat;
  try {
    stat = fs.statSync(file);
    if (stat.isDirectory()) {
      file = path.join(file, 'index.html');
      stat = fs.statSync(file);
    }
  } catch {
    throw new HttpError(404, 'Introuvable.');
  }

  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    ETag: etag,
    'Cache-Control': ext === '.woff2' ? 'public, max-age=604800' : 'no-cache',
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  if (COMPRESSIBLE.has(ext) && acceptsGzip && stat.size > 1024) {
    const key = `${file}:${etag}`;
    let body = gzipCache.get(key);
    if (!body) {
      body = zlib.gzipSync(fs.readFileSync(file));
      gzipCache.set(key, body);
    }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}
