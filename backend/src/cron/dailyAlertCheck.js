const cron = require('node-cron');
const Debt = require('../models/Debt');
const { generateAlertFromAI } = require('../services/aiAlertService');
const notificationService = require('../services/notificationService');

// Her gece 08:00'de çalışacak (Türkiye saati)
cron.schedule('0 8 * * *', async () => {
  console.log('[cron] Günlük borç kontrolü başladı...');

  try {
    // Vadesi olan ve henüz kapanmamış borçları bul
    const activeDebts = await Debt.find({
      dueDate: { $ne: null },
      status: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] },
      isDeleted: false
    }).populate('tenantId');

    const now = new Date();

    for (const debt of activeDebts) {
      if (!debt.tenantId) continue;

      const dueDate = new Date(debt.dueDate);
      const diffTime = dueDate.getTime() - now.getTime();
      const dueDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Aynı gün zaten bildirim gönderildi mi?
      if (debt.lastNotifiedAt) {
        const lastNotif = new Date(debt.lastNotifiedAt);
        if (lastNotif.toDateString() === now.toDateString()) continue;
      }

      // MODÜL 5: Sadece <= 1 gün kalan veya gecikmiş borçlar
      // (3 günlük pencere KALDIRILDI — priority-based filter)
      const isOverdue = dueDays < 0;
      const isDueSoon = dueDays === 0 || dueDays === 1;
      const shouldNotify = isDueSoon || (isOverdue && Math.abs(dueDays) % 3 === 0);

      if (shouldNotify) {
        const alertData = {
          userBusinessName: debt.tenantId.businessName,
          debtorName: debt.entityName,
          amountTL: debt.totalAmount / 100,
          dueDays: dueDays,
          balanceTL: debt.remainingAmount / 100,
          status: isOverdue ? 'Gecikmiş' : 'Yakın Vade'
        };

        let message;
        try {
          message = await generateAlertFromAI(alertData);
        } catch (aiErr) {
          console.warn('[cron] AI mesaj üretimi başarısız, varsayılan mesaj kullanılıyor:', aiErr?.message);
          const amountTL = (debt.remainingAmount / 100).toLocaleString('tr-TR');
          message = dueDays === 1
            ? `Vade Hatırlatıcı: ${debt.entityName} kişisine olan ${amountTL} TL borcun son günü yarın!`
            : `${debt.entityName} için ${amountTL} TL borcun vadesi geldi!`;
        }

        const title = `Kasam360: ${alertData.status} Borç Uyarısı`;

        let success = false;
        if (debt.tenantId.deviceToken) {
          success = await notificationService.sendPushNotification(
            debt.tenantId.deviceToken,
            title,
            message,
            { type: 'DEBT', debtId: debt._id.toString() }
          );
        }

        if (success) {
          debt.lastNotifiedAt = now;
          await debt.save();
        }
      }
    }
  } catch (error) {
    console.error('[cron] Borç kontrolünde hata oluştu:\n', error?.stack || error);
  }
});
