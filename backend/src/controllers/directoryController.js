const Directory = require('../models/Directory');

// GET /api/directory?type=CONTACT|STAFF
const getDirectory = async (req, res) => {
  try {
    const { type } = req.query;
    const filter = { tenantId: req.tenantId };
    if (type) {
      filter.type = type;
    }
    const list = await Directory.find(filter).sort({ name: 1 });
    return res.status(200).json({ success: true, data: list });
  } catch (error) {
    console.error('[directoryController.getDirectory]', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// POST /api/directory
const createEntry = async (req, res) => {
  try {
    const { name, type, role, totalPaid, totalBalance, lastTransactionDate } = req.body;
    if (!name || !type) {
      return res.status(400).json({ success: false, message: 'Name and type are required' });
    }

    const newEntry = await Directory.create({
      tenantId: req.tenantId,
      name: name.trim(),
      type,
      role,
      totalPaid: totalPaid || 0,
      totalBalance: totalBalance || 0,
      lastTransactionDate
    });

    return res.status(201).json({ success: true, data: newEntry });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Bu isimde bir kayıt zaten mevcut.' });
    }
    console.error('[directoryController.createEntry]', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// PUT /api/directory/:id
const updateEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Prevent updating tenantId
    delete updates.tenantId;
    const ALLOWED_FIELDS = ['name', 'role', 'totalPaid', 'totalBalance', 'lastTransactionDate'];
    const safeUpdate = {};
    for (const field of ALLOWED_FIELDS) {
      if (updates[field] !== undefined) safeUpdate[field] = updates[field];
    }

    const entry = await Directory.findOneAndUpdate(
      { _id: id, tenantId: req.tenantId },
      { $set: safeUpdate },
      { new: true }
    );

    if (!entry) {
      return res.status(404).json({ success: false, message: 'Kayıt bulunamadı' });
    }

    return res.status(200).json({ success: true, data: entry });
  } catch (error) {
    console.error('[directoryController.updateEntry]', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// DELETE /api/directory/:id
const deleteEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await Directory.findOneAndDelete({ _id: id, tenantId: req.tenantId });
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Kayıt bulunamadı' });
    }
    return res.status(200).json({ success: true, message: 'Kayıt silindi' });
  } catch (error) {
    console.error('[directoryController.deleteEntry]', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

module.exports = { getDirectory, createEntry, updateEntry, deleteEntry };
