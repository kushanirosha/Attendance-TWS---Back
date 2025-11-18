// routes/attendanceLtlRoutes.js
import express from "express";
import { getLtlActiveNowCount } from "../services/attendanceLtlService.js";

const router = express.Router();

// ROOT ENDPOINT — this will fix your 404
router.get("/", async (req, res) => {
  try {
    const result = await getLtlActiveNowCount();

    res.json({
      success: true,
      message: "LTL (ASS.TL / TL / TTL) Attendance API",
      endpoints: {
        activeNow: "/api/attendance/ltl/active-now",
        test: "/api/attendance/ltl/test",
        thisPage: "/api/attendance/ltl"
      },
      currentActive: {
        total: result.total,
        male: result.male,
        female: result.female,
        updatedAt: new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" })
      },
      tip: "Use /active-now for real-time count"
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "LTL service temporarily unavailable",
      error: err.message
    });
  }
});

// Existing routes
router.get("/active-now", async (req, res) => {
  try {
    const result = await getLtlActiveNowCount();
    res.status(200).json({
      success: true,
      data: {
        total: result.total,
        male: result.male,
        female: result.female,
        label: "LTL (Leadership Team)",
        updatedAt: new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" }),
      },
      message: "LTL active count fetched successfully",
    });
  } catch (error) {
    console.error("LTL Active Now API Error:", error.message);
    res.status(500).json({
      success: false,
      data: { total: 0, male: 0, female: 0 },
      message: "Failed to fetch LTL active count",
    });
  }
});

router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "LTL Attendance API is working!",
    time: new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" }),
  });
});

export default router;