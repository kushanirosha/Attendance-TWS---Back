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

export async function getAttendanceLogs() {
  const { data: logs, error: logError } = await supabase
    .from("attendance_logs_check_in")
    .select("id, employee_id, employee_name, timestamp")
    .order("timestamp", { ascending: false });

  if (logError) throw new Error(logError.message);
  if (!logs || logs.length === 0) return [];

  // BULLETPROOF DATE — ALWAYS USE SRI LANKA TIME, NEVER SERVER TIME
  const colomboNow = new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" });
  const today = new Date(colomboNow);

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = today.getDate();
  const monthYear = `${year}-${month}`;

  // 1. Load today's shift assignments (only from correct Colombo date)
  const { data: shiftRows } = await supabase
    .from("shift_assignments")
    .select("assignments")
    .eq("month_year", monthYear);

  const todayShiftMap = {};

  shiftRows?.forEach((row) => {
    const assignments = row.assignments || {};
    Object.entries(assignments).forEach(([empId, dates]) => {
      const shift = dates?.[dayOfMonth.toString()];
      // ONLY ACCEPT REAL SHIFTS: A, B, C — ignore "HOB", "ATAS", "W5", etc.
      if (shift === "A" || shift === "B" || shift === "C") {
        todayShiftMap[empId] = shift;
      }
      // "RD" or any garbage → ignored = treated as no shift = "On time"
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
  const nameMap = {};
  const projectMap = {};
  const isCleaningStaff = new Set();
  const isSpecialExempt = new Set(["1007"]);

  regularEmployees?.forEach((emp) => {
    nameMap[emp.id] = emp.name || "Unknown";
    projectMap[emp.id] = (emp.project || "").toString().trim().toUpperCase();
  });

  cleaningStaff?.forEach((staff) => {
    nameMap[staff.id] = staff.name || "Unknown";
    projectMap[staff.id] = "CLEANING";
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

  // 5. TL / ASS.TL / TTL Status
  const getTLStatus = (minutes, shift) => {
    if (shift === "A") return minutes <= 330 ? "On time" : minutes <= 450 ? "Late" : "Half day";
    if (shift === "B") {
      if (minutes <= 570) return "On time";
      if (minutes <= 749) return "Late";
      if (minutes <= 810) return "On time";
      if (minutes <= 930) return "Late";
      return "Half day";
    }
    if (shift === "C") {
      if (minutes < 1050) return "On time";
      if (minutes <= 1229) return "Late";
      if (minutes <= 1290) return "On time";
      if (minutes <= 1410) return "Late";
      return "Half day";
    }
    return "On time";
  };

  // 6. Regular Employee Status
  const getRegularStatus = (minutes, shift) => {
    if (shift === "A") return minutes <= 330 ? "On time" : minutes <= 450 ? "Late" : "Half day";
    if (shift === "B") return minutes <= 810 ? "On time" : minutes <= 930 ? "Late" : "Half day";
    if (shift === "C") {
      if (minutes >= 1230 && minutes <= 1290) return "On time";
      if ((minutes >= 1291 && minutes <= 1410) || minutes <= 269) return "Late";
      return "Half day";
    }
    return "On time";
  };

  // 7. MAIN STATUS DECIDER — FINAL SAFETY
  const getStatus = (timestamp, empId) => {
    if (isCleaningStaff.has(empId) || isSpecialExempt.has(empId)) return "N/A";
    if (["ADMIN", "STL"].includes(projectMap[empId] || "")) return "N/A";

    const minutes = getColomboMinutes(timestamp);
    const shift = todayShiftMap[empId];

    // NO VALID SHIFT? → ALWAYS "On time"
    if (!shift || !["A", "B", "C"].includes(shift)) {
      return "On time";
    }

    if (["TL", "ASS. TL", "TTL"].includes(projectMap[empId] || "")) {
      return getTLStatus(minutes, shift);
    }

    return getRegularStatus(minutes, shift);
  };

  // 8. Final Output
  return Object.values(latestCheckIn).map((log) => {
    const empId = log.employee_id;

    return {
      id: empId,
      name: nameMap[empId] || log.employee_name || "Unknown",
      project: projectMap[empId] || "UNKNOWN",
      checkInTime: new Date(log.timestamp).toLocaleString("en-US", {
        timeZone: "Asia/Colombo",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      timestamp: log.timestamp,
      status: getStatus(log.timestamp, empId),
    };
  });
}