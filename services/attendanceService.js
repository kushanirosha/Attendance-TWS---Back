// utils/attendance.js
import { supabase } from "../config/db.js";

// BULLETPROOF: Get minutes since midnight in Colombo time
const getColomboMinutes = (timestamp) => {
  const date = new Date(timestamp);
  const colomboStr = date.toLocaleString("en-US", {
    timeZone: "Asia/Colombo",
    hour12: false,
    hour: "numeric",
    minute: "numeric",
  });
  const [h, m] = colomboStr.split(":").map(Number);
  return h * 60 + m;
};

// SHIFT A — Strict single window (05:30 start, grace till 07:30)
const getShiftAStatus = (minutes) => {
  if (minutes <= 330) return "On time";     // Before 05:30
  if (minutes <= 450) return "Late";        // 05:30 – 07:30
  return "Half day";                        // After 07:30
};

// SHIFT B & C — DUAL WINDOW RULES (Applies to TL + Regular)
const getDualWindowStatus = (minutes, assignedShift) => {
  if (assignedShift === "B") {
    // B Shift: 09:30 start + 13:30 grace after break
    if (minutes <= 570) return "On time";      // Before 09:30 → On time
    if (minutes <= 630) return "Late";         // 09:30 – 10:30 → Late
    if (minutes <= 810) return "On time";      // 10:30 – 13:30 → On time (after lunch)
    if (minutes <= 930) return "Late";         // 13:30 – 15:30 → Late
    return "Half day";                         // After 15:30 → Half day
  }

  if (assignedShift === "C") {
    // C Shift: 21:30 start + early arrival from 16:00
    if (minutes < 1050) return "On time";      // Before 17:30 (including 16:00–17:30 early) → On time
    if (minutes <= 1110) return "Late";        // 17:30 – 18:30 → Late
    if (minutes <= 1290) return "On time";     // 18:30 – 21:30 → On time (main window)
    if (minutes <= 1410) return "Late";        // 21:30 – 23:30 → Late
    return "Half day";                         // After 23:30 → Half day
  }

  return "On time";
};

// MAIN STATUS DECIDER — FINAL VERSION (Assigned shift first!)
const getStatus = (timestamp, empId, assignedShift) => {
  // Exempt: Cleaning, Special IDs, Admin, PTS
  if (isCleaningStaff.has(empId) || isSpecialExempt.has(empId)) return "N/A";
  if (["ADMIN", "PTS"].includes(projectMap[empId] || "")) return "N/A";

  const minutes = getColomboMinutes(timestamp);

  // PRIORITY 1: No shift today (OFF, RD, W5, HOB, etc.) → Not penalized
  if (!assignedShift || !["A", "B", "C"].includes(assignedShift)) {
    return "On time";
  }

  // PRIORITY 2: Assigned to Shift A → Strict rules
  if (assignedShift === "A") {
    return getShiftAStatus(minutes);
  }

  // PRIORITY 3: Assigned to Shift B or C → Dual window rules (for ALL employees)
  if (assignedShift === "B" || assignedShift === "C") {
    return getDualWindowStatus(minutes, assignedShift);
  }

  return "On time";
};

// Global variables (will be populated inside function)
let isCleaningStaff, isSpecialExempt, nameMap, projectMap, todayShiftMap;

export async function getAttendanceLogs() {
  const { data: logs, error: logError } = await supabase
    .from("attendance_logs_check_in")
    .select("id, employee_id, employee_name, timestamp")
    .order("timestamp", { ascending: false });

  if (logError) throw new Error(logError.message);
  if (!logs || logs.length === 0) return [];

  // BULLETPROOF DATE — ALWAYS USE SRI LANKA TIME
  const colomboNow = new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" });
  const today = new Date(colomboNow);

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = today.getDate();
  const monthYear = `${year}-${month}`;

  // 1. Load today's shift assignments
  const { data: shiftRows } = await supabase
    .from("shift_assignments")
    .select("assignments")
    .eq("month_year", monthYear);

  todayShiftMap = {};

  shiftRows?.forEach((row) => {
    const assignments = row.assignments || {};
    Object.entries(assignments).forEach(([empId, dates]) => {
      const shift = dates?.[dayOfMonth.toString()];
      if (shift === "A" || shift === "B" || shift === "C") {
        todayShiftMap[empId] = shift;
      }
      // "RD", "OFF", "W5", "HOB" → ignored = no shift = "On time"
    });
  });

  // 2. Get unique employee IDs
  const employeeIds = [...new Set(logs.map((l) => l.employee_id))];

  // 3. Fetch employee details
  const [{ data: regularEmployees }, { data: cleaningStaff }] = await Promise.all([
    supabase.from("employees").select("id, name, project").in("id", employeeIds),
    supabase.from("cleaning_staff").select("id, name, project").in("id", employeeIds),
  ]);

  // Master maps
  nameMap = {};
  projectMap = {};
  isCleaningStaff = new Set();
  isSpecialExempt = new Set(["1007"]); // Add more exempt IDs here

  regularEmployees?.forEach((emp) => {
    nameMap[emp.id] = emp.name || "Unknown";
    projectMap[emp.id] = (emp.project || "").toString().trim().toUpperCase();
  });

  cleaningStaff?.forEach((staff) => {
    nameMap[staff.id] = staff.name || "Unknown";
    projectMap[staff.id] = "JANITOR";
    isCleaningStaff.add(staff.id);
  });

  // 4. Get latest check-in per employee
  const latestCheckIn = {};
  for (const log of logs) {
    const current = latestCheckIn[log.employee_id];
    if (!current || new Date(log.timestamp) > new Date(current.timestamp)) {
      latestCheckIn[log.employee_id] = log;
    }
  }

    // === HIDE SENSITIVE PROJECT NAMES (e.g., ADMIN → ER) ===
  const HIDDEN_PROJECT_EMPLOYEES = new Set(["1001", "1283"]); // Add more IDs if needed
  const projectDisplayOverride = (empId, originalProject) => {
    if (HIDDEN_PROJECT_EMPLOYEES.has(empId)) {
      return "ER"; // Always show "ER" for these IDs, no matter what project they have
    }
    return originalProject;
  };

  // 5. Final Output — With perfect status logic + project name masking
  return Object.values(latestCheckIn).map((log) => {
    const empId = log.employee_id;
    const assignedShift = todayShiftMap[empId];

    const originalProject = projectMap[empId] || "UNKNOWN";
    const displayProject = projectDisplayOverride(empId, originalProject);

    return {
      id: empId,
      name: nameMap[empId] || log.employee_name || "Unknown",
      project: displayProject, // ← This will show "ER" instead of "ADMIN" for 1001 & 1283
      checkInTime: new Date(log.timestamp).toLocaleString("en-US", {
        timeZone: "Asia/Colombo",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      timestamp: log.timestamp,
      status: getStatus(log.timestamp, empId, assignedShift),
    };
  });
}