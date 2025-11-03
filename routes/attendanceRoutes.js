// routes/attendanceRoutes.js
import express from "express";
import { fetchAttendance } from "../controllers/attendanceController.js";

const router = express.Router();

// GET /api/attendance
router.get("/", fetchAttendance);

export default router;
