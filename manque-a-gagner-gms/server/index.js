// Entry point: `npm start`. Configuration comes from environment variables
// (see README, section « Déploiement »).

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(here, '..', 'data'),
  publicDir: path.join(here, '..', 'public'),
  allowSignup: process.env.ALLOW_SIGNUP !== 'false',
  cookieSecure: process.env.COOKIE_SECURE || 'auto',
  trustProxy: process.env.TRUST_PROXY === 'true',
  sessionDays: Number(process.env.SESSION_DAYS) || 30,
  log: process.env.LOG_REQUESTS !== 'false',
};

const repo = openDatabase(path.join(config.dataDir, 'gondole.db'));
const server = http.createServer(createApp({ repo, config }));

server.listen(config.port, config.host, () => {
  console.log(`Gondole est prêt sur http://localhost:${config.port}`);
});

const purge = setInterval(() => repo.purgeExpiredSessions(new Date().toISOString()), 60 * 60 * 1000);
purge.unref();

function shutdown() {
  server.close(() => {
    repo.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
