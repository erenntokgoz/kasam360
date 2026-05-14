const Transaction = require('../models/Transaction');
const MonthlySnapshot = require('../models/MonthlySnapshot');
const Tenant = require('../models/Tenant');
const { softDeleteMany } = require('../utils/softDelete');

const archivePastMonth = async () => {
  const tenants = await Tenant.find({ isDeleted: false });
  
  const now = new Date();
  const pastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthStr = `${pastMonth.getFullYear()}-${String(pastMonth.getMonth() + 1).padStart(2, '0')}`;

  for (const tenant of tenants) {
    const tenantId = tenant._id;
    
    const startOfPastMonth = new Date(pastMonth.getFullYear(), pastMonth.getMonth(), 1);
    const endOfPastMonth = new Date(pastMonth.getFullYear(), pastMonth.getMonth() + 1, 0, 23, 59, 59, 999);

    const transactions = await Transaction.find({
      tenantId,
      transactionDate: { $gte: startOfPastMonth, $lte: endOfPastMonth }, // Using 'transactionDate' instead of 'createdAt' if it exists, or fallback
      isDeleted: false
    });

    if (transactions.length === 0) continue;

    // Check if snapshot already exists
    const existingSnapshot = await MonthlySnapshot.findOne({ tenantId, month: monthStr, isDeleted: false });
    if (existingSnapshot) {
      console.log(`[Archive] Snapshot already exists for tenant ${tenantId} and month ${monthStr}`);
      continue;
    }

    // Create snapshot
    await MonthlySnapshot.create({
      tenantId,
      month: monthStr,
      data: { transactions }
    });

    // Soft delete original transactions
    await softDeleteMany(Transaction, {
      tenantId,
      transactionDate: { $gte: startOfPastMonth, $lte: endOfPastMonth }
    });
    
    console.log(`[Archive] Archived ${transactions.length} transactions for tenant ${tenantId} (${monthStr})`);
  }
};

module.exports = { archivePastMonth };
