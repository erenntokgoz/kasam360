const mongoose = require('mongoose');
const Debt = require('../models/Debt');
const Transaction = require('../models/Transaction');

/**
 * Debt (Veresiye) Controller
 * ──────────────────────────────────────────────────────────────────────────────
 * All monetary values are stored and returned as integers (cents/kuruş).
 *
 * Debt types:
 *   GIVEN  — money the tenant is owed   (receivable / alacak)
 *   TAKEN  — money the tenant owes      (payable   / borç)
 *
 * Payment logic:
 *   Paying a GIVEN debt → tenant receives money   → creates INCOME Transaction
 *   Paying a TAKEN debt → tenant pays out money   → creates EXPENSE Transaction
 *
 * The `pay` endpoint uses MongoDB ACID transactions (session.withTransaction)
 * to ensure atomicity between the Debt update and Transaction creation.
 */

// ─────────────────────────────────────────────
// @route   POST /api/debts
// @access  Private (JWT)
// @body    { entityName, type, totalAmount, dueDate?, syncId? }
// ─────────────────────────────────────────────
const createDebt = async (req, res) => {
  try {
    const { tenantId } = req;
    const { entityName, type, totalAmount, dueDate, syncId } = req.body;
    console.log(`[POST /api/debts] Received:`, { tenantId, entityName, type, totalAmount });

    // ── Validation ─────────────────────────────────────────────────────────
    if (!entityName || !type || totalAmount == null) {
      return res.status(400).json({
        success: false,
        message: 'entityName, type, and totalAmount are required.',
      });
    }

    if (!['GIVEN', 'TAKEN'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'type must be either "GIVEN" or "TAKEN".',
      });
    }

    const amountInt = Math.round(Number(totalAmount));
    if (isNaN(amountInt) || amountInt <= 0) {
      return res.status(400).json({
        success: false,
        message: 'totalAmount must be a positive integer (cents/kuruş).',
      });
    }

    // ── Deduplication via syncId ────────────────────────────────────────────
    if (syncId) {
      const existing = await Debt.findOne({ syncId });
      if (existing) {
        return res.status(200).json({
          success: true,
          message: 'Debt already exists (deduplicated).',
          data: existing,
        });
      }
    }

    // ── Create ──────────────────────────────────────────────────────────────
    const session = await mongoose.startSession();
    let createdDebt;

    await session.withTransaction(async () => {
      const debt = await Debt.create(
        [
          {
            tenantId,
            entityName,
            type,
            totalAmount: amountInt,
            remainingAmount: amountInt,
            status: 'PENDING',
            dueDate: dueDate ? new Date(dueDate) : null,
            syncId: syncId || undefined,
          },
        ],
        { session }
      );

      createdDebt = debt[0];

      // Automatic Transaction creation per "Business Logic"
      // GIVEN debt (receivable) -> record as INCOME
      // TAKEN debt (payable)    -> record as EXPENSE
      const txType = type === 'GIVEN' ? 'INCOME' : 'EXPENSE';
      const category = type === 'GIVEN' ? 'ALACAK KAYDI' : 'BORÇ KAYDI';

      await Transaction.create(
        [
          {
            tenantId,
            type: txType,
            amount: amountInt,
            method: 'CASH',
            category,
            description: `${entityName} için veresiye kaydı.`,
            transactionDate: new Date(),
          },
        ],
        { session }
      );
    });

    session.endSession();

    console.log(`[POST /api/debts] SUCCESS: Created ID ${createdDebt._id} with linked transaction.`);

    return res.status(201).json({
      success: true,
      message: 'Debt and linked transaction created successfully.',
      data: createdDebt,
    });
  } catch (error) {
    // Handle duplicate syncId race condition
    if (error.code === 11000 && error.keyPattern?.syncId) {
      const existing = await Debt.findOne({ syncId: req.body.syncId });
      return res.status(200).json({
        success: true,
        message: 'Debt already exists (deduplicated).',
        data: existing,
      });
    }

    console.error('[debtController.createDebt]', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error creating debt.',
    });
  }
};

// ─────────────────────────────────────────────
// @route   GET /api/debts
// @access  Private (JWT)
// @query   ?type=GIVEN|TAKEN&status=PENDING|PARTIAL|PAID|OVERDUE&page=1&limit=20
// ─────────────────────────────────────────────
const getDebts = async (req, res) => {
  try {
    const tenantObjectId = new mongoose.Types.ObjectId(req.tenantId);
    console.log(`[GET /api/debts] Tenant: ${req.tenantId}, Page: ${req.query.page}, Type: ${req.query.type}`);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    // Build filter
    const filter = { tenantId: tenantObjectId };

    if (req.query.type && ['GIVEN', 'TAKEN'].includes(req.query.type)) {
      filter.type = req.query.type;
    }

    if (req.query.status && ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const [debts, total] = await Promise.all([
      Debt.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Debt.countDocuments(filter),
    ]);

    // Aggregate summary per type (all-time, unfiltered)
    const summary = await Debt.aggregate([
      { $match: { tenantId: tenantObjectId } },
      {
        $group: {
          _id: '$type',
          totalDebt: { $sum: '$totalAmount' },
          totalRemaining: { $sum: '$remainingAmount' },
          count: { $sum: 1 },
        },
      },
    ]);

    let givenTotal = 0, givenRemaining = 0, givenCount = 0;
    let takenTotal = 0, takenRemaining = 0, takenCount = 0;

    for (const s of summary) {
      if (s._id === 'GIVEN') {
        givenTotal = s.totalDebt;
        givenRemaining = s.totalRemaining;
        givenCount = s.count;
      }
      if (s._id === 'TAKEN') {
        takenTotal = s.totalDebt;
        takenRemaining = s.totalRemaining;
        takenCount = s.count;
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        debts,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        summary: {
          given: { total: givenTotal, remaining: givenRemaining, count: givenCount },
          taken: { total: takenTotal, remaining: takenRemaining, count: takenCount },
        },
      },
    });
  } catch (error) {
    console.error('[debtController.getDebts]', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error fetching debts.',
    });
  }
};

// ─────────────────────────────────────────────
// @route   POST /api/debts/:id/pay
// @access  Private (JWT)
// @body    { amount }  — integer in cents/kuruş
//
// ACID TRANSACTION:
//   1. Reduce debt.remainingAmount
//   2. Update debt.status to PARTIAL or PAID
//   3. Create a corresponding Transaction
//   All within session.withTransaction() for atomicity.
// ─────────────────────────────────────────────
const payDebt = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { tenantId } = req;
    const { id } = req.params;
    const { amount } = req.body;

    // ── Validate payment amount ────────────────────────────────────────────
    const paymentAmount = Math.round(Number(amount));
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be a positive integer (cents/kuruş).',
      });
    }

    // ── Validate debt ID format ────────────────────────────────────────────
    if (!mongoose.Types.ObjectId.isValid(id)) {
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid debt ID format.',
      });
    }

    let updatedDebt;
    let createdTransaction;

    await session.withTransaction(async () => {
      // ── Find the debt (within session) ─────────────────────────────────
      const debt = await Debt.findOne({
        _id: id,
        tenantId,
      }).session(session);

      if (!debt) {
        throw Object.assign(new Error('Debt not found or access denied.'), { httpStatus: 404 });
      }

      if (debt.status === 'PAID') {
        throw Object.assign(new Error('This debt is already fully paid.'), { httpStatus: 400 });
      }

      if (paymentAmount > debt.remainingAmount) {
        throw Object.assign(
          new Error(
            `Payment amount (${paymentAmount}) exceeds remaining balance (${debt.remainingAmount}).`,
          ),
          { httpStatus: 400 },
        );
      }

      // ── Update debt ────────────────────────────────────────────────────
      const newRemaining = debt.remainingAmount - paymentAmount;
      const newStatus = newRemaining === 0 ? 'PAID' : 'PARTIAL';

      debt.remainingAmount = newRemaining;
      debt.status = newStatus;
      await debt.save({ session });

      // ── Create corresponding Transaction ───────────────────────────────
      // GIVEN debt payment → tenant receives money  → INCOME
      // TAKEN debt payment → tenant pays out money   → EXPENSE
      const txType = debt.type === 'GIVEN' ? 'INCOME' : 'EXPENSE';

      const [transaction] = await Transaction.create(
        [
          {
            tenantId,
            type: txType,
            amount: paymentAmount,
            method: 'CASH', // default — can be extended with req.body.method later
            category: debt.type === 'GIVEN' ? 'Debt Collection' : 'Debt Payment',
            description: `${debt.type === 'GIVEN' ? 'Collected from' : 'Paid to'} ${debt.entityName}`,
            transactionDate: new Date(),
          },
        ],
        { session },
      );

      updatedDebt = debt;
      createdTransaction = transaction;
    });

    session.endSession();

    return res.status(200).json({
      success: true,
      message:
        updatedDebt.status === 'PAID'
          ? 'Debt fully paid. Transaction recorded.'
          : 'Partial payment recorded. Transaction created.',
      data: {
        debt: updatedDebt,
        transaction: createdTransaction,
      },
    });
  } catch (error) {
    session.endSession();

    // Custom HTTP status errors thrown from within the transaction
    if (error.httpStatus) {
      return res.status(error.httpStatus).json({
        success: false,
        message: error.message,
      });
    }

    console.error('[debtController.payDebt]', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error processing payment.',
    });
  }
};

module.exports = { createDebt, getDebts, payDebt };
