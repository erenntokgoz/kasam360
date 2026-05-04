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
      if (!debt.tenantId) continue; // İşletme silinmişse atla

      const dueDate = new Date(debt.dueDate);
      const diffTime = dueDate.getTime() - now.getTime();
      const dueDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Sadece 3 gün kalanlar, tam vadesi gelenler veya gecikenler için uyarı üret
      if (dueDays <= 3) {
        const alertData = {
          userBusinessName: debt.tenantId.businessName,
          debtorName: debt.entityName,
          amountTL: debt.totalAmount / 100, // Cents to TL
          dueDays: dueDays,
          balanceTL: debt.remainingAmount / 100, // Cents to TL
          status: debt.status === 'OVERDUE' || dueDays < 0 ? 'Gecikmiş' : 'Yaklaşan'
        };

        const message = await generateAlertFromAI(alertData);
        
        // Şimdilik tenant'ın bir deviceToken'ı olmadığı için telefonuna SMS gönderme simülasyonu yapıyoruz
        const title = `Kasam360: ${alertData.status} Borç Uyarısı`;
        await notificationService.sendPushNotification(debt.tenantId.phone, title, message);
      }
    }
  } catch (error) {
    console.error('[cron] AI uyarı kontrolünde hata oluştu:', error);
  }
});
