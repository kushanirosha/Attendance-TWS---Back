import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";
import { createClient } from "@supabase/supabase-js";

import employeeRoutes from "./routes/employeeRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import shiftAssignmentsRoutes from "./routes/shiftAssignmentsRoutes.js";
import statsRoutes from "./routes/statsRoutes.js";
import attendanceStlRoutes from "./routes/attendanceStlRoutes.js";
import attendanceAdminRoutes from "./routes/attendanceAdminRoutes.js";
import attendanceLtlRoutes from "./routes/attendanceLtlRoutes.js";
import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import statsDetailsRoutes from "./routes/statsDetailsRoutes.js";
import activeNowRouter from "./routes/activeNow.js";

import { getDashboardStats } from "./services/statsService.js";
import { getAttendanceLogs } from "./services/attendanceService.js";
import { getCurrentShiftAndDate } from "./utils/getCurrentShift.js"; // ← NEW: Accurate shift detection

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --------------------- HTTP + WebSocket Server ---------------------
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "https://tws.ceyloncreative.online"],
    credentials: true,
  },
});

// --------------------- Supabase Client ---------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --------------------- Track Connected Dashboards ---------------------
const dashboardClients = new Set();

// Keep track of last known shift to detect change
let lastKnownShift = null;

io.on("connection", (socket) => {
  console.log("Dashboard connected:", socket.id);
  dashboardClients.add(socket);

  // Send latest data immediately
  broadcastLatestData();

  socket.on("disconnect", () => {
    console.log("Dashboard disconnected:", socket.id);
    dashboardClients.delete(socket);
  });
});

// --------------------- Smart & Accurate Shift Change Detection ---------------------
setInterval(() => {
  const { currentShift } = getCurrentShiftAndDate();

  if (lastKnownShift && lastKnownShift !== currentShift) {
    console.log(`SHIFT CHANGED → From ${lastKnownShift} to ${currentShift} (Smooth Update)`);
    io.emit("shift-change"); // Just notify frontend — no reload!
    broadcastLatestData();   // Immediately send fresh data
  }

  lastKnownShift = currentShift;
}, 5000); // Check every 5 seconds (safe & smooth)

// --------------------- Broadcast Latest Data ---------------------
async function broadcastLatestData() {
  try {
    const [stats, logs] = await Promise.all([
      getDashboardStats(),
      getAttendanceLogs(),
    ]);

    const payload = {
      stats,
      logs: logs || [],
      updatedAt: new Date().toISOString(),
    };

    dashboardClients.forEach((client) => {
      client.emit("dashboard-update", payload);
    });

    console.log(`Broadcasted to ${dashboardClients.size} dashboard(s) | Shift: ${stats.currentShift}`);
  } catch (err) {
    console.error("Broadcast failed:", err.message);
  }
}

// --------------------- Supabase Realtime: New Check-ins ---------------------
supabase
  .channel("attendance-changes")
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "attendance_logs_check_in",
    },
    () => {
      console.log("New check-in detected → Updating all dashboards");
      broadcastLatestData();
    }
  )
  .subscribe((status) => {
    console.log("Supabase Realtime Status:", status);
  });

// Send initial data on server start
setTimeout(broadcastLatestData, 3000);

// --------------------- Middlewares ---------------------
app.use(
  cors({
    origin: ["http://localhost:5173", "https://tws.ceyloncreative.online"],
    credentials: true,
  })
);
app.use(express.json());
app.use(morgan("dev"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// --------------------- API Routes ---------------------
app.use("/api", employeeRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api", projectRoutes);
app.use("/api/shiftAssignments", shiftAssignmentsRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/attendancestl", attendanceStlRoutes);
app.use("/api/attendanceadmin", attendanceAdminRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/attendance/ltl", attendanceLtlRoutes);
app.use("/api/stats-details", statsDetailsRoutes);
app.use("/api/active-now", activeNowRouter);
app.use("/api/auth", authRoutes);

// --------------------- Error Handler ---------------------
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Server error",
  });
});

// --------------------- Start Server ---------------------
const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`Server + WebSocket running on http://localhost:${PORT}`);
  console.log(`Live Dashboard Ready → Smooth Updates, No Reloads!`);
});