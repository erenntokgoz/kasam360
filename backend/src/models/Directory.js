const mongoose = require('mongoose');

const directorySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    customerCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    name: {
      type: String,
      required: true,
    },
    roles: {
      type: [String],
      enum: ['CONTACT', 'STAFF'],
      default: ['CONTACT'],
    },
    role: {
      type: String, // İş ünvanı (Yalnızca STAFF için eklenebilir)
    },
    lastTransactionDate: {
      type: Date,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    // Static balance fields for performance optimization
    totalPaid: {
      type: Number,
      default: 0,
      get: (v) => Math.round(v),
      set: (v) => Math.round(v),
    },
    totalDebt: {
      type: Number,
      default: 0,
      get: (v) => Math.round(v),
      set: (v) => Math.round(v),
    },
    totalReceivable: {
      type: Number,
      default: 0,
      get: (v) => Math.round(v),
      set: (v) => Math.round(v),
    },
    balance: {
      type: Number,
      default: 0,
      get: (v) => Math.round(v),
      set: (v) => Math.round(v),
    },
  },
  { timestamps: true }
);

// Collation for case-insensitive name uniqueness and sorting
directorySchema.index(
  { tenantId: 1, name: 1 },
  { 
    unique: true, 
    partialFilterExpression: { isDeleted: false },
    collation: { locale: 'tr', strength: 2 } 
  }
);

directorySchema.pre('save', async function (next) {
  if (!this.isNew || this.customerCode) return next();

  try {
    const lastEntry = await mongoose.model('Directory')
      .findOne({ tenantId: this.tenantId })
      .sort({ customerCode: -1 })
      .select('customerCode')
      .lean();

    let nextNum = 1;
    if (lastEntry && lastEntry.customerCode && lastEntry.customerCode.startsWith('CARI-')) {
      const lastNum = parseInt(lastEntry.customerCode.split('-')[1], 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }

    this.customerCode = `CARI-${String(nextNum).padStart(4, '0')}`;
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model('Directory', directorySchema);
