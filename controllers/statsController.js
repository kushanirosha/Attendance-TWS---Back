// controllers/statsController.js
import { getDashboardStats } from "../services/statsService.js";

export const fetchDashboardStats = async (req, res) => {
  try {
    const { monthYear } = req.query;
    if (!monthYear) {
      return res.status(400).json({
        success: false,
        message: "monthYear is required (e.g., 2025-11)",
      });
    }

    const stats = await getDashboardStats(monthYear);
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};