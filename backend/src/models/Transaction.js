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
    currency: {
      type: String,
      enum: ['TRY', 'USD', 'EUR', 'GBP'],
      default: 'TRY',
    },
    exchangeRate: {
      type: Number,
      default: 1,
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
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
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

module.exports = mongoose.model('Transaction', transactionSchema);
