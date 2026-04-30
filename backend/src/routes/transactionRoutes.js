const express = require('express');
const { getTransactions, createTransaction } = require('../controllers/transactionController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

// GET  /api/transactions       — paginated, sorted by transactionDate DESC
router.get('/', requireAuth, getTransactions);

// POST /api/transactions       — create a new transaction
router.post('/', requireAuth, createTransaction);

module.exports = router;
