// routes/activeNow.js
import express from "express";
import { getActiveNowCount } from "../services/activeNowService.js";

const router = express.Router();

// ←←← CHANGE THIS LINE ONLY ←←←
router.get("/", async (req, res) => {   // ← Use "/" not "/active-now"
  try {
    const result = await getActiveNowCount();
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("Active Now API Error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;