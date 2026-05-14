const directoryService = require('../services/directoryService');

const getDirectory = async (req, res, next) => {
  try {
    const { type } = req.query;
    const data = await directoryService.getDirectory(req.tenantId, type);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const createEntry = async (req, res, next) => {
  try {
    const data = await directoryService.createEntry(req.tenantId, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const updateEntry = async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = await directoryService.updateEntry(req.tenantId, id, req.body);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const deleteEntry = async (req, res, next) => {
  try {
    const { id } = req.params;
    await directoryService.deleteEntry(req.tenantId, id);
    res.status(200).json({ success: true, message: 'Kayıt silindi.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getDirectory, createEntry, updateEntry, deleteEntry };
