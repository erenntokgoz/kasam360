import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { provisionAcceptanceFixtures, resetAcceptanceTenant } from './acceptanceFixtures.js';
import { startTestDatabases, type TestDatabases } from './testDb.js';

let db: TestDatabases;

beforeAll(async () => {
  db = await startTestDatabases();
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

beforeEach(async () => {
  await db.reset();
});

describe('kabul tenant fixtureları', () => {
  it('TEST_A/B verisini tekrarlanabilir kurar ve yalnız seçilen tenantı sıfırlar', async () => {
    const fixtures = await provisionAcceptanceFixtures(db);
    await provisionAcceptanceFixtures(db);

    expect(await db.account.collection('user').countDocuments()).toBe(2);
    expect(await db.business.collection('sync_tenant').countDocuments()).toBe(2);

    for (const fixture of Object.values(fixtures)) {
      await db.business.collection('sync_operation').insertOne({
        tenant_id: fixture.tenantId,
        seq: 1,
        operation_id: `op_${fixture.tenantId.slice(-8)}`,
      });
      await db.business.collection('sync_row').insertOne({
        tenant_id: fixture.tenantId,
        table_name: 'products',
        row_key: 'fixture-sentinel',
        key: { id: 'prd_fixture' },
        data: { id: 'prd_fixture', tenant_id: fixture.tenantId, price_cents: 12500 },
        deleted: false,
        last_seq: 0,
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      });
      await db.business.collection('sync_device_cursor').insertOne({
        tenant_id: fixture.tenantId,
        device_id: `dev_${fixture.tenantId.slice(-8)}`,
        pulled_seq: 0,
      });
    }

    await resetAcceptanceTenant(db, 'TEST_A');

    expect(await db.account.collection('user').countDocuments()).toBe(1);
    expect(await db.business.collection('sync_tenant').findOne({ tenant_id: fixtures.TEST_A.tenantId })).toBeNull();
    expect(await db.business.collection('sync_row').countDocuments({ tenant_id: fixtures.TEST_A.tenantId })).toBe(0);
    expect(await db.business.collection('sync_operation').countDocuments({ tenant_id: fixtures.TEST_A.tenantId })).toBe(0);
    expect(await db.business.collection('sync_device_cursor').countDocuments({ tenant_id: fixtures.TEST_A.tenantId })).toBe(0);
    expect(await db.business.collection('sync_tenant').findOne({ tenant_id: fixtures.TEST_B.tenantId })).not.toBeNull();
    expect(await db.business.collection('sync_row').countDocuments({ tenant_id: fixtures.TEST_B.tenantId })).toBe(1);
    expect(await db.business.collection('sync_operation').countDocuments({ tenant_id: fixtures.TEST_B.tenantId })).toBe(1);
    expect(await db.business.collection('sync_device_cursor').countDocuments({ tenant_id: fixtures.TEST_B.tenantId })).toBe(1);
  });

  it('allowlist dışındaki tenant adını reddeder', async () => {
    await expect(resetAcceptanceTenant(db, 'PRODUCTION')).rejects.toThrow('Allowlist dışında');
    await expect(resetAcceptanceTenant(db, 'toString')).rejects.toThrow('Allowlist dışında');
    expect(await db.account.collection('user').countDocuments()).toBe(0);
    expect(await db.business.collection('sync_tenant').countDocuments()).toBe(0);
  });

  it('geçici test DB kaydı olmayan bağlantıyı reddeder', async () => {
    await expect(resetAcceptanceTenant({} as TestDatabases, 'TEST_A'))
      .rejects.toThrow('yalnız geçici test veritabanında');
  });
});
