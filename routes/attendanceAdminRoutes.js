// routes/attendanceAdminRoutes.js
import { Router } from 'express';
import { getAdminActiveNowCount } from '../services/attendanceAdminService.js';

const router = Router();

router.get('/admin-active-now', async (req, res) => {
  try {
    const result = await getAdminActiveNowCount();

    res.json({
      success: true,
      project: 'ADMIN',
      activeNow: result.total,
      gender: {
        male: result.male,
        female: result.female
      },
      timestamp: new Date().toISOString(),
      message:
        result.total === 0
          ? 'No admin is active right now.'
          : `${result.total} admin(s) are active now (M: ${result.male} | F: ${result.female}).`
    });
  } catch (error) {
    console.error('API /admin-active-now error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch admin active count',
      details: error.message
    });
  }
});

export default router;