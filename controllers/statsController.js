// controllers/statsController.js
import { getDashboardStats } from "../services/statsService.js";

export const fetchDashboardStats = async (req, res) => {
  try {
    const stats = await getDashboardStats(); // No param needed
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};