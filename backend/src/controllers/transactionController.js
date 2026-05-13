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

    const baseFilter = { tenantId: tenantObjectId, isDeleted: false };
    
    if (req.query.type && req.query.type !== 'ALL' && ['INCOME', 'EXPENSE'].includes(req.query.type)) baseFilter.type = req.query.type;
    
    if (req.query.startDate || req.query.endDate) {
      baseFilter.transactionDate = {};
      if (req.query.startDate) baseFilter.transactionDate.$gte = new Date(req.query.startDate);
      if (req.query.endDate) baseFilter.transactionDate.$lte = new Date(req.query.endDate);
    }
    
    if (req.query.categories) {
      const cats = req.query.categories.split(',');
      baseFilter.category = { $in: cats };
    }

    const filter = { ...baseFilter };

    // Cursor-based pagination (Base64)
    if (req.query.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(req.query.cursor, 'base64').toString('utf8'));
        if (decoded.date && decoded.id) {
          filter.$or = [
            { transactionDate: { $lt: new Date(decoded.date) } },
            { 
              transactionDate: new Date(decoded.date), 
              _id: { $lt: new mongoose.Types.ObjectId(decoded.id) } 
            }
          ];
        }
      } catch (e) {}
    }

    const [transactions, total, tenant] = await Promise.all([
      Transaction.find(filter).sort({ transactionDate: -1, _id: -1 }).limit(limit).lean(),
      Transaction.countDocuments(baseFilter),
      Tenant.findById(req.tenantId).select('openingBalance currentBalance').lean(),
    ]);

    let nextCursor = null;
    if (transactions.length === limit) {
      const lastTx = transactions[transactions.length - 1];
      nextCursor = Buffer.from(JSON.stringify({
        date: lastTx.transactionDate,
        id: lastTx._id
      })).toString('base64');
    }

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
        pagination: { limit, total, nextCursor },
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
        if (existing) {
          const oldImpact = (existing.method === 'VERESİYE') ? 0 : (existing.type === 'INCOME' ? existing.amount : -existing.amount);
          const newImpact = (method === 'VERESİYE') ? 0 : (type === 'INCOME' ? amountInt : -amountInt);
          if (oldImpact !== newImpact) {
            await Tenant.findByIdAndUpdate(tenantId, { $inc: { currentBalance: newImpact - oldImpact } }, { session });
          }
          existing.type = type;
          existing.amount = amountInt;
          existing.method = method;
          existing.category = category || null;
          existing.description = description || null;
          if (transactionDate) existing.transactionDate = new Date(transactionDate);
          
          let finalDirId = undefined;
          let finalDirType = undefined;
          
          if (relatedId !== undefined) {
            existing.relatedId = relatedId;
            if (relatedType === 'CONTACT' || relatedType === 'STAFF') {
              finalDirId = relatedId;
              finalDirType = relatedType;
            }
          }

          if (!finalDirId && description && (category === 'Personel Gideri' || category === 'İşletme Gideri')) {
            const Directory = require('../models/Directory');
            const match = await Directory.findOne({
              tenantId,
              name: { $regex: new RegExp(`^${description.split(' - ')[0].trim()}$`, 'i') },
              isDeleted: false
            }).session(session);
            if (match) {
              finalDirId = match._id;
              finalDirType = match.roles.includes('STAFF') ? 'STAFF' : 'CONTACT';
            }
          }

          existing.directoryId = finalDirId || existing.directoryId;
          existing.directoryType = finalDirType || existing.directoryType;
          
          await existing.save({ session });
          createdTx = existing; 
          return; 
        }
      }

      let finalDirId = (relatedType === 'CONTACT' || relatedType === 'STAFF') ? relatedId : (req.body.directoryId || null);
      let finalDirType = (relatedType === 'CONTACT' || relatedType === 'STAFF') ? relatedType : (req.body.directoryType || null);

      if (method === 'VERESİYE' && !finalDirId && !description) {
         throw Object.assign(new Error('Veresiye işlemlerde kişi/cari seçimi zorunludur.'), { httpStatus: 400 });
      }

      if (method === 'VERESİYE' && !finalDirId && description) {
         const entityName = description.split(' - ')[0].trim();
         if (!entityName || entityName === 'Kişisel Gider') {
           throw Object.assign(new Error('Veresiye işlemlerde kişi/cari seçimi zorunludur.'), { httpStatus: 400 });
         }
      }

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

      let tenant = await Tenant.findById(tenantId).session(session);

      if (method !== 'VERESİYE') {
        tenant = await Tenant.findByIdAndUpdate(
          tenantId,
          { $inc: { currentBalance: type === 'INCOME' ? amountInt : -amountInt } },
          { new: true, session }
        );
      }

      let finalRelatedId = relatedId;
      let finalRelatedType = relatedType;

      if (method === 'VERESİYE' && (!relatedType || relatedType !== 'DEBT')) {
        const debtType = type === 'EXPENSE' ? 'TAKEN' : 'GIVEN';
        let entityName = description ? description.split(' - ')[0].trim() : (category || 'Veresiye İşlem');
        if (finalDirId) {
          const Directory = require('../models/Directory');
          const dirEntry = await Directory.findById(finalDirId).session(session);
          if (dirEntry) entityName = dirEntry.name;
        }

        const [debt] = await Debt.create([{
          tenantId,
          entityName,
          type: debtType,
          totalAmount: amountInt,
          remainingAmount: amountInt,
          status: 'PENDING',
          description: description || 'Otomatik oluşturulan veresiye',
          relatedId: finalDirId,
          relatedType: finalDirType,
        }], { session });

        finalRelatedId = debt._id;
        finalRelatedType = 'DEBT';
      }

      const [tx] = await Transaction.create([{
        tenantId,
        type,
        amount: amountInt,
        method,
        category: category || null,
        description: description || null,
        transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
        syncId: syncId || undefined,
        relatedId: finalRelatedId,
        relatedType: finalRelatedType,
        directoryId: finalDirId,
        directoryType: finalDirType,
        balanceAfter: tenant ? tenant.currentBalance : 0,
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
          const isInitial = ['Borç Verildi', 'Borç Alındı'].includes(transaction.category);
          if (isInitial) {
            const difference = newAmount - oldAmount;
            debt.totalAmount += difference;
            debt.remainingAmount += difference;
            if (debt.remainingAmount < 0) {
              throw Object.assign(new Error('Güncellenen tutar, daha önce yapılan ödemelerle çelişiyor (Kalan borç eksiye düşemez).'), { httpStatus: 400 });
            }
          } else {
            const calculatedRemaining = (debt.remainingAmount + oldAmount) - newAmount;
            if (calculatedRemaining < 0) {
              throw Object.assign(new Error('Güncellenen tutar borç bakiyesini aşamaz.'), { httpStatus: 400 });
            }
            debt.remainingAmount = calculatedRemaining;
          }
          debt.status = debt.remainingAmount === 0 ? 'PAID' : (debt.remainingAmount >= debt.totalAmount ? 'PENDING' : 'PARTIAL');
          await debt.save({ session });
        }
      }

      const oldImpact = (oldData.method === 'VERESİYE') ? 0 : (oldData.type === 'INCOME' ? oldData.amount : -oldData.amount);
      const newMethod = updateData.method || oldData.method;
      const newImpact = (newMethod === 'VERESİYE') ? 0 : (newType === 'INCOME' ? newAmount : -newAmount);
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

      // Veresiye ise bakiyeye dokunma, nakit/iban ise iade et
      if (transaction.method !== 'VERESİYE') {
        const rollbackImpact = transaction.type === 'INCOME' ? -transaction.amount : transaction.amount;
        await Tenant.findByIdAndUpdate(tenantId, { $inc: { currentBalance: rollbackImpact } }, { session });
      }

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
