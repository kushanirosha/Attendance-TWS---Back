// routes/attendanceStlRoutes.js
import { Router } from 'express';
import { getStlActiveNowCount } from '../services/attendanceStlService.js';

const router = Router();

router.get('/stl-active-now', async (req, res) => {
  try {
    const result = await getStlActiveNowCount();

    res.json({
      success: true,
      project: 'STL',
      activeNow: result.total,
      gender: {
        male: result.male,
        female: result.female
      },
      timestamp: new Date().toISOString(),
      message:
        result.total === 0
          ? 'No STL employee is active right now.'
          : `${result.total} STL employee(s) are active now (M: ${result.male} | F: ${result.female}).`
    });
  } catch (error) {
    console.error('API /stl-active-now error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch STL active count',
      details: error.message
    });
  }
});

export default router;