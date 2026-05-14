const Transaction = require('../models/Transaction');
const Debt = require('../models/Debt');

class ReportService {
  /**
   * Belirtilen tarih aralığı için normalize edilmiş rapor verisi üretir.
   * Excel ve PDF export işlemleri için backend tarafından kullanılır.
   * @param {string} tenantId 
   * @param {Date} startDate 
   * @param {Date} endDate 
   * @returns {Object} Normalize edilmiş rapor
   */
  static async generateReportData(tenantId, startDate, endDate) {
    try {
      const matchQuery = {
        tenantId: tenantId,
        isDeleted: false,
        transactionDate: { $gte: new Date(startDate), $lte: new Date(endDate) }
      };

      const transactions = await Transaction.find(matchQuery).sort({ transactionDate: 1 }).populate('directoryId');
      
      const debtQuery = {
        tenantId: tenantId,
        isDeleted: false,
        dueDate: { $gte: new Date(startDate), $lte: new Date(endDate) }
      };
      const debts = await Debt.find(debtQuery).sort({ dueDate: 1 }).populate('relatedId');

      let totalIncome = 0;
      let totalExpense = 0;

      const normalizedTransactions = transactions.map(tx => {
        if (tx.type === 'INCOME') totalIncome += tx.amount;
        if (tx.type === 'EXPENSE') totalExpense += tx.amount;

        return {
          id: tx._id,
          date: tx.transactionDate ? tx.transactionDate.toISOString().split('T')[0] : '',
          type: tx.type,
          amount: tx.amount,
          description: tx.description || '',
          directoryName: tx.directoryId ? tx.directoryId.name : 'Genel'
        };
      });

      const normalizedDebts = debts.map(debt => ({
        id: debt._id,
        dueDate: debt.dueDate ? debt.dueDate.toISOString().split('T')[0] : '',
        type: debt.type, // RECEIVABLE or PAYABLE
        amount: debt.totalAmount,
        status: debt.status,
        description: debt.description || '',
        directoryName: debt.relatedId ? debt.relatedId.name : 'Genel'
      }));

      return {
        tenantId,
        period: {
          start: startDate,
          end: endDate
        },
        summary: {
          totalIncome,
          totalExpense,
          netBalance: totalIncome - totalExpense
        },
        transactions: normalizedTransactions,
        debts: normalizedDebts,
        generatedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('[ReportService] Error generating report data:', error);
      throw new Error('Rapor verisi oluşturulamadı.');
    }
  }
}

module.exports = ReportService;
