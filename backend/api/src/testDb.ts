import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { closeDatabases, connectDatabases, ensureIndexes, type Databases } from './lib/mongo.js';

// Testler gerçek sunucuyla çalışır: transaction ve tekil dizin ancak kopya kümesinde sınanır.
// Her test dosyası kendi kümesini açar; veri dosyası geçicidir ve kapanışta silinir.
export interface TestDatabases extends Databases {
  reset(): Promise<void>;
  stop(): Promise<void>;
}

const activeTestDatabases = new WeakSet<object>();

export function assertTestDatabases(databases: Databases): asserts databases is TestDatabases {
  if (!activeTestDatabases.has(databases)) throw new Error('Fixture işlemi yalnız geçici test veritabanında çalışır.');
}

export async function startTestDatabases(): Promise<TestDatabases> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = replSet.getUri();
  const databases = await connectDatabases({ accountUri: uri, accountDb: 'account', businessUri: uri, businessDb: 'business' });
  await ensureIndexes(databases);
  const testDatabases: TestDatabases = {
    ...databases,
    async reset() {
      for (const db of [databases.account, databases.business]) {
        for (const collection of await db.collections()) await collection.deleteMany({});
      }
    },
    async stop() {
      await closeDatabases(databases);
      await replSet.stop();
    },
  };
  activeTestDatabases.add(testDatabases);
  return testDatabases;
}
