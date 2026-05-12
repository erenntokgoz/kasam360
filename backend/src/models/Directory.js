const mongoose = require('mongoose');

const directorySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
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
  },
  { timestamps: true }
);

// Aynı tenant altında aynı isimde tek bir aktif kişi olabilir (Unified Directory)
directorySchema.index({ tenantId: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

module.exports = mongoose.model('Directory', directorySchema);
