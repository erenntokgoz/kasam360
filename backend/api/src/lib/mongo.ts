import { MongoClient, type Db } from 'mongodb';

// İki ayrı küme: hesap (üyelik, oturum, lisans anahtarı) ve işletme (kasa eşitleme kaydı).
// Hesap kümesi küçük ve sık okunur; işletme kümesi büyür. Biri taşınırken diğeri etkilenmez.
// Kümeler arası transaction yoktur: işletme verisi hesaba yalnız kullanıcı kimliğiyle bağlanır.
export interface Databases {
  accountClient: MongoClient;
  account: Db;
  businessClient: MongoClient;
  business: Db;
}

export interface MongoSettings {
  accountUri: string;
  accountDb: string;
  businessUri: string;
  businessDb: string;
}

export async function connectDatabases(settings: MongoSettings): Promise<Databases> {
  const accountClient = await new MongoClient(settings.accountUri).connect();
  // Aynı adres verilirse tek bağlantı paylaşılır; testte iki veritabanı tek sunucudadır.
  const businessClient = settings.businessUri === settings.accountUri
    ? accountClient
    : await new MongoClient(settings.businessUri).connect();
  return {
    accountClient,
    account: accountClient.db(settings.accountDb),
    businessClient,
    business: businessClient.db(settings.businessDb),
  };
}

export async function closeDatabases(databases: Databases) {
  await databases.accountClient.close();
  if (databases.businessClient !== databases.accountClient) await databases.businessClient.close();
}

/**
 * Tekillik ve sıra kuralları dizinle sağlanır; kural kodda unutulsa da veritabanı reddeder.
 * Her açılışta çalışır; var olan dizine dokunmaz.
 */
export async function ensureIndexes({ account, business }: Databases) {
  await Promise.all([
    account.collection('user').createIndex({ email: 1 }, { unique: true }),
    account.collection('session').createIndex({ token: 1 }, { unique: true }),
    account.collection('session').createIndex({ userId: 1 }),
    account.collection('account').createIndex({ userId: 1 }),
    account.collection('verification').createIndex({ identifier: 1 }),
    account.collection('desktop_license_key').createIndex({ keyHash: 1 }, { unique: true }),
    account.collection('desktop_license_key').createIndex({ userId: 1 }),
    account.collection('desktop_device_license').createIndex({ user_id: 1, device_id: 1 }, { unique: true }),
    account.collection('tenant_membership').createIndex({ userId: 1, tenantId: 1 }, { unique: true }),
    account.collection('tenant_creation_idempotency').createIndex({ userId: 1, key: 1 }, { unique: true }),
    account.collection('tenant_creation_idempotency').createIndex({ tenantId: 1 }, { unique: true }),
    business.collection('sync_tenant').createIndex({ tenant_id: 1 }, { unique: true }),
    business.collection('sync_tenant').createIndex({ user_id: 1 }, { unique: true }),
    business.collection('sync_operation').createIndex({ tenant_id: 1, seq: 1 }, { unique: true }),
    business.collection('sync_operation').createIndex({ tenant_id: 1, operation_id: 1 }, { unique: true }),
    business.collection('sync_operation').createIndex({ tenant_id: 1, device_id: 1 }),
    business.collection('sync_row').createIndex({ tenant_id: 1, table_name: 1, row_key: 1 }, { unique: true }),
    business.collection('sync_row').createIndex({ tenant_id: 1, last_seq: 1 }),
    business.collection('sync_device_cursor').createIndex({ tenant_id: 1, device_id: 1 }, { unique: true }),
    business.collection('sync_quarantine').createIndex({ tenant_id: 1, operation_id: 1 }, { unique: true }),
    business.collection('sync_quarantine').createIndex({ tenant_id: 1, status: 1, received_at: 1 }),
    business.collection('sync_quarantine_decision').createIndex({ tenant_id: 1, operation_id: 1 }, { unique: true }),
    // QR menü: tek işletme tek slug, tek yayın; slug tüm sistemde tekildir, görsel (işletme, sha256) ile tekildir.
    business.collection('qr_menu_slug').createIndex({ tenant_id: 1 }, { unique: true }),
    business.collection('qr_menu_slug').createIndex({ slug: 1 }, { unique: true }),
    business.collection('qr_menu_publication').createIndex({ tenant_id: 1 }, { unique: true }),
    business.collection('qr_menu_image').createIndex({ tenant_id: 1, sha256: 1 }, { unique: true }),
  ]);
}

/** Hesap silinince işletme verisi ve cihaz kayıtları da düşer; eski veritabanındaki zincirleme silmenin karşılığı. */
export async function removeUserData({ account, business, businessClient }: Databases, userId: string) {
  await account.collection('desktop_license_key').deleteMany({ userId });
  await account.collection('desktop_device_license').deleteMany({ user_id: userId });
  const tenant = await business.collection('sync_tenant').findOne({ user_id: userId });
  if (!tenant) return;
  const session = businessClient.startSession();
  try {
    await session.withTransaction(async () => {
      const tenantId = tenant.tenant_id as string;
      // Günlük yalnız bu yolda, kiracı kaydıyla birlikte silinir; başka hiçbir yol günlüğe dokunmaz.
      await business.collection('sync_tenant').deleteOne({ tenant_id: tenantId }, { session });
      await business.collection('sync_operation').deleteMany({ tenant_id: tenantId }, { session });
      await business.collection('sync_row').deleteMany({ tenant_id: tenantId }, { session });
      await business.collection('sync_device_cursor').deleteMany({ tenant_id: tenantId }, { session });
      await business.collection('sync_quarantine').deleteMany({ tenant_id: tenantId }, { session });
      await business.collection('sync_quarantine_decision').deleteMany({ tenant_id: tenantId }, { session });
      for (const name of ['qr_menu_slug', 'qr_menu_publication', 'qr_menu_image']) {
        await business.collection(name).deleteMany({ tenant_id: tenantId }, { session });
      }
    });
  } finally {
    await session.endSession();
  }
}
