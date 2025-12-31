// utils/attendanceStatus.js
import { supabase } from "../config/db.js";

/**
 * Get minutes since midnight in Colombo time (00:00 = 0, 23:59 = 1439)
 */
export const getColomboMinutes = (timestamp) => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  const str = date.toLocaleString("en-US", {
    timeZone: "Asia/Colombo",
    hour12: false,
    hour: "numeric",
    minute: "numeric",
  });
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Shift A (Morning) — Strict single window
 */
const getShiftAStatus = (minutes) => {
  if (minutes <= 330) return "On time";     // ≤ 05:30
  if (minutes <= 450) return "Late";        // ≤ 07:30
  return "Half day";
};

/**
 * Shift B & C — Dual window (same for all non-exempt employees)
 */
const getDualWindowStatus = (minutes, shift) => {
  if (shift === "B") {
    if (minutes <= 570 || (minutes > 630 && minutes <= 810)) return "On time";
    if (minutes <= 930) return "Late";
    return "Half day";
  }
  if (shift === "C") {
    if (minutes < 1050 || (minutes >= 1110 && minutes <= 1290)) return "On time";
    if (minutes <= 1410) return "Late";
    return "Half day";
  }
  return "On time";
};

/**
 * Main status decider — project-aware and exempt-aware
 */
export const getAttendanceStatus = (timestamp, project, assignedShift) => {
  if (!timestamp) return "-";

  // Exempt projects/roles → N/A
  const exemptProjects = new Set(["CLEANING", "ADMIN", "STL", "TTL", "ASS. TL", "TL"]);
  if (exemptProjects.has((project || "").toString().trim().toUpperCase())) {
    return "N/A";
  }

  const minutes = getColomboMinutes(timestamp);

  // No assigned working shift → not penalized
  if (!assignedShift || !["A", "B", "C"].includes(assignedShift)) {
    return "On time";
  }

  if (assignedShift === "A") {
    return getShiftAStatus(minutes);
  }

  if (assignedShift === "B" || assignedShift === "C") {
    return getDualWindowStatus(minutes, assignedShift);
  }

  return "On time";
};

/**
 * Helper: Fetch project map for list of employee IDs
 */
export const fetchProjectMap = async (employeeIds) => {
  if (!employeeIds || employeeIds.length === 0) return {};

  const ids = employeeIds.map(String);

  const [{ data: regular }, { data: cleaning }] = await Promise.all([
    supabase.from("employees").select("id, project").in("id", ids),
    supabase.from("cleaning_staff").select("id, project").in("id", ids),
  ]);

  const map = {};

  regular?.forEach((e) => {
    map[String(e.id)] = (e.project || "").toString().trim().toUpperCase();
  });

  cleaning?.forEach((s) => {
    map[String(s.id)] = "CLEANING";
  });

  return map;
};