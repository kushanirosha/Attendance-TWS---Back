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
import { getCheckoutLogs } from "./services/checkoutsService.js";
import { getCurrentShiftAndDate } from "./utils/getCurrentShift.js";

import employeeRoutes from "./routes/employeeRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import shiftAssignmentsRoutes from "./routes/shiftAssignmentsRoutes.js";
import statsRoutes from "./routes/statsRoutes.js";
import attendancePtsRoutes from "./routes/attendancePtsRoutes.js";
import attendanceAdminRoutes from "./routes/attendanceAdminRoutes.js";
import attendanceTlRoutes from "./routes/attendanceTlRoutes.js";
import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import statsDetailsRoutes from "./routes/statsDetailsRoutes.js";
import activeNowRouter from "./routes/activeNow.js";
import reportsRouter from "./routes/reports.js";
import checkoutsRouter from "./routes/checkouts.js";
import othersRouter from "./routes/others.js"

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
    origin: ["http://localhost:5173", "https://tws.ceyloncreative.online"],
    methods: ["GET", "POST"],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
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

// ───────────────────── MAIN BROADCAST FUNCTION (NOW WITH CHECK-OUTS) ─────────────────────
async function broadcastDashboard() {
  try {
    const [stats, checkInLogs, checkOutLogs] = await Promise.all([
      getDashboardStats(),
      getAttendanceLogs(),
      getCheckoutLogs(), // ← Fetch latest check-outs
    ]);

    // Combine both types of logs with event type
    const combinedLogs = [
      ...(checkInLogs || []).map(log => ({ ...log, event: "Check_In" })),
      ...(checkOutLogs || []).map(log => ({ ...log, event: "Check_Out" }))
    ];

    // Sort by timestamp: newest first
    combinedLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const payload = {
      stats,
      logs: combinedLogs,
      updatedAt: new Date().toISOString(),
    };

    // Broadcast to all connected dashboard clients
    for (const client of dashboardClients) {
      if (client.connected) {
        client.emit("dashboard-update", payload);
      }
    }

    console.log(`Live update sent → ${dashboardClients.size} client(s) | ${stats.currentShift} Shift | ${combinedLogs.length} total activities`);
  } catch (err) {
    console.error("Broadcast failed:", err.message);
  }
}

// ───────────────────── SOCKET CONNECTIONS ─────────────────────
io.on("connection", (socket) => {
  console.log("Dashboard connected:", socket.id);
  dashboardClients.add(socket);

  // Send immediate update on connect
  broadcastDashboard();

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

// ───────────────────── SUPABASE REALTIME LISTENERS ─────────────────────

// Listen for new Check-Ins
supabase
  .channel("attendance-checkin-changes")
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "attendance_logs_check_in",
    },
    (payload) => {
      console.log("New CHECK-IN detected → Triggering live update");
      broadcastDashboard();
    }
  )
  .subscribe();

// Listen for new Check-Outs
supabase
  .channel("attendance-checkout-changes")
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "attendance_logs_check_out",
    },
    (payload) => {
      console.log("New CHECK-OUT detected → Triggering live update");
      broadcastDashboard();
    }
  )
  .subscribe();

// ───────────────────── HEARTBEAT: Keep connection alive forever ─────────────────────
setInterval(() => {
  broadcastDashboard(); // Every 30 seconds → prevents disconnects
}, 30000);

// Initial broadcast after server starts
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
app.use("/api/attendancepts", attendancePtsRoutes);
app.use("/api/attendanceadmin", attendanceAdminRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/attendance/tl", attendanceTlRoutes);
app.use("/api/stats-details", statsDetailsRoutes);
app.use("/api/active-now", activeNowRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/checkouts", checkoutsRouter);
app.use('/api/others', othersRouter);

app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
  res.send("Attendance Dashboard Server Running - Local 24/7 Mode");
});

// ───────────────────── START SERVER ─────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`\n SERVER RUNNING ON http://localhost:${PORT}`);
  console.log(` REAL-TIME DASHBOARD NOW SHOWS CHECK-INS + CHECK-OUTS LIVE`);
  console.log(` Open frontend → You will see mixed activities in real time!\n`);
});