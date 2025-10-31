import express from "express";
import { fetchAttendance } from "../controllers/attendanceController.js";

const router = express.Router();

router.get("/", fetchAttendance);

export default router;
