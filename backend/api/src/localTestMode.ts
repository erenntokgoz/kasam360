import { hash } from '@node-rs/argon2';
import type { Databases } from './lib/mongo.js';
import { ACCEPTANCE_CONTRACT_IDS } from './acceptanceIds.js';

// Yerel akış testi yalnız geçici geliştirme veritabanına eklenir; parola Argon2id olarak saklanır.
export const LOCAL_TEST_PASSWORD = process.env.LOCAL_TEST_PASSWORD ?? 'KasaTest-2026!';

const FIXTURES = [
  { id: 'usr_01arz3ndektsv4rrffq69g5fav', email: 'owner.a@kasam360.invalid', name: 'Ayşe Yılmaz', businessName: 'KASAM360 TEST_A' },
  { id: 'usr_01arz3ndektsv4rrffq69g5faw', email: 'owner.b@kasam360.invalid', name: 'Deniz Kaya', businessName: 'KASAM360 TEST_B' },
] as const;

export async function provisionLocalTestAccounts(databases: Databases) {
  if (process.env.LOCAL_TEST_MODE !== '1' || process.env.NODE_ENV === 'production') {
    throw new Error('Yerel test hesapları yalnız production dışındaki LOCAL_TEST_MODE=1 sürecinde açılır.');
  }
  const now = new Date();
  const password = await hash(LOCAL_TEST_PASSWORD);
  for (const fixture of FIXTURES) {
    await databases.account.collection<{ _id: string; email: string }>('user').updateOne(
      { _id: fixture.id, email: fixture.email },
      { $setOnInsert: {
        name: fixture.name, emailVerified: true, businessName: fixture.businessName,
        createdAt: now, updatedAt: now,
      } },
      { upsert: true },
    );
    const user = await databases.account.collection<{ _id: string; email: string }>('user').findOne({ _id: fixture.id });
    if (user?.email !== fixture.email) throw new Error('Yerel test hesabı kimliği çakıştı.');
    await databases.account.collection('account').updateOne(
      { userId: fixture.id, providerId: 'credential' },
      { $setOnInsert: {
        _id: `acc_${fixture.id.slice(4)}`, userId: fixture.id, accountId: fixture.id,
        providerId: 'credential', password, createdAt: now, updatedAt: now,
      } },
      { upsert: true },
    );
    const tenant = Object.values(ACCEPTANCE_CONTRACT_IDS).find((candidate) => candidate.ownerId === fixture.id);
    if (!tenant) throw new Error('Yerel TEST hesabının ortak tenant fixture kaydı bulunamadı.');
    const tenantRecord = { _id: tenant.tenantId, name: tenant.businessName, country: 'TR', currency: 'TRY', timeZone: 'Europe/Istanbul', status: 'active', version: 1, createdAt: now } as const;
    await databases.account.collection<{ _id: string }>('tenant').updateOne({ _id: tenant.tenantId }, { $setOnInsert: tenantRecord }, { upsert: true });
    await databases.account.collection('tenant_membership').updateOne(
      { tenantId: tenant.tenantId, userId: fixture.id },
      { $setOnInsert: { _id: `mem_${tenant.tenantId.slice(4)}`, userId: fixture.id, tenantId: tenant.tenantId, role: 'OWNER', status: 'active', version: 1, createdAt: now } },
      { upsert: true },
    );
  }
}
