import { supabase } from "../config/db.js";

// MAIN STATUS DECIDER FOR CHECK-OUTS
const getStatus = (timestamp, empId, checkInTimestamp) => {
  const project = (projectMap[empId] || "").toUpperCase();
  if (["STL", "ADMIN", "ER", "CLEANING", "JANITOR"].includes(project) || isSpecialExempt.has(empId)) return "N/A";

  if (!checkInTimestamp) return "Half Day";

  const durationHours = (new Date(timestamp) - new Date(checkInTimestamp)) / (1000 * 60 * 60);
  return durationHours > 8 ? "Complete" : "Half Day";
};

// Global variables (will be populated inside function)
let isCleaningStaff, isSpecialExempt, nameMap, projectMap, todayShiftMap;

export async function getCheckoutLogs() {
  // BULLETPROOF DATE — ALWAYS USE SRI LANKA TIME
  const colomboNow = new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" });
  const today = new Date(colomboNow);

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = today.getDate();
  const monthYear = `${year}-${month}`;

  // Calculate UTC ranges for today and yesterday (to handle overnight shifts)
  const colomboOffset = 5.5 * 60 * 60 * 1000; // 5:30 hours in ms
  const todayStartColombo = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayStartUTC = new Date(todayStartColombo.getTime() - colomboOffset);
  const todayEndUTC = new Date(todayStartUTC.getTime() + 24 * 60 * 60 * 1000);
  const yesterdayStartUTC = new Date(todayStartUTC.getTime() - 24 * 60 * 60 * 1000);

  // Fetch today's check-out logs
  const { data: logs, error: logError } = await supabase
    .from("attendance_logs_check_out")
    .select("id, employee_id, employee_name, timestamp")
    .gte("timestamp", todayStartUTC.toISOString())
    .lt("timestamp", todayEndUTC.toISOString())
    .order("timestamp", { ascending: false });

  if (logError) throw new Error(logError.message);
  if (!logs || logs.length === 0) return [];

  // 1. Load today's shift assignments (kept for consistency, though not used in status)
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
      // "RD", "OFF", "W5", "HOB" → ignored = no shift
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

  // 4. Get latest check-out per employee
  const latestCheckOut = {};
  for (const log of logs) {
    const current = latestCheckOut[log.employee_id];
    if (!current || new Date(log.timestamp) > new Date(current.timestamp)) {
      latestCheckOut[log.employee_id] = log;
    }
  }

  // 5. Fetch recent check-in logs (from yesterday onwards to handle overnight)
  const { data: checkInLogs, error: ciError } = await supabase
    .from("attendance_logs_check_in")
    .select("employee_id, timestamp")
    .gte("timestamp", yesterdayStartUTC.toISOString())
    .order("timestamp", { ascending: false });

  if (ciError) throw new Error(ciError.message);

  // Group check-ins by employee (lists are ordered desc)
  const empCheckIns = {};
  checkInLogs.forEach((log) => {
    if (!empCheckIns[log.employee_id]) empCheckIns[log.employee_id] = [];
    empCheckIns[log.employee_id].push(log.timestamp);
  });

  // === HIDE SENSITIVE PROJECT NAMES (e.g., ADMIN → ER) ===
  const HIDDEN_PROJECT_EMPLOYEES = new Set(["1001", "1283"]); // Add more IDs if needed
  const projectDisplayOverride = (empId, originalProject) => {
    if (HIDDEN_PROJECT_EMPLOYEES.has(empId)) {
      return "ER"; // Always show "ER" for these IDs, no matter what project they have
    }
    return originalProject;
  };

  // 6. Final Output — With check-out specific status + event field
  return Object.values(latestCheckOut).map((log) => {
    const empId = log.employee_id;
    const checkOutTs = log.timestamp;
    let checkInTs = null;

    // Find the latest check-in before this check-out (lists are desc ordered)
    const checkInList = empCheckIns[empId] || [];
    for (const ts of checkInList) {
      if (new Date(ts) < new Date(checkOutTs)) {
        checkInTs = ts;
        break;
      }
    }

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
      status: getStatus(log.timestamp, empId, checkInTs),
      event: "Check_Out",
    };
  });
}