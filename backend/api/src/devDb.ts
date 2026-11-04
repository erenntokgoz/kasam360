import { existsSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';

// Yalnız geliştirme içindir; sunucuda gerçek PostgreSQL kullanılır.
const databaseDir = '.test-db/dev';
const isNew = !existsSync(`${databaseDir}/PG_VERSION`);
const database = new EmbeddedPostgres({
  databaseDir,
  user: 'kasam360',
  password: 'kasam360',
  port: 5432,
  persistent: true,
  // Windows'un yerel dil adı ASCII dışı karakter taşıyınca veritabanı kurulumu reddediliyor.
  initdbFlags: ['--locale=C', '--encoding=UTF8'],
});

if (isNew) await database.initialise();
await database.start();
if (isNew) await database.createDatabase('kasam360');
console.log('Geliştirme veritabanı açık: 5432');
