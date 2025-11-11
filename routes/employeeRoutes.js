import express from "express";
import {
  getEmployees,
  getEmployeeById,
  addEmployee,
  updateEmployee,
  deleteEmployee,
  uploadMiddleware,
} from "../controllers/employeesController.js";

const router = express.Router();

router.get("/employees", getEmployees);
router.get("/employees/:id", getEmployeeById);

// **IMPORTANT** – multer must run *before* the handler
router.post("/employees", uploadMiddleware, addEmployee);
router.put("/employees/:id", uploadMiddleware, updateEmployee);
router.delete("/employees/:id", deleteEmployee);

export default router;