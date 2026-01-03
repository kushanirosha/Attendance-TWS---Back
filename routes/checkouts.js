// routes/checkouts.js
import express from 'express';
import { getCheckoutLogs } from '../services/checkoutsService.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const logs = await getCheckoutLogs();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;