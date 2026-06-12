const express = require('express');
const { getDirectory, createEntry, updateEntry, deleteEntry } = require('../controllers/directoryController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { requireSubscription } = require('../middlewares/subscriptionMiddleware');

const router = express.Router();

router.use(requireAuth);
router.use(requireSubscription);

router.get('/', getDirectory);
router.post('/', createEntry);
router.put('/:id', updateEntry);
router.delete('/:id', deleteEntry);

module.exports = router;
