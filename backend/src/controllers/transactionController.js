const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Tenant = require('../models/Tenant');
const Debt = require('../models/Debt');
const AuditLog = require('../models/AuditLog');

/**
 * Transaction CRUD Controller
 * ──────────────────────────────────────────────────────────────────────────────
 * All amounts are stored and returned as integers (cents/kuruş).
 */

const { transactionSchemas } = require('../utils/validation');

const getTransactions = async (req, res, next) => {
  try {
    const tenantObjectId = new mongoose.Types.ObjectId(req.tenantId);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    
    const filter = { tenantId: tenantObjectId, isDeleted: false };

    // Cursor-based pagination using transactionDate and _id as tie-breaker
    if (req.query.next_cursor) {
      try {
        const [lastDate, lastId] = Buffer.from(req.query.next_cursor, 'base64').toString('ascii').split('|');
        filter.$or = [
          { transactionDate: { $lt: new Date(lastDate) } },
          { 
            transactionDate: new Date(lastDate), 
            _id: { $lt: new mongoose.Types.ObjectId(lastId) } 
          }
        ];
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid cursor format' });
      }
    }

    if (req.query.type && req.query.type !== 'ALL' && ['INCOME', 'EXPENSE'].includes(req.query.type)) {
      filter.type = req.query.type;
    }
    
    if (req.query.startDate || req.query.endDate) {
      if (!filter.transactionDate) filter.transactionDate = {};
      if (req.query.startDate) filter.transactionDate.$gte = new Date(req.query.startDate);
      if (req.query.endDate) filter.transactionDate.$lte = new Date(req.query.endDate);
    }
    
    if (req.query.categories) {
      const cats = req.query.categories.split(',');
      filter.category = { $in: cats };
    }

    // Fetch one extra to check if there's a next page
    const transactions = await Transaction.find(filter)
      .sort({ transactionDate: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasNextPage = transactions.length > limit;
    if (hasNextPage) transactions.pop();

    const nextCursor = hasNextPage 
      ? Buffer.from(`${transactions[transactions.length - 1].transactionDate.toISOString()}|${transactions[transactions.length - 1]._id}`).toString('base64')
      : null;

    const totalsMatch = { tenantId: tenantObjectId, isDeleted: false };
    if (req.query.startDate || req.query.endDate) {
      totalsMatch.transactionDate = {};
      if (req.query.startDate) totalsMatch.transactionDate.$gte = new Date(req.query.startDate);
      if (req.query.endDate) totalsMatch.transactionDate.$lte = new Date(req.query.endDate);
    }

    const [tenant, totals, debtTotals] = await Promise.all([
      Tenant.findById(req.tenantId).select('currentBalance').lean(),
      Transaction.aggregate([
        { $match: totalsMatch },
        { $group: { _id: '$type', sum: { $sum: '$amount' } } },
      ]),
      Debt.aggregate([
        { $match: { tenantId: tenantObjectId, isDeleted: false, status: { $ne: 'PAID' } } },
        { $group: { _id: '$type', sum: { $sum: '$remainingAmount' } } },
      ])
    ]);

    let totalIncome = 0, totalExpense = 0;
    for (const t of totals) {
      if (t._id === 'INCOME') totalIncome = t.sum;
      if (t._id === 'EXPENSE') totalExpense = t.sum;
    }

    let totalDebt = 0, totalReceivable = 0;
    for (const d of debtTotals) {
      if (d._id === 'TAKEN') totalDebt = d.sum;
      if (d._id === 'GIVEN') totalReceivable = d.sum;
    }

    return res.status(200).json({
      success: true,
      data: {
        transactions,
        pagination: {
          limit,
          next_cursor: nextCursor,
          hasNextPage
        },
        summary: {
          totalIncome,
          totalExpense,
          balance: tenant?.currentBalance || 0,
          totalDebt,
          totalReceivable
        },
      },
    });
  } catch (error) { next(error); }
};

const createTransaction = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { error } = transactionSchemas.create.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { tenantId } = req;
    const { type, amount, method, category, description, transactionDate, syncId, relatedId, relatedType } = req.body;
    const amountInt = Math.round(Number(amount));
    
    // Strict Validation: VERESİYE requires directoryId
    if (method === 'VERESİYE' && !req.body.directoryId && !relatedId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Veresiye işlemleri için rehber kaydı (directoryId) zorunludur.' 
      });
    }

    let createdTx;
    await session.withTransaction(async () => {
      // Fetch tenant once for initial balance and checks
      const tenant = await Tenant.findById(tenantId).session(session);
      if (!tenant) throw new Error('Tenant not found');

      if (syncId) {
        const existing = await Transaction.findOne({ syncId }).session(session);
        if (existing) {
          // Logic for updating existing transaction via syncId
          // Most of the logic is now handled by hooks on .save()
          existing.type = type;
          existing.amount = amountInt;
          existing.method = method;
          existing.category = category || null;
          existing.description = description || null;
          if (transactionDate) existing.transactionDate = new Date(transactionDate);
          
          await existing.save({ session });
          createdTx = existing; 
          return; 
        }
      }

      let finalDirId = (relatedType === 'CONTACT' || relatedType === 'STAFF') ? relatedId : (req.body.directoryId || null);
      let finalDirType = (relatedType === 'CONTACT' || relatedType === 'STAFF') ? relatedType : (req.body.directoryType || null);

      // Auto-directory creation logic
      if (!finalDirId && description && (category === 'Personel Gideri' || category === 'İşletme Gideri')) {
        const Directory = require('../models/Directory');
        const entityName = description.split(' - ')[0].trim();
        if (entityName && entityName.length > 0 && entityName !== 'Kişisel Gider') {
          let entry = await Directory.findOne({
            tenantId,
            name: { $regex: new RegExp(`^${entityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
            isDeleted: false
          }).session(session);

          if (!entry) {
            const roleType = category === 'Personel Gideri' ? 'STAFF' : 'CONTACT';
            entry = (await Directory.create([{
              tenantId,
              name: entityName,
              roles: [roleType],
              role: roleType === 'STAFF' ? 'Personel' : undefined
            }], { session }))[0];
          }
          finalDirId = entry._id;
          finalDirType = entry.roles.includes('STAFF') ? 'STAFF' : 'CONTACT';
        }
      }

      // Balance updates are now handled by Transaction Model Hooks!
      // We just need to create the transaction.
      const [tx] = await Transaction.create([{
        tenantId,
        type,
        amount: amountInt,
        method,
        category: category || null,
        description: description || null,
        transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
        syncId: syncId || undefined,
        relatedId,
        relatedType,
        directoryId: finalDirId,
        directoryType: finalDirType,
        balanceAfter: tenant.currentBalance, // Initial placeholder, hook will update it if needed or we update it after
      }], { session });

      createdTx = tx;
    });

    session.endSession();
    return res.status(201).json({ success: true, message: 'İşlem oluşturuldu.', data: createdTx });
  } catch (error) {
    session.endSession();
    next(error);
  }
};

const updateTransaction = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { tenantId } = req;
    const { id } = req.params;
    const updateData = req.body;

    let transaction;
    await session.withTransaction(async () => {
      transaction = await Transaction.findOne({ _id: id, tenantId }).session(session);
      if (!transaction || transaction.isDeleted) throw Object.assign(new Error('İşlem bulunamadı.'), { httpStatus: 404 });

      // Note: Model hooks handle balance rollbacks and re-applications upon .save()
      // However, Mongoose post('save') needs to know the difference.
      // For simplicity in this architecture, we rely on the hooks to handle the NEW state.
      // If we need differential updates, we'd use pre('save') to calculate the delta.

      const ALLOWED_FIELDS = ['type', 'amount', 'method', 'category', 'description', 'transactionDate'];
      for (const field of ALLOWED_FIELDS) {
        if (updateData[field] !== undefined) {
          if (field === 'amount') transaction[field] = Math.round(Number(updateData[field]));
          else if (field === 'transactionDate') transaction[field] = new Date(updateData[field]);
          else transaction[field] = updateData[field];
        }
      }
      
      await transaction.save({ session });

      await AuditLog.create([{
        tenantId, action: 'UPDATE', entityType: 'TRANSACTION', entityId: transaction._id,
        changes: { after: transaction.toObject() },
      }], { session });
    });

    session.endSession();
    return res.status(200).json({ success: true, message: 'İşlem güncellendi.', data: transaction });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    next(error);
  }
};

const deleteTransaction = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { tenantId } = req;
    const { id } = req.params;

    await session.withTransaction(async () => {
      const transaction = await Transaction.findOne({ _id: id, tenantId }).session(session);
      if (!transaction || transaction.isDeleted) throw Object.assign(new Error('İşlem bulunamadı.'), { httpStatus: 404 });

      // In a real production system with hooks, we need to handle the balance reversal.
      // If we just set isDeleted = true and .save(), the hook needs to know it's a deletion.
      
      transaction.isDeleted = true;
      await transaction.save({ session });

      await AuditLog.create([{
        tenantId, action: 'DELETE', entityType: 'TRANSACTION', entityId: transaction._id,
        changes: { deletedRecord: transaction.toObject() },
      }], { session });
    });

    session.endSession();
    return res.status(200).json({ success: true, message: 'İşlem silindi.' });
  } catch (error) {
    session.endSession();
    next(error);
  }
};

module.exports = { getTransactions, createTransaction, updateTransaction, deleteTransaction };
