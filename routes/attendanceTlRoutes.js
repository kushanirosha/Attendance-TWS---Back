// routes/attendanceTlRoutes.js
import express from "express";
import { getTlActiveNowCount } from "../services/attendanceTlService.js";

const router = express.Router();

// ROOT ENDPOINT — this will fix your 404
router.get("/", async (req, res) => {
  try {
    const result = await getTlActiveNowCount();

    res.json({
      success: true,
      message: "TL (ASS.TL / TL / TTL) Attendance API",
      endpoints: {
        activeNow: "/api/attendance/tl/active-now",
        test: "/api/attendance/tl/test",
        thisPage: "/api/attendance/tl"
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
      message: "TL service temporarily unavailable",
      error: err.message
    });
  }
});

// Existing routes
router.get("/active-now", async (req, res) => {
  try {
    const result = await getTlActiveNowCount();
    res.status(200).json({
      success: true,
      data: {
        total: result.total,
        male: result.male,
        female: result.female,
        label: "TL (Leadership Team)",
        updatedAt: new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" }),
      },
      message: "TL active count fetched successfully",
    });
  } catch (error) {
    console.error("TL Active Now API Error:", error.message);
    res.status(500).json({
      success: false,
      data: { total: 0, male: 0, female: 0 },
      message: "Failed to fetch TL active count",
    });
  }
});

router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "TL Attendance API is working!",
    time: new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" }),
  });
});

export default router;