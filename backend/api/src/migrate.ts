import { databases } from './config.js';
import { closeDatabases, ensureIndexes } from './lib/mongo.js';

// Belge veritabanında tablo kurulumu yoktur; tekillik ve sıra kuralları dizinlerle kurulur.
await ensureIndexes(databases);
await closeDatabases(databases);
console.log('Veritabanı dizinleri güncel.');
