const express = require('express');
const { getTransactions, createTransaction, updateTransaction, deleteTransaction } = require('../controllers/transactionController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { requireSubscription } = require('../middlewares/subscriptionMiddleware');

const router = express.Router();

// GET  /api/transactions       — paginated, sorted by transactionDate DESC
router.get('/', requireAuth, requireSubscription, getTransactions);

// POST /api/transactions       — create a new transaction
router.post('/', requireAuth, requireSubscription, createTransaction);

// PUT /api/transactions/:id    — update a transaction
router.put('/:id', requireAuth, requireSubscription, updateTransaction);

// DELETE /api/transactions/:id — soft delete a transaction
router.delete('/:id', requireAuth, requireSubscription, deleteTransaction);

module.exports = router;
