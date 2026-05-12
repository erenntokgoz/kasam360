const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'Tenant ID is required'],
    },
    type: {
      type: String,
      enum: ['INCOME', 'EXPENSE'],
      required: [true, 'Transaction type is required'],
    },
    // Stored in smallest currency unit (cents/kuruş) as Integer to avoid float issues
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: 0,
      get: (v) => Math.round(v),
      set: (v) => Math.round(v),
    },
    method: {
      type: String,
      enum: ['CASH', 'POS', 'IBAN', 'VERESİYE'],
      required: [true, 'Payment method is required'],
    },
    category: {
      type: String,
      trim: true,
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
      sparse: true, // allows multiple null values
    },
    transactionDate: {
      type: Date,
      required: [true, 'Transaction date is required'],
      default: Date.now,
    },
    balanceAfter: {
      type: Number,
      default: 0,
    },
    relatedId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'relatedType',
      default: null,
    },
    relatedType: {
      type: String,
      enum: ['DEBT', 'RECURRING', 'STAFF', 'CONTACT', 'DIRECTORY', null],
      default: null,
    },
    directoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Directory',
      default: null,
    },
    directoryType: {
      type: String,
      enum: ['CONTACT', 'STAFF', null],
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

// Compound index: tenant-scoped date-range queries (most frequent access pattern)
transactionSchema.index({ tenantId: 1, transactionDate: -1 });
// Added index for cursor-based pagination
transactionSchema.index({ tenantId: 1, transactionDate: -1, _id: -1 });

transactionSchema.pre('save', async function (next) {
  if (this.isNew) return next();
  
  // Capture original state for delta updates
  this._original = await mongoose.model('Transaction').findById(this._id).lean();
  next();
});

transactionSchema.post('save', async function (doc) {
  const Tenant = mongoose.model('Tenant');
  const Directory = mongoose.model('Directory');
  const Debt = mongoose.model('Debt');

  const oldImpact = (doc._original && !doc._original.isDeleted && doc._original.method !== 'VERESİYE')
    ? (doc._original.type === 'INCOME' ? doc._original.amount : -doc._original.amount)
    : 0;

  const newImpact = (!doc.isDeleted && doc.method !== 'VERESİYE')
    ? (doc.type === 'INCOME' ? doc.amount : -doc.amount)
    : 0;

  const delta = newImpact - oldImpact;

  // 1. Update Tenant Balance
  if (delta !== 0) {
    const updatedTenant = await Tenant.findByIdAndUpdate(
      doc.tenantId, 
      { $inc: { currentBalance: delta } }, 
      { new: true }
    );
    // Update balanceAfter in a way that doesn't trigger another save loop
    await mongoose.model('Transaction').updateOne({ _id: doc._id }, { balanceAfter: updatedTenant.currentBalance });
  }

  // 2. Handle 'VERESİYE' (Automatic Debt Creation)
  if (!doc.isDeleted && doc.method === 'VERESİYE' && !doc.relatedId) {
    const debtType = doc.type === 'INCOME' ? 'GIVEN' : 'TAKEN';
    const debt = await Debt.create({
      tenantId: doc.tenantId,
      entityName: doc.description || 'Veresiye İşlem',
      type: debtType,
      totalAmount: doc.amount,
      remainingAmount: doc.amount,
      relatedId: doc.directoryId,
      relatedType: doc.directoryType || 'CONTACT',
    });
    
    await mongoose.model('Transaction').updateOne(
      { _id: doc._id }, 
      { relatedId: debt._id, relatedType: 'DEBT' }
    );
  }

  // 3. Handle Debt Payments
  if (!doc.isDeleted && doc.relatedType === 'DEBT' && doc.relatedId && doc.method !== 'VERESİYE') {
    const debt = await Debt.findOne({ _id: doc.relatedId, isDeleted: false });
    if (debt) {
      const oldPaid = (doc._original && !doc._original.isDeleted && doc._original.relatedId?.toString() === doc.relatedId.toString()) 
        ? doc._original.amount 
        : 0;
      const newPaid = doc.amount;
      const debtDelta = newPaid - oldPaid;

      if (debtDelta !== 0) {
        debt.remainingAmount = Math.max(0, debt.remainingAmount - debtDelta);
        debt.status = debt.remainingAmount === 0 ? 'PAID' : (debt.remainingAmount >= debt.totalAmount ? 'PENDING' : 'PARTIAL');
        await debt.save();
      }
    }
  }

  // 4. Update Directory Static Balances
  if (doc.directoryId) {
    const oldDirPaid = (doc._original && !doc._original.isDeleted && doc._original.type === 'EXPENSE' && doc._original.directoryId?.toString() === doc.directoryId.toString())
      ? doc._original.amount
      : 0;
    const newDirPaid = (!doc.isDeleted && doc.type === 'EXPENSE') ? doc.amount : 0;
    const dirDelta = newDirPaid - oldDirPaid;

    if (dirDelta !== 0) {
      await Directory.findByIdAndUpdate(doc.directoryId, { $inc: { totalPaid: dirDelta } });
    }
  }

  // 5. Historical Balance Recalculation
  // If transactionDate changed or it's a new transaction with old date
  const isHistorical = doc._original && (doc._original.transactionDate.toISOString() !== doc.transactionDate.toISOString());
  if (isHistorical || doc.isNew) {
    await mongoose.model('Transaction').recalculateLedger(doc.tenantId, doc.transactionDate);
  }
});

/**
 * Sequentially recalculates balanceAfter for all transactions of a tenant starting from a date.
 */
transactionSchema.statics.recalculateLedger = async function (tenantId, startDate) {
  const Transaction = this;
  const Tenant = mongoose.model('Tenant');

  // Find the previous transaction to get the starting balance
  const lastTx = await Transaction.findOne({
    tenantId,
    isDeleted: false,
    transactionDate: { $lt: startDate }
  }).sort({ transactionDate: -1, _id: -1 }).lean();

  let currentBalance = 0;
  if (lastTx) {
    currentBalance = lastTx.balanceAfter;
  } else {
    const tenant = await Tenant.findById(tenantId).select('openingBalance').lean();
    currentBalance = tenant?.openingBalance || 0;
  }

  // Fetch all subsequent transactions
  const subsequentTxs = await Transaction.find({
    tenantId,
    isDeleted: false,
    transactionDate: { $gte: startDate }
  }).sort({ transactionDate: 1, _id: 1 });

  for (const tx of subsequentTxs) {
    if (tx.method !== 'VERESİYE') {
      currentBalance += (tx.type === 'INCOME' ? tx.amount : -tx.amount);
    }
    // Update balanceAfter without triggering hooks again
    await Transaction.updateOne({ _id: tx._id }, { balanceAfter: Math.round(currentBalance) });
  }

  // Update Tenant's actual current balance
  await Tenant.findByIdAndUpdate(tenantId, { currentBalance: Math.round(currentBalance) });
};

module.exports = mongoose.model('Transaction', transactionSchema);
