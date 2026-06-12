const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Tenant = require('./src/models/Tenant');
const Transaction = require('./src/models/Transaction');

dotenv.config();

const migrateOpeningBalances = async () => {
  try {
    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/kasam360';
    await mongoose.connect(uri);
    console.log('MongoDB connected for migration on', uri);

    // Find tenants with an opening balance > 0
    const tenants = await Tenant.find({ openingBalance: { $gt: 0 } });
    console.log(`Found ${tenants.length} tenants with openingBalance > 0.`);

    let insertedCount = 0;

    for (const tenant of tenants) {
      // Check if an "Açılış Bakiyesi" transaction already exists for this tenant
      const existingTx = await Transaction.findOne({
        tenantId: tenant._id,
        category: 'Açılış Bakiyesi'
      });

      if (!existingTx) {
        // Insert opening balance transaction
        await Transaction.create({
          tenantId: tenant._id,
          type: 'INCOME',
          amount: tenant.openingBalance,
          currency: 'TRY', // default
          method: 'CASH', // default
          category: 'Açılış Bakiyesi',
          description: 'Sistem kurulumunda girilen açılış bakiyesi',
          transactionDate: tenant.createdAt || new Date()
        });
        console.log(`Inserted transaction for tenant ${tenant.businessName || tenant._id}`);
        insertedCount++;
      } else {
        console.log(`Tenant ${tenant.businessName || tenant._id} already has Opening Balance transaction.`);
      }
    }

    console.log(`Migration completed. Inserted ${insertedCount} transactions.`);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

migrateOpeningBalances();
