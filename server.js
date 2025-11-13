import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

import employeeRoutes from "./routes/employeeRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import shiftAssignmentsRoutes from "./routes/shiftAssignmentsRoutes.js";
import statsRoutes from "./routes/statsRoutes.js";

dotenv.config();
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------------------------------------
// 1. Create upload folders if they don’t exist
// -------------------------------------------------
// const uploadDir = path.join(__dirname, "../uploads/employees");
// await fs.mkdir(uploadDir, { recursive: true });

// -------------------------------------------------
// 2. Middlewares (order matters!)
// -------------------------------------------------
app.use(cors());
app.use(express.json());               // parses JSON bodies
app.use(morgan("dev"));

// Serve uploaded files **before** any API routes
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// -------------------------------------------------
// 3. API routes
// -------------------------------------------------
app.use("/api", employeeRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api", projectRoutes);
app.use("/api/shiftAssignments", shiftAssignmentsRoutes);
app.use("/api/stats", statsRoutes);

// -------------------------------------------------
// 4. Global error handler (prevents HTML pages)
// -------------------------------------------------
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res
    .status(err.status || 500)
    .json({ success: false, message: err.message || "Server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));