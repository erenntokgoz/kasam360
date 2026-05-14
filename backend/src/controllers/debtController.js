const mongoose = require('mongoose');
const Debt = require('../models/Debt');
const Transaction = require('../models/Transaction');
const Tenant = require('../models/Tenant');
const AuditLog = require('../models/AuditLog');

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
const createDebt = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { tenantId } = req;
    const { entityName, type, totalAmount, dueDate, syncId, description, isCash } = req.body;

    if (!entityName || !type || totalAmount == null) {
      return res.status(400).json({ success: false, message: 'İsim, tip ve tutar alanları zorunludur.' });
    }

    if (!['GIVEN', 'TAKEN'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Borç tipi "GIVEN" veya "TAKEN" olmalıdır.' });
    }

    const amountInt = Math.round(Number(totalAmount));
    if (isNaN(amountInt) || amountInt <= 0) {
      return res.status(400).json({ success: false, message: 'Tutar pozitif bir sayı olmalıdır.' });
    }

    let createdDebt;
    let isDeletedHandled = false;
    let isUpdated = false;
    await session.withTransaction(async () => {
      if (syncId) {
        const existing = await Debt.findOne({ syncId }).session(session);
        if (existing) {
          if (existing.isDeleted === true) {
            return res.status(200).json({ success: true, message: 'Borç silinmiş.' });
          }
          existing.totalAmount = req.body.totalAmount || existing.totalAmount;
          existing.remainingAmount = req.body.remainingAmount !== undefined ? req.body.remainingAmount : existing.remainingAmount;
          await existing.save({ session });
          return res.status(200).json({ success: true, message: 'Borç güncellendi (Upsert).', data: existing });
        }
      }

      let relatedId = req.body.relatedId;
      let relatedType = req.body.relatedType || 'CONTACT';

      // Auto-link directory or CREATE if not exists
      if (!relatedId && entityName) {
        const Directory = require('../models/Directory');
        const trimmedName = entityName.trim();
        let entry = await Directory.findOne({ 
          tenantId, 
          name: { $regex: new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          isDeleted: false 
        }).session(session);

        if (!entry) {
          // Yeni rehber kaydı oluştur
          const [newEntry] = await Directory.create([{
            tenantId,
            name: trimmedName,
            roles: ['CONTACT']
          }], { session });
          entry = newEntry;
        }

        relatedId = entry._id;
        relatedType = entry.roles.includes('STAFF') ? 'STAFF' : 'CONTACT';
      }

      const [debt] = await Debt.create([{
        tenantId,
        entityName,
        type,
        totalAmount: amountInt,
        remainingAmount: amountInt,
        status: 'PENDING',
        dueDate: dueDate ? new Date(dueDate) : null,
        description: description ? String(description).trim() : null,
        syncId: syncId || undefined,
        relatedId,
        relatedType
      }], { session });

      // Always create a transaction log for traceability, but only update balance if isCash is true
      const txType = type === 'GIVEN' ? 'EXPENSE' : 'INCOME';
      let balanceAfter;

      if (isCash) {
        const tenant = await Tenant.findByIdAndUpdate(
          tenantId,
          { $inc: { currentBalance: txType === 'INCOME' ? amountInt : -amountInt } },
          { new: true, session }
        );
        balanceAfter = tenant.currentBalance;
      } else {
        // Get current balance without updating
        const tenant = await Tenant.findById(tenantId).session(session);
        balanceAfter = tenant.currentBalance;
      }

      await Transaction.create([{
        tenantId,
        type: txType,
        amount: amountInt,
        method: isCash ? 'CASH' : 'VERESİYE',
        category: type === 'GIVEN' ? 'Alacak' : 'Borç',
        description: description ? String(description).trim() : (isCash 
          ? `${entityName} ${type === 'GIVEN' ? 'kişisine alacak kaydedildi' : 'kişisinden borç alındı'}`
          : `${entityName} - Veresiye ${type === 'GIVEN' ? 'Alacak' : 'Borç'} Kaydı`),
        transactionDate: new Date(),
        balanceAfter,
        relatedId: debt._id,
        relatedType: 'DEBT',
        directoryId: relatedId,
        directoryType: relatedType
      }], { session });

      createdDebt = debt;
    });

    session.endSession();
    
    if (isDeletedHandled) {
      return res.status(200).json({ success: true, message: 'Borç silinmiş olduğu için atlandı.' });
    }
    if (isUpdated) {
      return res.status(200).json({ success: true, message: 'Borç kaydı güncellendi.', data: createdDebt });
    }
    
    return res.status(201).json({ success: true, message: 'Borç kaydı oluşturuldu.', data: createdDebt });
  } catch (error) {
    session.endSession();
    if (error.httpStatus === 200) {
      return res.status(200).json({ success: true, message: error.message, data: error.data });
    }
    next(error);
  }
};

const getDebts = async (req, res, next) => {
  try {
    const tenantObjectId = new mongoose.Types.ObjectId(req.tenantId);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { tenantId: tenantObjectId, isDeleted: false };
    if (req.query.type && ['GIVEN', 'TAKEN'].includes(req.query.type)) filter.type = req.query.type;
    if (req.query.status && ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'].includes(req.query.status)) filter.status = req.query.status;

    const [debts, total] = await Promise.all([
      Debt.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Debt.countDocuments(filter),
    ]);

    const summary = await Debt.aggregate([
      { $match: { tenantId: tenantObjectId, isDeleted: false } },
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
        givenTotal = s.totalDebt; givenRemaining = s.totalRemaining; givenCount = s.count;
      } else if (s._id === 'TAKEN') {
        takenTotal = s.totalDebt; takenRemaining = s.totalRemaining; takenCount = s.count;
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        debts,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        summary: {
          given: { total: givenTotal, remaining: givenRemaining, count: givenCount },
          taken: { total: takenTotal, remaining: takenRemaining, count: takenCount },
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

const payDebt = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { tenantId } = req;
    const { id } = req.params;
    const { amount, method } = req.body;

    const paymentAmount = Math.round(Number(amount));
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Ödeme tutarı geçerli bir sayı olmalıdır.' });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Geçersiz borç ID formatı.' });
    }

    let updatedDebt, createdTransaction;
    await session.withTransaction(async () => {
      const debt = await Debt.findOne({ _id: id, tenantId, isDeleted: false }).session(session);
      if (!debt) throw Object.assign(new Error('Borç kaydı bulunamadı.'), { httpStatus: 404 });
      if (debt.status === 'PAID') throw Object.assign(new Error('Bu borç zaten tamamen ödenmiş.'), { httpStatus: 400 });
      if (paymentAmount > debt.remainingAmount) {
        throw Object.assign(new Error(`Ödeme tutarı (${paymentAmount}) kalan bakiyeyi (${debt.remainingAmount}) aşamaz.`), { httpStatus: 400 });
      }

      const newRemaining = debt.remainingAmount - paymentAmount;
      debt.remainingAmount = newRemaining;
      debt.status = newRemaining === 0 ? 'PAID' : 'PARTIAL';
      await debt.save({ session });

      const txType = debt.type === 'GIVEN' ? 'INCOME' : 'EXPENSE';
      const tenantRecord = await Tenant.findByIdAndUpdate(
        tenantId,
        { $inc: { currentBalance: txType === 'INCOME' ? paymentAmount : -paymentAmount } },
        { new: true, session }
      );

      const [transaction] = await Transaction.create([{
        tenantId,
        type: txType,
        amount: paymentAmount,
        method: method || 'CASH',
        category: debt.type === 'GIVEN' ? 'Alacak Tahsili' : 'Borç Ödemesi',
        description: `${debt.entityName} kişisinden ${debt.type === 'GIVEN' ? 'alacak tahsil edildi' : 'borç ödemesi yapıldı'}`,
        transactionDate: new Date(),
        balanceAfter: tenantRecord.currentBalance,
        relatedId: debt._id,
        relatedType: 'DEBT',
        directoryId: debt.relatedId, // Also link to directory for easy filtering
        directoryType: debt.relatedType
      }], { session });

      updatedDebt = debt;
      createdTransaction = transaction;
    });

    session.endSession();
    return res.status(200).json({
      success: true,
      message: updatedDebt.status === 'PAID' ? 'Borç tamamen kapatıldı.' : 'Ödeme kaydedildi.',
      data: { debt: updatedDebt, transaction: createdTransaction },
    });
  } catch (error) {
    session.endSession();
    next(error);
  }
};

const updateDebt = async (req, res, next) => {
  try {
    const { tenantId } = req;
    const { id } = req.params;
    const debt = await Debt.findOne({ _id: id, tenantId, isDeleted: false });
    if (!debt) return res.status(404).json({ success: false, message: 'Borç bulunamadı.' });

    const oldData = debt.toObject();
    const ALLOWED_FIELDS = ['entityName', 'dueDate', 'notes', 'description'];
    const safeUpdate = {};
    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) safeUpdate[field] = req.body[field];
    }

    Object.assign(debt, safeUpdate);
    await debt.save();

    await AuditLog.create({
      tenantId,
      action: 'UPDATE',
      entityType: 'DEBT',
      entityId: debt._id,
      changes: { before: oldData, after: debt.toObject() },
    });

    return res.status(200).json({ success: true, message: 'Borç güncellendi.', data: debt });
  } catch (error) {
    next(error);
  }
};

const deleteDebt = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { tenantId } = req;
    const { id } = req.params;

    await session.withTransaction(async () => {
      const debt = await Debt.findOne({ _id: id, tenantId }).session(session);
      if (!debt || debt.isDeleted) throw Object.assign(new Error('Borç bulunamadı.'), { httpStatus: 404 });

      const initialTx = await Transaction.findOne({ 
        relatedId: debt._id, 
        tenantId,
        category: { $in: ['Alacak', 'Borç', 'Borç Verildi', 'Borç Alındı'] }
      }).session(session);

      if (initialTx && !initialTx.isDeleted) {
        // Muhasebe Kuralı: Eğer işlem veresiye (non-cash) ise kasaya iade yapılmaz.
        if (initialTx.method !== 'VERESİYE') {
          const rollbackImpact = initialTx.type === 'INCOME' ? -initialTx.amount : initialTx.amount;
          await Tenant.findByIdAndUpdate(tenantId, { $inc: { currentBalance: rollbackImpact } }, { session });
        }
        initialTx.isDeleted = true;
        await initialTx.save({ session });
      }

      const payments = await Transaction.find({ 
        relatedId: debt._id, 
        tenantId, 
        isDeleted: false,
        category: { $nin: ['Alacak', 'Borç', 'Borç Verildi', 'Borç Alındı'] }
      }).session(session);

      for (const pay of payments) {
        // Ödemeler genellikle nakit/iban olduğu için bunların iadesi yapılır.
        // Ancak yine de kontrol eklemek güvenlidir.
        if (pay.method !== 'VERESİYE') {
          const payRollback = pay.type === 'INCOME' ? -pay.amount : pay.amount;
          await Tenant.findByIdAndUpdate(tenantId, { $inc: { currentBalance: payRollback } }, { session });
        }
        pay.isDeleted = true;
        await pay.save({ session });
      }

      debt.isDeleted = true;
      await debt.save({ session });

      await AuditLog.create([{
        tenantId,
        action: 'DELETE',
        entityType: 'DEBT',
        entityId: debt._id,
        changes: { deletedRecord: debt.toObject() },
      }], { session });
    });

    session.endSession();
    return res.status(200).json({ success: true, message: 'Borç ve ilgili tüm kayıtlar silindi, bakiye düzeltildi.' });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    next(error);
  }
};

module.exports = { createDebt, getDebts, payDebt, updateDebt, deleteDebt };
