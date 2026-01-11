// routes/attendancePtsRoutes.js
import { Router } from 'express';
import { getPtsActiveNowCount } from '../services/attendancePtsService.js';

const router = Router();

router.get('/pts-active-now', async (req, res) => {
  try {
    const result = await getPtsActiveNowCount();

    res.json({
      success: true,
      project: 'PTS',
      activeNow: result.total,
      gender: {
        male: result.male,
        female: result.female
      },
      timestamp: new Date().toISOString(),
      message:
        result.total === 0
          ? 'No PTS employee is active right now.'
          : `${result.total} PTS employee(s) are active now (M: ${result.male} | F: ${result.female}).`
    });
  } catch (error) {
    console.error('API /pts-active-now error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch PTS active count',
      details: error.message
    });
  }
});

export default router;