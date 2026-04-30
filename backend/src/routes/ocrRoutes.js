const express = require('express');
const { scanReceipt } = require('../controllers/ocrController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

// POST /api/ocr/scan — requires JWT
router.post('/scan', requireAuth, scanReceipt);

module.exports = router;
