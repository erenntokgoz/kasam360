const mongoose = require('mongoose');

const debtSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'Tenant ID is required'],
    },
    entityName: {
      type: String,
      required: [true, 'Entity name (person/company) is required'],
      trim: true,
    },
    type: {
      type: String,
      enum: ['GIVEN', 'TAKEN'],
      required: [true, 'Debt type is required'],
    },
    // All monetary values stored in smallest currency unit (cents/kuruş)
    totalAmount: {
      type: Number,
      required: [true, 'Total amount is required'],
      min: 0,
      get: (v) => Math.round(v),
      set: (v) => Math.round(v),
    },
    remainingAmount: {
      type: Number,
      required: [true, 'Remaining amount is required'],
      min: 0,
      get: (v) => Math.round(v),
      set: (v) => Math.round(v),
    },
    status: {
      type: String,
      enum: ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'],
      default: 'PENDING',
    },
    dueDate: {
      type: Date,
      default: null,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    // Unique identifier from the mobile client for offline-sync deduplication
    syncId: {
      type: String,
      unique: true,
      sparse: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    relatedId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Directory',
      default: null,
    },
    relatedType: {
      type: String,
      enum: ['CONTACT', 'STAFF'],
      default: 'CONTACT',
    },
    lastNotifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

// Index for tenant-scoped debt lookups
debtSchema.index({ tenantId: 1, status: 1 });

/**
 * Middleware to sync Directory balances
 */
const syncDirectoryBalance = async (doc) => {
  if (!doc.relatedId) return;
  const Debt = mongoose.model('Debt');
  const Directory = mongoose.model('Directory');

  const balances = await Debt.aggregate([
    { $match: { relatedId: doc.relatedId, isDeleted: false } },
    { $group: {
      _id: '$type',
      total: { $sum: '$remainingAmount' }
    }}
  ]);

  let totalReceivable = 0;
  let totalDebt = 0;

  balances.forEach(b => {
    if (b._id === 'GIVEN') totalReceivable = b.total;
    if (b._id === 'TAKEN') totalDebt = b.total;
  });

  await Directory.findByIdAndUpdate(doc.relatedId, {
    totalReceivable,
    totalDebt,
    balance: totalReceivable - totalDebt
  });
};

debtSchema.pre('save', async function (next) {
  if (this.isNew) return next();
  this._oldRemaining = (await mongoose.model('Debt').findById(this._id).select('remainingAmount').lean())?.remainingAmount;
  next();
});

debtSchema.post('save', async function (doc) {
  await syncDirectoryBalance(doc);

  const Transaction = mongoose.model('Transaction');

  // 1. Double-entry logic: If remainingAmount decreased, create a Transaction if not already exists
  if (this._oldRemaining !== undefined && doc.remainingAmount < this._oldRemaining) {
    const paidAmount = this._oldRemaining - doc.remainingAmount;

    // Check if this payment was already recorded by a Transaction hook to avoid loops
    const existingTx = await Transaction.findOne({
      relatedId: doc._id,
      amount: paidAmount,
      createdAt: { $gte: new Date(Date.now() - 2000) }
    });

    if (!existingTx) {
      const txType = doc.type === 'GIVEN' ? 'INCOME' : 'EXPENSE';
      await Transaction.create({
        tenantId: doc.tenantId,
        type: txType,
        amount: paidAmount,
        method: 'CASH', // Default to CASH for automatic entries
        category: doc.type === 'GIVEN' ? 'Alacak Tahsili' : 'Borç Ödemesi',
        description: `Otomatik Ödeme Kaydı: ${doc.entityName}`,
        transactionDate: new Date(),
        relatedId: doc._id,
        relatedType: 'DEBT',
        directoryId: doc.relatedId,
        directoryType: doc.relatedType
      });
    }
  }

  // 2. Double-entry logic: Initial debt recognition
  if (this.isNew) {
    const existingTx = await Transaction.findOne({ relatedId: doc._id });
    if (!existingTx) {
      const txType = doc.type === 'GIVEN' ? 'EXPENSE' : 'INCOME';
      await Transaction.create({
        tenantId: doc.tenantId,
        type: txType,
        amount: doc.totalAmount,
        method: 'VERESİYE',
        category: doc.type === 'GIVEN' ? 'Alacak Kaydı' : 'Borç Kaydı',
        description: `Otomatik Veresiye Kaydı: ${doc.entityName}`,
        transactionDate: doc.createdAt || new Date(),
        relatedId: doc._id,
        relatedType: 'DEBT',
        directoryId: doc.relatedId,
        directoryType: doc.relatedType
      });
    }
  }
});

module.exports = mongoose.model('Debt', debtSchema);
