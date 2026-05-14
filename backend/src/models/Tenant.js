const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false, // never returned in queries by default
    },
    businessName: {
      type: String,
      required: [true, 'Business name is required'],
      trim: true,
    },
    openingBalance: {
      type: Number,
      default: 0,
    },
    openingDebts: {
      type: Number,
      default: 0,
    },
    openingReceivables: {
      type: Number,
      default: 0,
    },
    currentBalance: {
      type: Number,
      default: 0,
    },
    subscriptionStatus: {
      type: String,
      enum: ['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED'],
      default: 'TRIAL',
    },
    isSetupComplete: {
      type: Boolean,
      default: false,
    },
    deviceToken: {
      type: String,
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
    timestamps: true, // adds createdAt + updatedAt automatically
  }
);

module.exports = mongoose.model('Tenant', tenantSchema);
