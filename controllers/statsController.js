// controllers/statsController.js
import { getDashboardStats } from "../services/statsService.js";

export const fetchDashboardStats = async (req, res) => {
  try {
    const stats = await getDashboardStats();

    res.json({
      success: true,
      data: {
        currentShift: stats.currentShift,
        updatedAt: stats.updatedAt,

        totalEmployees: stats.totalEmployees,
        present: stats.present,
        absent: stats.absent,
        restDayShift: stats.restDayShift,

        // THIS WAS MISSING — ADD THIS BLOCK!
        lateComing: {
          male: stats.lateInCurrentShift.male,
          female: stats.lateInCurrentShift.female,
          total: stats.lateInCurrentShift.count,
          percentage: stats.lateInCurrentShift.percentage,
          format: () => stats.lateInCurrentShift.format(),
        },
      },
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};