'use strict';

const express = require('express');
const { getDashboard } = require('../controllers/dashboardController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { requireSubscription } = require('../middlewares/subscriptionMiddleware');

const router = express.Router();

// GET /api/dashboard — analitik özet (auth gerekli)
router.get('/', requireAuth, requireSubscription, getDashboard);

module.exports = router;
