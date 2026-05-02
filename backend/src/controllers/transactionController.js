const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Debt = require('../models/Debt');

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
    console.log(`[GET /api/transactions] Tenant: ${req.tenantId}, Page: ${req.query.page}, Type: ${req.query.type}`);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    // Optional type filter
    const filter = { tenantId: tenantObjectId };
    if (req.query.type && ['INCOME', 'EXPENSE'].includes(req.query.type)) {
      filter.type = req.query.type;
    }

    const [transactions, total, totals, debtSummary] = await Promise.all([
      Transaction.find(filter)
        .sort({ transactionDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(filter),
      Transaction.aggregate([
        { $match: { tenantId: tenantObjectId } },
        {
          $group: {
            _id: '$type',
            sum: { $sum: '$amount' },
          },
        },
      ]),
      Debt.aggregate([
        { $match: { tenantId: tenantObjectId } },
        {
          $group: {
            _id: '$type',
            totalRemaining: { $sum: '$remainingAmount' },
          },
        },
      ]),
    ]);

    let totalIncome = 0;
    let totalExpense = 0;
    for (const t of totals) {
      if (t._id === 'INCOME') totalIncome = t.sum;
      if (t._id === 'EXPENSE') totalExpense = t.sum;
    }

    let totalDebt = 0; // TAKEN
    let totalReceivable = 0; // GIVEN
    for (const d of debtSummary) {
      if (d._id === 'TAKEN') totalDebt = d.totalRemaining;
      if (d._id === 'GIVEN') totalReceivable = d.totalRemaining;
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
          totalIncome,
          totalExpense,
          totalDebt,
          totalReceivable,
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
    console.log(`[POST /api/transactions] Received:`, { tenantId, type, amount, method, category });

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
    });

    console.log(`[POST /api/transactions] SUCCESS: Created ID ${transaction._id}`);

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

module.exports = { getTransactions, createTransaction };
