// controllers/statsController.js
import { getDashboardStats } from "../services/statsService.js";

export const fetchDashboardStats = async (req, res) => {
  try {
    const stats = await getDashboardStats();

    // SAFE ACCESS + DEFAULTS
    const safe = {
      currentShift: stats.currentShift || "Unknown",
      updatedAt: stats.updatedAt || new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" }),

      totalEmployees: {
        male: stats.totalEmployees?.male ?? 0,
        female: stats.totalEmployees?.female ?? 0,
        total: stats.totalEmployees?.total ?? 0,
        format: stats.totalEmployees?.format ?? (() => "M: 0 | F: 0")
      },

      present: {
        total: stats.present?.total ?? 0,
        onTime: stats.present?.onTime ?? 0,
        late: stats.present?.late ?? 0,
        halfDay: stats.present?.halfDay ?? 0,
        male: stats.present?.male ?? 0,
        female: stats.present?.female ?? 0,
        format: stats.present?.format ?? (() => "On Time: 0 | Late: 0 | Half: 0")
      },

      absent: {
        male: stats.absent?.male ?? 0,
        female: stats.absent?.female ?? 0,
        total: stats.absent?.total ?? 0,
        format: stats.absent?.format ?? (() => "M: 0 | F: 0")
      },

      restDayShift: {
        male: stats.restDayShift?.male ?? 0,
        female: stats.restDayShift?.female ?? 0,
        total: stats.restDayShift?.total ?? 0,
        todayFormatted: stats.restDayShift?.todayFormatted ?? "0 employees on Rest Day today",
        format: stats.restDayShift?.format ?? (() => "M: 0 | F: 0")
      },

      // CORRECT KEY: lateComing (from service)
      lateComing: {
        male: stats.lateComing?.male ?? 0,
        female: stats.lateComing?.female ?? 0,
        total: stats.lateComing?.total ?? 0,
        percentage: stats.lateComing?.percentage ?? "0.0%",
        format: stats.lateComing?.format ?? (() => "M: 0 | F: 0 • 0 Late (0.0%)")
      }
    };

    res.json({ success: true, data: safe });

  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch stats",
      error: error.message
    });
  }
};