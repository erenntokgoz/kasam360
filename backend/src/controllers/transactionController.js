const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const AuditLog = require('../models/AuditLog');

/**
 * Transaction CRUD Controller
 * ──────────────────────────────────────────────────────────────────────────────
 * All amounts are stored and returned as integers (cents/kuruş).
 * Every query is tenant-scoped via req.tenantId from the auth middleware.
 */

// ─────────────────────────────────────────────
// @route   GET /api/transactions
// @access  Private (JWT)
// @query   ?page=1&limit=20&type=INCOME|EXPENSE
// ─────────────────────────────────────────────
const getTransactions = async (req, res) => {
  try {
    const tenantObjectId = new mongoose.Types.ObjectId(req.tenantId);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    // Optional type filter
    const filter = { tenantId: tenantObjectId, isDeleted: false };
    if (req.query.type && req.query.type !== 'ALL' && ['INCOME', 'EXPENSE'].includes(req.query.type)) {
      filter.type = req.query.type;
    }
    
    // Optional date range filter
    if (req.query.startDate || req.query.endDate) {
      filter.transactionDate = {};
      if (req.query.startDate) filter.transactionDate.$gte = new Date(req.query.startDate);
      if (req.query.endDate) filter.transactionDate.$lte = new Date(req.query.endDate);
    }
    
    // Optional categories filter
    if (req.query.categories) {
      const cats = req.query.categories.split(',');
      filter.category = { $in: cats };
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ transactionDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    // Compute running totals for the tenant (filtered by date/categories but keep all types)
    // Wait, the UI wants "Seçili tarih aralığına göre gelir, gider, bakiye göster"
    // So the totals should be based on the SAME filter, but without the type filter?
    // Actually, if they filter by type='INCOME', they probably still want to see total income in that date range.
    // The previous implementation computed all-time unfiltered totals. But the prompt explicitly asks:
    // "Seçili tarih aralığına göre gelir, gider, bakiye göster"
    
    const summaryFilter = { ...filter };
    delete summaryFilter.type; // We want both income and expense for the summary
    
    const totals = await Transaction.aggregate([
      { $match: summaryFilter },
      {
        $group: {
          _id: '$type',
          sum: { $sum: '$amount' },
        },
      },
    ]);

    let totalIncome = 0;
    let totalExpense = 0;
    for (const t of totals) {
      if (t._id === 'INCOME') totalIncome = t.sum;
      if (t._id === 'EXPENSE') totalExpense = t.sum;
    }

    return res.status(200).json({
      success: true,
      data: {
        transactions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        summary: {
          totalIncome,   // integer cents
          totalExpense,  // integer cents
          balance: totalIncome - totalExpense,
        },
      },
    });
  } catch (error) {
    console.error('[transactionController.getTransactions]', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error fetching transactions.',
    });
  }
};

// ─────────────────────────────────────────────
// @route   POST /api/transactions
// @access  Private (JWT)
// @body    { type, amount, method, category?, description?, transactionDate?, syncId? }
// ─────────────────────────────────────────────
const createTransaction = async (req, res) => {
  try {
    const { tenantId } = req;
    const { type, amount, method, category, description, transactionDate, syncId } = req.body;

    // ── Validation ─────────────────────────────────────────────────────────
    if (!type || amount == null || !method) {
      return res.status(400).json({
        success: false,
        message: 'type, amount, and method are required fields.',
      });
    }

    if (!['INCOME', 'EXPENSE'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'type must be either "INCOME" or "EXPENSE".',
      });
    }

    if (!['CASH', 'POS', 'IBAN'].includes(method)) {
      return res.status(400).json({
        success: false,
        message: 'method must be one of "CASH", "POS", "IBAN".',
      });
    }

    const amountInt = Math.round(Number(amount));
    if (isNaN(amountInt) || amountInt <= 0) {
      return res.status(400).json({
        success: false,
        message: 'amount must be a positive integer (cents/kuruş).',
      });
    }

    // ── Deduplication via syncId ────────────────────────────────────────────
    if (syncId) {
      const existing = await Transaction.findOne({ syncId });
      if (existing) {
        return res.status(200).json({
          success: true,
          message: 'Transaction already exists (deduplicated).',
          data: existing,
        });
      }
    }

    // ── Calculate Current Balance ───────────────────────────────────────────
    const tenantObjectId = new mongoose.Types.ObjectId(tenantId);
    const totals = await Transaction.aggregate([
      { $match: { tenantId: tenantObjectId } },
      {
        $group: {
          _id: '$type',
          sum: { $sum: '$amount' },
        },
      },
    ]);

    let currentBalance = 0;
    for (const t of totals) {
      if (t._id === 'INCOME') currentBalance += t.sum;
      if (t._id === 'EXPENSE') currentBalance -= t.sum;
    }

    const balanceAfter = type === 'INCOME' ? currentBalance + amountInt : currentBalance - amountInt;

    // ── Create ──────────────────────────────────────────────────────────────
    const transaction = await Transaction.create({
      tenantId,
      type,
      amount: amountInt,
      method,
      category: category || null,
      description: description || null,
      transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
      syncId: syncId || undefined,
      balanceAfter,
    });

    return res.status(201).json({
      success: true,
      message: 'Transaction created successfully.',
      data: transaction,
    });
  } catch (error) {
    // Handle duplicate syncId race condition
    if (error.code === 11000 && error.keyPattern?.syncId) {
      const existing = await Transaction.findOne({ syncId: req.body.syncId });
      return res.status(200).json({
        success: true,
        message: 'Transaction already exists (deduplicated).',
        data: existing,
      });
    }

    console.error('[transactionController.createTransaction]', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error creating transaction.',
    });
  }
};

// ─────────────────────────────────────────────
// @route   PUT /api/transactions/:id
// @access  Private (JWT)
// ─────────────────────────────────────────────
const updateTransaction = async (req, res) => {
  try {
    const { tenantId } = req;
    const { id } = req.params;
    const updateData = req.body;

    const transaction = await Transaction.findOne({ _id: id, tenantId });
    if (!transaction || transaction.isDeleted) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const oldData = transaction.toObject();

    if (updateData.amount !== undefined) updateData.amount = Math.round(Number(updateData.amount));

    Object.assign(transaction, updateData);
    await transaction.save();

    await AuditLog.create({
      tenantId,
      action: 'UPDATE',
      entityType: 'TRANSACTION',
      entityId: transaction._id,
      changes: { before: oldData, after: transaction.toObject() },
    });

    return res.status(200).json({ success: true, message: 'Transaction updated', data: transaction });
  } catch (error) {
    console.error('[transactionController.updateTransaction]', error);
    return res.status(500).json({ success: false, message: 'Internal server error updating transaction.' });
  }
};

// ─────────────────────────────────────────────
// @route   DELETE /api/transactions/:id
// @access  Private (JWT)
// ─────────────────────────────────────────────
const deleteTransaction = async (req, res) => {
  try {
    const { tenantId } = req;
    const { id } = req.params;

    const transaction = await Transaction.findOne({ _id: id, tenantId });
    if (!transaction || transaction.isDeleted) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    transaction.isDeleted = true;
    await transaction.save();

    await AuditLog.create({
      tenantId,
      action: 'DELETE',
      entityType: 'TRANSACTION',
      entityId: transaction._id,
      changes: { deletedRecord: transaction.toObject() },
    });

    return res.status(200).json({ success: true, message: 'Transaction deleted' });
  } catch (error) {
    console.error('[transactionController.deleteTransaction]', error);
    return res.status(500).json({ success: false, message: 'Internal server error deleting transaction.' });
  }
};

module.exports = { getTransactions, createTransaction, updateTransaction, deleteTransaction };
