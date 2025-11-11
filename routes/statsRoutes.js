// routes/statsRoutes.js
import express from "express";
import { fetchDashboardStats } from "../controllers/statsController.js";

const router = express.Router();

// GET /api/stats  → returns current shift stats automatically
router.get("/", fetchDashboardStats);

export default router;