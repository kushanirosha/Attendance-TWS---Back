import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";           // ← NEW
import { Server } from "socket.io";             // ← NEW
import { createClient } from "@supabase/supabase-js"; // ← NEW

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

import { getDashboardStats } from "./services/statsService.js";
import { getAttendanceLogs } from "./services/attendanceService.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --------------------- HTTP + WebSocket Server ---------------------
const httpServer = createServer(app);                     // ← Wrap Express
const io = new Server(httpServer, {                       // ← Socket.IO
  cors: {
    origin: ["http://localhost:5173", "https://yourdomain.com"],
    credentials: true
  }
});

// --------------------- Supabase Realtime Client ---------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --------------------- Track Connected Dashboards ---------------------
const dashboardClients = new Set();

io.on("connection", (socket) => {
  console.log("Dashboard connected:", socket.id);
  dashboardClients.add(socket);

  // Send current data immediately
  broadcastLatestData();

  socket.on("disconnect", () => {
    console.log("Dashboard disconnected:", socket.id);
    dashboardClients.delete(socket);
  });
});

// AUTO REFRESH ALL DASHBOARDS AT SHIFT CHANGE (5:30 AM, 1:30 PM, 9:30 PM)
setInterval(() => {
  const now = new Date();
  const colomboTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
  const h = colomboTime.getHours();
  const m = colomboTime.getMinutes();
  const s = colomboTime.getSeconds();

  if ((h === 5 && m === 30 && s < 10) ||
    (h === 13 && m === 30 && s < 10) ||
    (h === 21 && m === 30 && s < 10)) {
    if (dashboardClients.size > 0) {
      console.log(`SHIFT CHANGE → Refreshing ${dashboardClients.size} clients`);
      io.emit("shift-change");
    }
  }
}, 1000);


// --------------------- Broadcast Function ---------------------
async function broadcastLatestData() {
  try {
    const [stats, logs] = await Promise.all([
      getDashboardStats(),
      getAttendanceLogs()
    ]);

    const payload = {
      stats,
      logs,
      updatedAt: new Date().toISOString(),
    };

    // Send to ALL connected dashboards
    dashboardClients.forEach(client => {
      client.emit("dashboard-update", payload);
    });

    console.log(`Broadcasted to ${dashboardClients.size} dashboard(s)`);
  } catch (err) {
    console.error("Broadcast failed:", err.message);
  }
}

// --------------------- Supabase Realtime: Listen to New Check-ins ---------------------
supabase
  .channel("attendance-changes")
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "attendance_logs_check_in",
    },
    (payload) => {
      console.log("New check-in → Updating all dashboards");
      broadcastLatestData();
    }
  )
  .subscribe((status) => {
    console.log("Supabase Realtime:", status);
  });

// Optional: also listen to check-out if you have that table
// .on("postgres_changes", { event: "INSERT", table: "attendance_logs_check_out" }, ...)

// Send data on server start
setTimeout(broadcastLatestData, 2000);

// --------------------- Middlewares ---------------------
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json());
app.use(morgan("dev"));

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// --------------------- API Routes ---------------------
app.use("/api", employeeRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api", projectRoutes);
app.use("/api/shiftAssignments", shiftAssignmentsRoutes);
app.use("/api/stats", statsRoutes);
app.use('/api/attendancestl', attendanceStlRoutes);
app.use('/api/attendanceadmin', attendanceAdminRoutes);
app.use('/api/users', usersRoutes);
app.use("/api/attendance/ltl", attendanceLtlRoutes);
app.use('/api/auth', authRoutes);

// --------------------- Error Handler ---------------------
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Server error"
  });
});

// --------------------- Start Server ---------------------
const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`Server + WebSocket running on http://localhost:${PORT}`);
  console.log(`WebSocket URL: ws://localhost:${PORT}`);
});