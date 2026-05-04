const express = require('express');
const { getTransactions, createTransaction, updateTransaction, deleteTransaction } = require('../controllers/transactionController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

// GET  /api/transactions       — paginated, sorted by transactionDate DESC
router.get('/', requireAuth, getTransactions);

// POST /api/transactions       — create a new transaction
router.post('/', requireAuth, createTransaction);

// PUT /api/transactions/:id    — update a transaction
router.put('/:id', requireAuth, updateTransaction);

// DELETE /api/transactions/:id — soft delete a transaction
router.delete('/:id', requireAuth, deleteTransaction);

module.exports = router;
