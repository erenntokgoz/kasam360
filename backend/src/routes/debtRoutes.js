const express = require('express');
const { createDebt, getDebts, payDebt, updateDebt, deleteDebt } = require('../controllers/debtController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { requireSubscription } = require('../middlewares/subscriptionMiddleware');

const router = express.Router();

// GET  /api/debts              — paginated, filterable by type & status
router.get('/', requireAuth, requireSubscription, getDebts);

// POST /api/debts              — create a new debt record
router.post('/', requireAuth, requireSubscription, createDebt);

// POST /api/debts/:id/pay      — record a partial/full payment (ACID)
router.post('/:id/pay', requireAuth, requireSubscription, payDebt);

// PUT /api/debts/:id           — update a debt
router.put('/:id', requireAuth, requireSubscription, updateDebt);

// DELETE /api/debts/:id        — soft delete a debt
router.delete('/:id', requireAuth, requireSubscription, deleteDebt);

module.exports = router;
