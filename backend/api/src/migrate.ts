import { getMigrations } from 'better-auth/db/migration';
import { auth, pool } from './config.js';

const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
await pool.end();
console.log('Veritabanı güncel.');
