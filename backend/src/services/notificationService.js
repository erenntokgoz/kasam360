/**
 * notificationService.js
 * Priority-Based Push Notification Engine (MODÜL 5)
 *
 * Filtreleme Mantığı:
 *  1. DEBT → vadeTarihi bugünden <= 1 gün ise bildirim gönder.
 *  2. Kasa bakiyesi < limit → "Düşük Kasa" uyarısı gönder.
 *  3. Standart GELİR/GİDER → sessiz; yalnızca AuditLog'a yaz.
 */
'use strict';

const admin = require('firebase-admin');
const path = require('path');
const Debt = require('../models/Debt');
const Tenant = require('../models/Tenant');
const AuditLog = require('../models/AuditLog');

// ─── Firebase Admin Init ────────────────────────────────────────────────────────
try {
  const serviceAccountPath = path.resolve(__dirname, '../config/kasam360-firebase-adminsdk.json');
  if (require('fs').existsSync(serviceAccountPath)) {
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath))
      });
    }
    console.log('[NotificationService] Firebase Admin initialized.');
  } else {
    console.warn('[NotificationService] Firebase config missing. Notifications will be logged only.');
  }
} catch (error) {
  console.error('[NotificationService] Firebase Admin initialization error:\n', error?.stack || error);
}

// ─── Types ─────────────────────────────────────────────────────────────────────
/**
 * @typedef {'DEBT' | 'LOW_CASH' | 'RECURRING' | 'INFO'} NotificationPriority
 */

// ─── Core Push Sender ──────────────────────────────────────────────────────────
/**
 * @param {string} deviceToken
 * @param {string} title
 * @param {string} body
 * @param {Record<string, string>} [data]
 * @returns {Promise<boolean>}
 */
const sendPushNotification = async (deviceToken, title, body, data = {}) => {
  try {
    if (!deviceToken) {
      console.warn('[NotificationService] sendPushNotification: no deviceToken, skipping.');
      return false;
    }

    console.log(`[NotificationService] Push → [${deviceToken.slice(0, 12)}…] "${title}"`);

    if (admin.apps.length > 0) {
      const message = {
        notification: { title, body },
        data: {
          ...Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
          ),
          click_action: 'OPEN_DEBT_DETAIL'
        },
        android: { priority: 'high' },
        token: deviceToken
      };
      await admin.messaging().send(message);
    }
    return true;
  } catch (error) {
    console.error('[NotificationService] Error sending notification:\n', error?.stack || error);
    return false;
  }
};

// ─── MODÜL 5-A: Debt Due Reminder (priority filter: dueDate <= 1 day) ──────────
/**
 * Checks debts due within 1 day and sends priority push notifications.
 * Income/Expense entries are intentionally excluded — they only write to AuditLog.
 *
 * @param {string|null} targetTenantId
 */
const checkAndNotifyDueDebts = async (targetTenantId = null) => {
  try {
    const now = new Date();

    // Sadece <= 1 gün içinde vadesi dolan borçlar — daha önceki 3 günlük pencere KALDIRILDI
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 999);

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const filter = {
      status: { $in: ['PENDING', 'PARTIAL'] },
      dueDate: { $lte: tomorrow, $gte: today },
      isDeleted: false
    };

    if (targetTenantId) filter.tenantId = targetTenantId;

    const debts = await Debt.find(filter).lean();

    for (const debt of debts) {
      const tenant = await Tenant.findById(debt.tenantId).lean();
      if (!tenant?.deviceToken) continue;

      const dueDate = new Date(debt.dueDate);
      const diffMs = dueDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const amountTL = (debt.remainingAmount / 100).toLocaleString('tr-TR');

      // ── Mesaj şablonu (talimata göre) ──────────────────────────────────────
      let title = 'Vade Hatırlatıcı 🔔';
      let body;

      if (diffDays <= 0) {
        body = `Vade Hatırlatıcı: ${debt.entityName} ${debt.type === 'GIVEN' ? 'kişisinden alınacak' : 'kişisine ödenecek'} ${amountTL} TL borcun son günü bugün!`;
      } else if (diffDays === 1) {
        // Talimattaki tam format: "Vade Hatırlatıcı: [İsim] kişisine olan [Tutar] TL borcun son günü yarın!"
        body = `Vade Hatırlatıcı: ${debt.entityName} kişisine olan ${amountTL} TL borcun son günü yarın!`;
      } else {
        // Bu dal artık <= 1 gün filtresiyle hiç çalışmaz, guard olarak bırakıldı
        body = `${debt.entityName} için ${amountTL} TL borcun vadesi ${diffDays} gün sonra.`;
      }

      await sendPushNotification(
        tenant.deviceToken,
        title,
        body,
        {
          type: 'DEBT',
          debtId: debt._id.toString(),
          entityName: debt.entityName,
          amount: String(debt.remainingAmount)
        }
      );
    }
  } catch (error) {
    console.error('[NotificationService] checkAndNotifyDueDebts error:\n', error?.stack || error);
  }
};

// ─── MODÜL 5-B: Low Cash Alert ─────────────────────────────────────────────────
/**
 * Sends a "Düşük Kasa" alert if tenant's balance < limit.
 *
 * @param {string} tenantId
 * @param {number} currentBalanceCents   Current cash balance in cents
 * @param {number} limitCents            Threshold in cents (e.g. 50000 = 500 TL)
 * @returns {Promise<void>}
 */
const checkAndNotifyLowCash = async (tenantId, currentBalanceCents, limitCents) => {
  try {
    if (currentBalanceCents >= limitCents) return;

    const tenant = await Tenant.findById(tenantId).lean();
    if (!tenant?.deviceToken) return;

    const balanceTL = (currentBalanceCents / 100).toLocaleString('tr-TR');
    const limitTL = (limitCents / 100).toLocaleString('tr-TR');

    await sendPushNotification(
      tenant.deviceToken,
      '⚠️ Düşük Kasa Uyarısı',
      `Kasa bakiyeniz ${balanceTL} TL — belirlenen ${limitTL} TL limitinin altına düştü!`,
      { type: 'LOW_CASH', balance: String(currentBalanceCents), limit: String(limitCents) }
    );
  } catch (error) {
    console.error('[NotificationService] checkAndNotifyLowCash error:\n', error?.stack || error);
  }
};

// ─── MODÜL 5-C: Income/Expense Silent Audit Log ────────────────────────────────
/**
 * Standard Income/Expense entries do NOT trigger push notifications.
 * They are written silently to the AuditLog collection only.
 *
 * @param {string} tenantId
 * @param {'INCOME'|'EXPENSE'} transactionType
 * @param {object} transactionData
 * @returns {Promise<void>}
 */
const logTransactionAudit = async (tenantId, transactionType, transactionData) => {
  try {
    await AuditLog.create({
      tenantId,
      action: transactionType === 'INCOME' ? 'INCOME_CREATED' : 'EXPENSE_CREATED',
      entityType: 'TRANSACTION',
      entityId: transactionData._id || transactionData.syncId,
      changes: {
        amount: transactionData.amount,
        category: transactionData.category,
        description: transactionData.description,
        transactionDate: transactionData.transactionDate
      }
    });
    // No push notification for standard income/expense — intentional (MODÜL 5)
  } catch (error) {
    console.error('[NotificationService] logTransactionAudit error:\n', error?.stack || error);
  }
};

module.exports = {
  sendPushNotification,
  checkAndNotifyDueDebts,
  checkAndNotifyLowCash,
  logTransactionAudit
};
