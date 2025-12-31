// routes/reports.js
import express from "express";
import { getAttendanceReports } from "../services/reportService.js";

const router = express.Router();

/**
 * GET /api/reports
 * Query params:
 *   - employeeIds: comma-separated string, e.g., "1300,1301"
 *   - year: number, e.g., 2025
 *   - month: number (1-12), where 11 = November, 12 = December
 */
router.get("/", async (req, res) => {
  try {
    const { employeeIds, year, month } = req.query;

    if (!employeeIds || !year || month === undefined) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: employeeIds, year, month",
      });
    }

    const empIdArray = employeeIds.split(",").map((id) => id.trim()).filter(Boolean);
    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10);

    if (
      isNaN(yearNum) ||
      isNaN(monthNum) ||
      yearNum < 2000 ||
      yearNum > 2100 ||
      monthNum < 1 ||
      monthNum > 12
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid year or month",
      });
    }

    if (empIdArray.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid employee IDs provided",
      });
    }

    const reports = await getAttendanceReports(empIdArray, yearNum, monthNum);

    // Just forward the response from the service — no extra wrapping!
    res.json(reports);
  } catch (error) {
    console.error("/api/reports error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate reports",
      error: error.message || "Internal server error",
    });
  }
});

export default router;