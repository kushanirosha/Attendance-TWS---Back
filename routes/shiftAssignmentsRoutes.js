import express from "express";
import {
  fetchShiftAssignments,
  saveShiftAssignments,
} from "../controllers/shiftAssignmentsController.js";

const router = express.Router();

router.get("/:projectId/:monthYear", fetchShiftAssignments);
router.post("/", saveShiftAssignments);

export default router;
