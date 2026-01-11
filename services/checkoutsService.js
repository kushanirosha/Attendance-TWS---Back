import { supabase } from "../config/db.js";

// MAIN STATUS DECIDER FOR CHECK-OUTS (UPDATED LOGIC)
const getStatus = (checkoutTimestamp, empId) => {
  const project = (projectMap[empId] || "").toUpperCase().trim();
  
  // N/A for special projects or exempt employees
  if (
    ["PTS", "ADMIN", "ER", "CLEANING", "JANITOR"].includes(project) ||
    isSpecialExempt.has(empId)
  ) {
    return "N/A";
  }

  const shift = todayShiftMap[empId];

  // If no shift assigned today (OFF, RD, W5, HOB, or not in map) → Complete
  if (!shift || !["A", "B", "C"].includes(shift)) {
    return "Complete";
  }

  // Convert checkout timestamp to Colombo time for accurate hour/minute check
  const checkoutDate = new Date(checkoutTimestamp);
  const colomboTime = new Date(checkoutDate.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
  const hour = colomboTime.getHours();
  const minute = colomboTime.getMinutes();

  if (shift === "A") {
    // A Shift: Expected checkout around 1:00 PM - 1:30 PM
    if (hour === 13 && minute >= 0 && minute < 30) {
      return "Incomplete"; // 1:00 PM to 1:29 PM
    } else if (hour === 13 && minute >= 30) {
      return "Complete"; // 1:30 PM or later
    } else if (hour < 13 || (hour === 13 && minute === 0)) {
      return "Half Day"; // Before 1:00 PM
    } else {
      return "Complete"; // After 1:30 PM
    }
  }

  if (shift === "B") {
    // B Shift: Expected checkout around 9:00 PM - 9:30 PM
    if (hour === 21 && minute >= 0 && minute < 30) {
      return "Incomplete"; // 9:00 PM to 9:29 PM
    } else if (hour === 21 && minute >= 30) {
      return "Complete"; // 9:30 PM or later
    } else if (hour < 21) {
      return "Half Day"; // Before 9:00 PM
    } else {
      return "Complete"; // After 9:30 PM (next day possible, but treated as complete)
    }
  }

  if (shift === "C") {
    // C Shift: Expected checkout around 5:00 AM - 5:30 AM (next day)
    if (hour === 5 && minute >= 0 && minute < 30) {
      return "Incomplete"; // 5:00 AM to 5:29 AM
    } else if (hour === 5 && minute >= 30) {
      return "Complete"; // 5:30 AM or later
    } else if (hour < 5) {
      return "Half Day"; // Before 5:00 AM
    } else {
      return "Complete"; // After 5:30 AM
    }
  }

  // Fallback (should not reach here)
  return "Complete";
};

// Global variables
let isCleaningStaff, isSpecialExempt, nameMap, projectMap, todayShiftMap;

export async function getCheckoutLogs() {
  // BULLETPROOF DATE — SRI LANKA TIME
  const colomboNow = new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" });
  const today = new Date(colomboNow);

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = today.getDate();
  const monthYear = `${year}-${month}`;

  // UTC range for today in Colombo time
  const colomboOffset = 5.5 * 60 * 60 * 1000;
  const todayStartColombo = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayStartUTC = new Date(todayStartColombo.getTime() - colomboOffset);
  const todayEndUTC = new Date(todayStartUTC.getTime() + 24 * 60 * 60 * 1000);

  // Fetch today's check-out logs
  const { data: logs, error: logError } = await supabase
    .from("attendance_logs_check_out")
    .select("id, employee_id, employee_name, timestamp")
    .gte("timestamp", todayStartUTC.toISOString())
    .lt("timestamp", todayEndUTC.toISOString())
    .order("timestamp", { ascending: false });

  if (logError) throw new Error(logError.message);
  if (!logs || logs.length === 0) return [];

  // Load today's shift assignments
  const { data: shiftRows } = await supabase
    .from("shift_assignments")
    .select("assignments")
    .eq("month_year", monthYear);

  todayShiftMap = {};

  shiftRows?.forEach((row) => {
    const assignments = row.assignments || {};
    Object.entries(assignments).forEach(([empId, dates]) => {
      const shift = dates?.[dayOfMonth.toString()];
      if (["A", "B", "C"].includes(shift)) {
        todayShiftMap[empId] = shift;
      }
      // Others (RD, OFF, etc.) intentionally not added → treated as no shift
    });
  });

  // Get unique employee IDs from checkouts
  const employeeIds = [...new Set(logs.map((l) => l.employee_id))];

  // Fetch employee details
  const [{ data: regularEmployees }, { data: cleaningStaff }] = await Promise.all([
    supabase.from("employees").select("id, name, project").in("id", employeeIds),
    supabase.from("cleaning_staff").select("id, name, project").in("id", employeeIds),
  ]);

  // Master maps
  nameMap = {};
  projectMap = {};
  isCleaningStaff = new Set();
  isSpecialExempt = new Set(["1007"]); // Add exempt IDs here

  regularEmployees?.forEach((emp) => {
    nameMap[emp.id] = emp.name || "Unknown";
    projectMap[emp.id] = (emp.project || "").toString().trim().toUpperCase();
  });

  cleaningStaff?.forEach((staff) => {
    nameMap[staff.id] = staff.name || "Unknown";
    projectMap[staff.id] = "JANITOR";
    isCleaningStaff.add(staff.id);
  });

  // Get latest check-out per employee
  const latestCheckOut = {};
  for (const log of logs) {
    const current = latestCheckOut[log.employee_id];
    if (!current || new Date(log.timestamp) > new Date(current.timestamp)) {
      latestCheckOut[log.employee_id] = log;
    }
  };

  // === HIDE SENSITIVE PROJECT NAMES ===
  const HIDDEN_PROJECT_EMPLOYEES = new Set(["1001", "1283"]);
  const projectDisplayOverride = (empId, originalProject) => {
    return HIDDEN_PROJECT_EMPLOYEES.has(empId) ? "ER" : originalProject;
  };

  // Final Output
  return Object.values(latestCheckOut).map((log) => {
    const empId = log.employee_id;
    const originalProject = projectMap[empId] || "UNKNOWN";
    const displayProject = projectDisplayOverride(empId, originalProject);

    return {
      id: empId,
      name: nameMap[empId] || log.employee_name || "Unknown",
      project: displayProject,
      checkOutTime: new Date(log.timestamp).toLocaleString("en-US", {
        timeZone: "Asia/Colombo",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      timestamp: log.timestamp,
      status: getStatus(log.timestamp, empId), // Updated logic
      event: "Check_Out",
    };
  });
}