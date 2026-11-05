import { getMigrations } from 'better-auth/db/migration';
import { auth, pool } from './config.js';
import { LICENSE_KEY_TABLE } from './desktopLicense.js';

const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
await pool.query(LICENSE_KEY_TABLE);
await pool.end();
console.log('Veritabanı güncel.');
