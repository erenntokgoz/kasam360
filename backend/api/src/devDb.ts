import { mkdirSync } from 'node:fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// Yalnız geliştirme içindir; sunucuda Atlas kullanılır. Eşitleme transaction kullandığından
// tek düğümlü kopya kümesi açılır. Veri `.test-db/dev` altında kalıcıdır.
const dbPath = '.test-db/dev';
mkdirSync(dbPath, { recursive: true });
const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port: 27017, dbPath }],
});
console.log(`Geliştirme veritabanı açık: ${replSet.getUri()}`);
console.log('.env içinde MONGODB_ACCOUNT_URI ve MONGODB_BUSINESS_URI bu adrese ayarlanabilir.');
