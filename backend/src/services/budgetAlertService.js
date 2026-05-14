const Transaction = require('../models/Transaction');
const Tenant = require('../models/Tenant');
const notificationService = require('./notificationService');

class BudgetAlertService {
  /**
   * Bütçe kontrolünü asenkron olarak gün içine yayarak yapar.
   * Her eklendiğinde veya güncellendiğinde çağrılabilir.
   * @param {string} tenantId 
   * @param {number} currentAmount 
   * @param {string} type 
   */
  static async checkBudget(tenantId, currentAmount, type) {
    if (type !== 'EXPENSE') return;

    try {
      const tenant = await Tenant.findById(tenantId);
      if (!tenant) return;

      const budgetLimit = tenant.budgetLimit || 0; // Assuming Tenant has a budgetLimit
      if (budgetLimit === 0) return;

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const transactions = await Transaction.aggregate([
        { 
          $match: { 
            tenantId: tenant._id, 
            type: 'EXPENSE',
            transactionDate: { $gte: startOfMonth },
            isDeleted: false 
          } 
        },
        { 
          $group: { 
            _id: null, 
            total: { $sum: '$amount' } 
          } 
        }
      ]);

      const totalExpense = transactions[0]?.total || 0;

      if (totalExpense > budgetLimit) {
        console.warn(`[BudgetAlert] Tenant ${tenantId} exceeded budget limit! Limit: ${budgetLimit}, Current: ${totalExpense}`);
        
        if (tenant.deviceToken) {
          await notificationService.sendPushNotification(
            tenant.deviceToken,
            'Bütçe Aşıldı',
            'Aylık bütçe limitinizi aştınız!',
            { type: 'BUDGET_ALERT' }
          );
        }
      } else if (totalExpense > budgetLimit * 0.8) {
        console.info(`[BudgetAlert] Tenant ${tenantId} reached 80% of budget.`);
        
        if (tenant.deviceToken) {
          await notificationService.sendPushNotification(
            tenant.deviceToken,
            'Bütçe Uyarısı',
            'Aylık bütçe limitinizin %80\'ine ulaştınız!',
            { type: 'BUDGET_ALERT' }
          );
        }
      }
    } catch (error) {
      console.error('[BudgetAlertService] Error checking budget:', error);
    }
  }

  /**
   * Eskiden gece 2:00'de çalışan cron yerine, 
   * gün içinde belirli aralıklarla (batch halinde) kontrol eden fonksiyon.
   */
  static async processDailyBatch() {
    try {
      console.log('[BudgetAlertService] Processing daily batch...');
      const tenants = await Tenant.find({ isDeleted: false });
      for (const tenant of tenants) {
        await this.checkBudget(tenant._id, 0, 'EXPENSE'); // Trigger a check without adding new amount
      }
    } catch (error) {
      console.error('[BudgetAlertService] Error in daily batch:', error);
    }
  }
}

module.exports = BudgetAlertService;
