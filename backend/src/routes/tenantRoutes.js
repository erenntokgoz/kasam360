const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const authMiddleware = require('../middlewares/authMiddleware');

// All routes are protected by authMiddleware
router.use(authMiddleware);

router.put('/setup', tenantController.updateSetup);

module.exports = router;
