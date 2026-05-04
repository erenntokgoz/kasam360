const express = require('express');
const { createDebt, getDebts, payDebt, updateDebt, deleteDebt } = require('../controllers/debtController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

// GET  /api/debts              — paginated, filterable by type & status
router.get('/', requireAuth, getDebts);

// POST /api/debts              — create a new debt record
router.post('/', requireAuth, createDebt);

// POST /api/debts/:id/pay      — record a partial/full payment (ACID)
router.post('/:id/pay', requireAuth, payDebt);

// PUT /api/debts/:id           — update a debt
router.put('/:id', requireAuth, updateDebt);

// DELETE /api/debts/:id        — soft delete a debt
router.delete('/:id', requireAuth, deleteDebt);

module.exports = router;
