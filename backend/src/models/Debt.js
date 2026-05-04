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
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

// Index for tenant-scoped debt lookups
debtSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model('Debt', debtSchema);
