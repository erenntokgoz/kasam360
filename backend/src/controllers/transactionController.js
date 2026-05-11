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
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { tenantId: tenantObjectId, isDeleted: false };
    
    // Cursor-based pagination support
    if (req.query.before) {
      filter.transactionDate = { $lt: new Date(req.query.before) };
    }

    if (req.query.type && req.query.type !== 'ALL' && ['INCOME', 'EXPENSE'].includes(req.query.type)) filter.type = req.query.type;
    
    if (req.query.startDate || req.query.endDate) {
      if (!filter.transactionDate) filter.transactionDate = {};
      if (req.query.startDate) filter.transactionDate.$gte = new Date(req.query.startDate);
      if (req.query.endDate) filter.transactionDate.$lte = new Date(req.query.endDate);
    }
    
    if (req.query.categories) {
      const cats = req.query.categories.split(',');
      filter.category = { $in: cats };
    }

    const [transactions, total, tenant] = await Promise.all([
      Transaction.find(filter).sort({ transactionDate: -1 }).skip(skip).limit(limit).lean(),
      Transaction.countDocuments(filter),
      Tenant.findById(req.tenantId).select('openingBalance currentBalance').lean(),
    ]);

    const currentBalance = tenant?.currentBalance || 0;
    const totals = await Transaction.aggregate([
      { $match: { tenantId: tenantObjectId, isDeleted: false } },
      { $group: { _id: '$type', sum: { $sum: '$amount' } } },
    ]);

    let totalIncome = 0, totalExpense = 0;
    for (const t of totals) {
      if (t._id === 'INCOME') totalIncome = t.sum;
      if (t._id === 'EXPENSE') totalExpense = t.sum;
    }

    const debtTotals = await Debt.aggregate([
      { $match: { tenantId: tenantObjectId, isDeleted: false, status: { $ne: 'PAID' } } },
      { $group: { _id: '$type', sum: { $sum: '$remainingAmount' } } },
    ]);

    let totalDebt = 0, totalReceivable = 0;
    for (const d of debtTotals) {
      if (d._id === 'TAKEN') totalDebt = d.sum;
      if (d._id === 'GIVEN') totalReceivable = d.sum;
    }

    return res.status(200).json({
      success: true,
      data: {
        transactions,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        summary: { totalIncome, totalExpense, balance: currentBalance, totalDebt, totalReceivable },
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
    
    let createdTx;
    await session.withTransaction(async () => {
      if (syncId) {
        const existing = await Transaction.findOne({ syncId }).session(session);
        if (existing) { createdTx = existing; return; }
      }

      const tenant = await Tenant.findByIdAndUpdate(
        tenantId,
        { $inc: { currentBalance: type === 'INCOME' ? amountInt : -amountInt } },
        { new: true, session }
      );

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
        balanceAfter: tenant.currentBalance,
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

      const oldData = transaction.toObject();
      const oldAmount = transaction.amount;
      const newAmount = updateData.amount !== undefined ? Math.round(Number(updateData.amount)) : oldAmount;
      const newType = updateData.type || oldData.type;

      if (transaction.relatedType === 'DEBT' && transaction.relatedId && (oldAmount !== newAmount || updateData.type)) {
        const debt = await Debt.findOne({ _id: transaction.relatedId, tenantId }).session(session);
        if (debt) {
          debt.remainingAmount = (debt.remainingAmount + oldAmount) - newAmount;
          debt.status = debt.remainingAmount <= 0 ? 'PAID' : (debt.remainingAmount >= debt.totalAmount ? 'PENDING' : 'PARTIAL');
          await debt.save({ session });
        }
      }

      const oldImpact = oldData.type === 'INCOME' ? oldData.amount : -oldData.amount;
      const newImpact = newType === 'INCOME' ? newAmount : -newAmount;
      const netChange = newImpact - oldImpact;

      const updatedTenant = await Tenant.findByIdAndUpdate(tenantId, { $inc: { currentBalance: netChange } }, { new: true, session });

      const ALLOWED_FIELDS = ['type', 'amount', 'method', 'category', 'description', 'transactionDate'];
      for (const field of ALLOWED_FIELDS) {
        if (updateData[field] !== undefined) {
          if (field === 'amount') transaction[field] = newAmount;
          else if (field === 'transactionDate') transaction[field] = new Date(updateData[field]);
          else transaction[field] = updateData[field];
        }
      }
      transaction.balanceAfter = updatedTenant.currentBalance;
      await transaction.save({ session });

      await AuditLog.create([{
        tenantId, action: 'UPDATE', entityType: 'TRANSACTION', entityId: transaction._id,
        changes: { before: oldData, after: transaction.toObject() },
      }], { session });
    });

    session.endSession();
    return res.status(200).json({ success: true, message: 'İşlem güncellendi.', data: transaction });
  } catch (error) {
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

      if (transaction.relatedType === 'DEBT' && transaction.relatedId) {
        const debt = await Debt.findOne({ _id: transaction.relatedId, tenantId }).session(session);
        if (debt) {
          const isInitial = ['Borç Verildi', 'Borç Alındı'].includes(transaction.category);
          if (isInitial) debt.isDeleted = true;
          else {
            debt.remainingAmount += transaction.amount;
            debt.status = debt.remainingAmount >= debt.totalAmount ? 'PENDING' : 'PARTIAL';
          }
          await debt.save({ session });
        }
      }

      const rollbackImpact = transaction.type === 'INCOME' ? -transaction.amount : transaction.amount;
      await Tenant.findByIdAndUpdate(tenantId, { $inc: { currentBalance: rollbackImpact } }, { session });

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
