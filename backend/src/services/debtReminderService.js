const Debt = require('../models/Debt');
const Tenant = require('../models/Tenant');
const notificationService = require('./notificationService');

class DebtReminderService {
  /**
   * Borç vadesi yaklaşanları kontrol eden asenkron batch servisi.
   * Gün içinde (örneğin 4 saatte bir) kısımlara bölünerek çalıştırılacak şekilde tasarlandı.
   */
  static async processUpcomingDebts() {
    try {
      console.log('[DebtReminderService] Checking upcoming debts...');
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const threeDaysLater = new Date(today);
      threeDaysLater.setDate(today.getDate() + 3);

      const upcomingDebts = await Debt.find({
        dueDate: { $gte: today, $lte: threeDaysLater },
        status: { $ne: 'PAID' },
        isDeleted: false
      }).populate('tenantId');

      for (const debt of upcomingDebts) {
        if (!debt.tenantId) continue;
        
        const daysLeft = Math.ceil((debt.dueDate - today) / (1000 * 60 * 60 * 24));
        
        console.info(`[DebtReminderService] Debt ${debt._id} for tenant ${debt.tenantId._id} is due in ${daysLeft} days.`);
        
        if (debt.tenantId.deviceToken) {
          await notificationService.sendPushNotification(
            debt.tenantId.deviceToken,
            'Borç Hatırlatması',
            `${debt.description || debt.entityName} başlıklı borcunuzun vadesine ${daysLeft} gün kaldı!`,
            { type: 'DEBT_REMINDER', debtId: debt._id.toString() }
          );
        }
      }

      console.log('[DebtReminderService] Upcoming debts check completed.');
    } catch (error) {
      console.error('[DebtReminderService] Error checking upcoming debts:', error);
    }
  }

  /**
   * Borcu gecikenleri kontrol eden servis
   */
  static async processOverdueDebts() {
    try {
        console.log('[DebtReminderService] Checking overdue debts...');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
  
        const overdueDebts = await Debt.find({
          dueDate: { $lt: today },
          status: { $ne: 'PAID' },
          isDeleted: false
        }).populate('tenantId');
  
        for (const debt of overdueDebts) {
          if (!debt.tenantId) continue;
          
          console.info(`[DebtReminderService] Debt ${debt._id} for tenant ${debt.tenantId._id} is OVERDUE.`);
          
          if (debt.tenantId.deviceToken) {
            await notificationService.sendPushNotification(
              debt.tenantId.deviceToken,
              'Gecikmiş Borç',
              `${debt.description || debt.entityName} başlıklı borcunuzun vadesi geçti!`,
              { type: 'DEBT_OVERDUE', debtId: debt._id.toString() }
            );
          }
        }
  
        console.log('[DebtReminderService] Overdue debts check completed.');
      } catch (error) {
        console.error('[DebtReminderService] Error checking overdue debts:', error);
      }
  }
}

module.exports = DebtReminderService;
