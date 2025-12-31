import fetch from "cross-fetch";
globalThis.fetch = fetch;
globalThis.Headers = fetch.Headers;
globalThis.Request = fetch.Request;
globalThis.Response = fetch.Response;

import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";
import { createClient } from "@supabase/supabase-js";

import { getDashboardStats } from "./services/statsService.js";
import { getAttendanceLogs } from "./services/attendanceService.js";
import { getCurrentShiftAndDate } from "./utils/getCurrentShift.js";

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
import reportsRouter from "./routes/reports.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ───────────────────── CRASH PROTECTION (MUST HAVE) ─────────────────────
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION! Server kept alive:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION! Server kept alive:", reason);
});

// ───────────────────── HTTP + SOCKET.IO SERVER ─────────────────────
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST"],
  },
  pingInterval: 10000,    // Server pings client every 10s
  pingTimeout: 5000,      // If no pong in 5s → disconnect
  maxHttpBufferSize: 1e8,
});

// ───────────────────── SUPABASE ─────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ───────────────────── GLOBAL STATE ─────────────────────
const dashboardClients = new Set();
let lastShift = null;

// ───────────────────── MAIN BROADCAST FUNCTION ─────────────────────
async function broadcastDashboard() {
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

    // Send to ALL connected dashboards
    for (const client of dashboardClients) {
      if (client.connected) {
        client.emit("dashboard-update", payload);
      }
    }

    console.log(`Live update sent → ${dashboardClients.size} client(s) | ${stats.currentShift} Shift`);
  } catch (err) {
    console.error("Broadcast failed:", err.message);
  }
}

// ───────────────────── SOCKET CONNECTIONS ─────────────────────
io.on("connection", (socket) => {
  console.log("Dashboard connected:", socket.id);
  dashboardClients.add(socket);

  // Send immediate update
  broadcastDashboard();

  // Optional: client can request manual refresh
  socket.on("request-update", () => {
    console.log("Manual update requested by client");
    broadcastDashboard();
  });

  socket.on("disconnect", (reason) => {
    console.log("Dashboard disconnected:", socket.id, reason);
    dashboardClients.delete(socket);
  });
});

// ───────────────────── SHIFT CHANGE DETECTION (Every 5s) ─────────────────────
setInterval(() => {
  const { currentShift } = getCurrentShiftAndDate();

  if (lastShift && lastShift !== currentShift) {
    console.log(`SHIFT CHANGE DETECTED: ${lastShift} → ${currentShift}`);
    io.emit("shift-change");
    broadcastDashboard();
  }
  lastShift = currentShift;
}, 5000);

// ───────────────────── SUPABASE REALTIME LISTENER ─────────────────────
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
      console.log("New check-in → Live update triggered");
      broadcastDashboard();
    }
  )
  .subscribe((status, err) => {
    console.log("Supabase Realtime:", status, err ? err : "");
  });

// ───────────────────── HEARTBEAT: Keep connection alive (CRITICAL!) ─────────────────────
setInterval(() => {
  broadcastDashboard(); // This runs every 30 seconds → keeps socket alive forever
}, 30000);

// Initial broadcast after 3s
setTimeout(broadcastDashboard, 3000);

// ───────────────────── MIDDLEWARES & ROUTES ─────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(morgan("dev"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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
app.use("/api/reports", reportsRouter);

app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
  res.send("Attendance Dashboard Server Running - Local 24/7 Mode");
});

// ───────────────────── START SERVER ─────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`\n SERVER RUNNING ON http://localhost:${PORT}`);
  console.log(` REAL-TIME DASHBOARD IS NOW 24/7 STABLE ON LOCALHOST`);
  console.log(` Open your frontend and leave it running → It will NEVER die!\n`);
});