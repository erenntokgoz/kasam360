const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const { requireAuth } = require('../middlewares/authMiddleware');

// All routes are protected by requireAuth
router.use(requireAuth);

router.put('/setup', tenantController.updateSetup);

module.exports = router;
