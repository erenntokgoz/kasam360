const admin = require('firebase-admin');
const path = require('path');
const Debt = require('../models/Debt');
const Tenant = require('../models/Tenant');

// Initialize Firebase Admin using the service account
try {
  const serviceAccountPath = path.resolve(__dirname, '../config/kasam360-firebase-adminsdk.json');
  if (require('fs').existsSync(serviceAccountPath)) {
    admin.initializeApp({
      credential: admin.credential.cert(require(serviceAccountPath))
    });
    console.log('[NotificationService] Firebase Admin initialized.');
  } else {
    console.warn('[NotificationService] Firebase config missing. Notifications will be logged only.');
  }
} catch (error) {
  console.error('[NotificationService] Firebase Admin initialization error:', error);
}

/**
 * Send Push Notification
 */
const sendPushNotification = async (deviceToken, title, body, data = {}) => {
  try {
    if (!deviceToken) return false;
    
    console.log(`[NotificationService] Sending Push to [${deviceToken}] - ${title}`);
    
    if (admin.apps.length > 0) {
      const message = {
        notification: { title, body },
        data: { ...data, click_action: 'OPEN_DEBT_DETAIL' },
        token: deviceToken
      };
      await admin.messaging().send(message);
    }
    return true;
  } catch (error) {
    console.error('[NotificationService] Error sending notification:', error);
    return false;
  }
};

/**
 * Checks for debts due soon and notifies tenants
 * @param {String} targetTenantId - Optional: Only check for this tenant (for manual tests)
 */
const checkAndNotifyDueDebts = async (targetTenantId = null) => {
  try {
    const threeDaysLater = new Date();
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);
    threeDaysLater.setHours(23, 59, 59, 999);

    const filter = {
      status: { $in: ['PENDING', 'PARTIAL'] },
      dueDate: { $lte: threeDaysLater, $gte: new Date(new Date().setHours(0,0,0,0)) },
      isDeleted: false
    };

    if (targetTenantId) filter.tenantId = targetTenantId;

    const debts = await Debt.find(filter);

    for (const debt of debts) {
      const tenant = await Tenant.findById(debt.tenantId);
      if (tenant && tenant.deviceToken) {
        const title = 'Ödeme Hatırlatması 🔔';
        const dueDate = new Date(debt.dueDate);
        const now = new Date();
        const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const amountTL = (debt.remainingAmount / 100).toLocaleString('tr-TR');
        let body;
        if (diffDays < 0) {
          body = `${debt.entityName} ${debt.type === 'GIVEN' ? 'kişisinden alınacak' : 'kişisine ödenecek'} ${amountTL} ₺ borcun vadesi ${Math.abs(diffDays)} gün geçmiş!`;
        } else if (diffDays === 0) {
          body = `${debt.entityName} ${debt.type === 'GIVEN' ? 'kişisinden alınacak' : 'kişisine ödenecek'} ${amountTL} ₺ borcun bugün ödeme günü!`;
        } else if (diffDays === 1) {
          body = `${debt.entityName} ${debt.type === 'GIVEN' ? 'kişisinden alınacak' : 'kişisine ödenecek'} ${amountTL} ₺ borcun yarın ödeme günü.`;
        } else {
          body = `${debt.entityName} ${debt.type === 'GIVEN' ? 'kişisinden alınacak' : 'kişisine ödenecek'} ${amountTL} ₺ borcun ${diffDays} gün sonra vadesi doluyor.`;
        }
        await sendPushNotification(tenant.deviceToken, title, body, { debtId: debt._id.toString() });
      }
    }
  } catch (error) {
    console.error('[NotificationService] Error in checkAndNotifyDueDebts:', error);
  }
};

module.exports = {
  sendPushNotification,
  checkAndNotifyDueDebts
};
