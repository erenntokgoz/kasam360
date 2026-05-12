const cron = require('node-cron');
const Debt = require('../models/Debt');
const { generateAlertFromAI } = require('../services/aiAlertService');
const notificationService = require('../services/notificationService');

// Her gece 02:00'de çalışacak
cron.schedule('0 2 * * *', async () => {
  console.log('[cron] Günlük borç kontrolü ve AI uyarı üretimi başladı...');
  
  try {
    // Vadesi olan ve henüz kapanmamış borçları bul
    const activeDebts = await Debt.find({
      dueDate: { $ne: null },
      status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] }
    }).populate('tenantId');

    const now = new Date();

    for (const debt of activeDebts) {
      if (!debt.tenantId) continue;

      const dueDate = new Date(debt.dueDate);
      const diffTime = dueDate.getTime() - now.getTime();
      const dueDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Kontrol 1: Bugün zaten bildirim gönderildi mi?
      if (debt.lastNotifiedAt) {
        const lastNotif = new Date(debt.lastNotifiedAt);
        if (lastNotif.toDateString() === now.toDateString()) continue;
      }

      // Kontrol 2: Sadece kritik günlerde bildirim gönder (3 gün kala, 1 gün kala, 0 gün kala veya gecikmiş)
      // dueDays < 0 ise gecikmiştir (her 3 günde bir hatırlatılabilir)
      const shouldNotify = dueDays === 3 || dueDays === 1 || dueDays === 0 || (dueDays < 0 && Math.abs(dueDays) % 3 === 0);

      if (shouldNotify) {
        const alertData = {
          userBusinessName: debt.tenantId.businessName,
          debtorName: debt.entityName,
          amountTL: debt.totalAmount / 100,
          dueDays: dueDays,
          balanceTL: debt.remainingAmount / 100,
          status: dueDays < 0 ? 'Gecikmiş' : 'Yaklaşan'
        };

        const message = await generateAlertFromAI(alertData);
        const title = `Kasam360: ${alertData.status} Borç Uyarısı`;
        
        let success = false;
        if (debt.tenantId.deviceToken) {
          success = await notificationService.sendPushNotification(debt.tenantId.deviceToken, title, message, { debtId: debt._id.toString() });
        }
        
        if (success) {
          debt.lastNotifiedAt = now;
          await debt.save();
        }
      }
    }
  } catch (error) {
    console.error('[cron] AI uyarı kontrolünde hata oluştu:', error);
  }
});
