const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Transaction = require('../models/Transaction');
const Debt = require('../models/Debt');
const Directory = require('../models/Directory');
const AuditLog = require('../models/AuditLog');
const { softDeleteMany } = require('../utils/softDelete');

/**
 * Kurulum verilerini günceller (Açılış bakiyesi vb.)
 */
const updateSetup = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { tenantId } = req;
    const { openingBalance, openingDebts, openingReceivables } = req.body;

    const existingTx = await Transaction.findOne({ tenantId, isDeleted: false });
    
    if (existingTx) {
      return res.status(400).json({ 
        success: false, 
        message: 'İşlem kaydı olan hesaplarda başlangıç ayarları değiştirilemez. Lütfen önce işlemleri silin.' 
      });
    }

    const obs = Math.round(Number(openingBalance) || 0);
    const odb = Math.round(Number(openingDebts) || 0);
    const orc = Math.round(Number(openingReceivables) || 0);

    let updatedTenant;
    await session.withTransaction(async () => {
      updatedTenant = await Tenant.findByIdAndUpdate(
        tenantId,
        {
          openingBalance: obs,
          openingDebts: odb,
          openingReceivables: orc,
          currentBalance: obs,
          isSetupComplete: true,
        },
        { new: true, session }
      );

      // Açılış Bakiyesi için Sistem İşlem Kaydı
      if (obs > 0) {
        await Transaction.create([{
          tenantId,
          type: 'INCOME',
          amount: obs,
          currency: 'TRY',
          method: 'CASH',
          category: 'Açılış Bakiyesi',
          description: 'Sistem kurulumunda girilen açılış bakiyesi',
          transactionDate: new Date()
        }], { session });
      }

      // Açılış Borçları için Sistem Kaydı
      if (odb > 0) {
        await Debt.create([{
          tenantId,
          entityName: 'Açılış Borcu (Sistem)',
          type: 'TAKEN',
          totalAmount: odb,
          remainingAmount: odb,
          status: 'PENDING',
          description: 'Sistem kurulumunda girilen açılış borcu',
        }], { session });
      }

      // Açılış Alacakları için Sistem Kaydı
      if (orc > 0) {
        await Debt.create([{
          tenantId,
          entityName: 'Açılış Alacağı (Sistem)',
          type: 'GIVEN',
          totalAmount: orc,
          remainingAmount: orc,
          status: 'PENDING',
          description: 'Sistem kurulumunda girilen açılış alacağı',
        }], { session });
      }
    });

    session.endSession();

    if (!updatedTenant) return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' });

    return res.status(200).json({
      success: true,
      message: 'Kurulum verileri güncellendi.',
      data: {
        openingBalance: updatedTenant.openingBalance,
        openingDebts: updatedTenant.openingDebts,
        openingReceivables: updatedTenant.openingReceivables,
      },
    });
  } catch (err) { 
    session.endSession();
    next(err); 
  }
};

/**
 * Kullanıcıya ait tüm işlemleri, borçları ve rehberi siler, bakiyeyi sıfırlar.
 */
const clearData = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { tenantId } = req;
    await session.withTransaction(async () => {
      await softDeleteMany(Transaction, { tenantId }, { deletedAt: new Date(), deletedBy: tenantId }, { session });
      await softDeleteMany(Debt, { tenantId }, { deletedAt: new Date(), deletedBy: tenantId }, { session });
      await softDeleteMany(Directory, { tenantId }, { deletedAt: new Date(), deletedBy: tenantId }, { session });
      await softDeleteMany(AuditLog, { tenantId }, { deletedAt: new Date(), deletedBy: tenantId }, { session });
      
      await Tenant.findByIdAndUpdate(
        tenantId,
        {
          openingBalance: 0,
          openingDebts: 0,
          openingReceivables: 0,
          currentBalance: 0,
          isSetupComplete: false,
        },
        { session }
      );
    });
    session.endSession();
    return res.status(200).json({ success: true, message: 'Tüm verileriniz başarıyla temizlendi.' });
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    next(err);
  }
};
const updateDeviceToken = async (req, res, next) => {
  try {
    const { tenantId } = req;
    const { deviceToken } = req.body;
    if (!deviceToken) return res.status(400).json({ success: false, message: 'Device token zorunludur.' });

    await Tenant.findByIdAndUpdate(tenantId, { deviceToken });
    return res.status(200).json({ success: true, message: 'Cihaz kimliği güncellendi.' });
  } catch (err) { next(err); }
};

const triggerDueNotifications = async (req, res, next) => {
  try {
    const { tenantId } = req;
    const { checkAndNotifyDueDebts } = require('../services/notificationService');
    
    // Anlık olarak vadesi yaklaşanları kontrol et ve gönder
    await checkAndNotifyDueDebts(tenantId);
    
    return res.status(200).json({ success: true, message: 'Bildirim kontrolü tetiklendi. Vadesi gelen varsa gönderilecektir.' });
  } catch (err) { next(err); }
};

module.exports = { updateSetup, clearData, updateDeviceToken, triggerDueNotifications };
