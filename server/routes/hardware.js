const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { openDrawer } = require('../services/hardware');
const router = express.Router();

router.post('/open-drawer', authMiddleware, async (req, res) => {
  try {
    const result = await openDrawer();
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;