import type { TestDatabases } from './testDb.js';
import { assertTestDatabases } from './testDb.js';
import { ACCEPTANCE_CONTRACT_IDS } from './acceptanceIds.js';

export { ACCEPTANCE_CONTRACT_IDS } from './acceptanceIds.js';
const FIXTURES = ACCEPTANCE_CONTRACT_IDS;

export type AcceptanceTenant = keyof typeof FIXTURES;

interface FixtureUser {
  _id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  businessName: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function provisionAcceptanceFixtures(databases: TestDatabases) {
  assertTestDatabases(databases);
  const now = new Date('2026-01-01T00:00:00.000Z');
  for (const fixture of Object.values(FIXTURES)) {
    await databases.account.collection<FixtureUser>('user').updateOne(
      { _id: fixture.ownerId, email: fixture.email },
      { $setOnInsert: {
        name: fixture.businessName,
        emailVerified: true,
        businessName: fixture.businessName,
        createdAt: now,
        updatedAt: now,
      } },
      { upsert: true },
    );
    const user = await databases.account.collection<FixtureUser>('user').findOne({ _id: fixture.ownerId });
    if (user?.email !== fixture.email) throw new Error('TEST tenant OWNER fixture çakışması.');

    await databases.business.collection('sync_tenant').updateOne(
      { tenant_id: fixture.tenantId },
      { $setOnInsert: { user_id: fixture.ownerId, last_seq: 0, created_at: now, touched_at: now } },
      { upsert: true },
    );
    const tenant = await databases.business.collection<{ user_id: string }>('sync_tenant')
      .findOne({ tenant_id: fixture.tenantId });
    if (tenant?.user_id !== fixture.ownerId) throw new Error('TEST tenant sahipliği fixture ile uyuşmuyor.');
  }
  return FIXTURES;
}

export async function resetAcceptanceTenant(databases: TestDatabases, key: string): Promise<void> {
  assertTestDatabases(databases);
  if (!Object.hasOwn(FIXTURES, key)) throw new Error('Allowlist dışında TEST tenant adı reddedildi.');
  const fixture = FIXTURES[key as AcceptanceTenant];
  if (databases.accountClient !== databases.businessClient) {
    throw new Error('TEST reset tek geçici Mongo replica set gerektirir.');
  }

  const session = databases.accountClient.startSession();
  try {
    await session.withTransaction(async () => {
      const tenant = await databases.business.collection<{ user_id: string }>('sync_tenant')
        .findOne({ tenant_id: fixture.tenantId }, { session });
      if (tenant && tenant.user_id !== fixture.ownerId) {
        throw new Error('TEST tenant başka bir kullanıcıya bağlı; reset reddedildi.');
      }
      await databases.business.collection('sync_operation').deleteMany({ tenant_id: fixture.tenantId }, { session });
      await databases.business.collection('sync_row').deleteMany({ tenant_id: fixture.tenantId }, { session });
      await databases.business.collection('sync_device_cursor').deleteMany({ tenant_id: fixture.tenantId }, { session });
      await databases.business.collection('sync_tenant').deleteOne(
        { tenant_id: fixture.tenantId, user_id: fixture.ownerId }, { session },
      );
      await databases.account.collection('desktop_license_key').deleteMany({ userId: fixture.ownerId }, { session });
      await databases.account.collection('desktop_device_license').deleteMany({ user_id: fixture.ownerId }, { session });
      await databases.account.collection('session').deleteMany({ userId: fixture.ownerId }, { session });
      await databases.account.collection('account').deleteMany({ userId: fixture.ownerId }, { session });
      await databases.account.collection('verification').deleteMany({ identifier: fixture.email }, { session });
      await databases.account.collection<FixtureUser>('user').deleteOne(
        { _id: fixture.ownerId, email: fixture.email }, { session },
      );
    });
  } finally {
    await session.endSession();
  }
}
