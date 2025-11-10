import express from "express";
import { fetchDashboardStats } from "../controllers/statsController.js";

const router = express.Router();

router.get("/", fetchDashboardStats); // GET /api/stats?monthYear=2025-11

export default router;