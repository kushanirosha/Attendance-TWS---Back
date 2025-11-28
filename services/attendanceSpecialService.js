// services/attendanceSpecialService.js
import { supabase } from "../config/db.js";

// List of special employees to track individually (e.g., IT, Security, etc.)
const SPECIAL_EMPLOYEE_IDS = ["1007"]; // Add more IDs here if needed

/**
 * Get active status of special employees based on latest check-in/out
 * Logic: Last event = check-in → Active | Last event = check-out → Not active
 */
export const getSpecialEmployeesActiveNowCount = async () => {
  try {
    // 1. Fetch employee details
    const { data: employees, error: empError } = await supabase
      .from("employees")
      .select("id, gender, project")
      .in("id", SPECIAL_EMPLOYEE_IDS);

    if (empError || !employees || employees.length === 0) {
      return {
        total: 0,
        male: 0,
        female: 0,
        project: "N/A",
        activeEmployeeIds: [],
      };
    }

    // 2. Fetch ALL recent logs for these employees (last 18 hours to be safe)
    const fortyEightHoursAgo = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();

    const { data: logs, error: logError } = await supabase
      .from("attendance_logs_check_in")
      .select("employee_id, event_type, timestamp")
      .in("employee_id", SPECIAL_EMPLOYEE_IDS)
      .gte("timestamp", fortyEightHoursAgo)
      .order("timestamp", { ascending: false }); // Latest first

    if (logError) throw logError;

    // 3. Find latest event per employee
    const latestEvent = {};

    logs.forEach(log => {
      const id = String(log.employee_id);
      if (!latestEvent[id] || new Date(log.timestamp) > new Date(latestEvent[id].timestamp)) {
        latestEvent[id] = {
          event_type: log.event_type,
          timestamp: log.timestamp,
        };
      }
    });

    // 4. Determine who is currently active (latest event = check_in)
    const activeIds = new Set();
    let male = 0;
    let female = 0;
    let project = "N/A";

    employees.forEach(emp => {
      const idStr = String(emp.id);
      const lastEvent = latestEvent[idStr];

      if (lastEvent && lastEvent.event_type === "check_in") {
        activeIds.add(idStr);
        if (emp.gender === "Male") male++;
        if (emp.gender === "Female") female++;
        if (project === "N/A") project = (emp.project || "Unknown").trim();
      }
    });

    return {
      total: activeIds.size,
      male,
      female,
      project: activeIds.size > 1 ? "Multiple" : project,
      activeEmployeeIds: [...activeIds],
    };

  } catch (error) {
    console.error("getSpecialEmployeesActiveNowCount error:", error.message);
    return {
      total: 0,
      male: 0,
      female: 0,
      project: "Error",
      activeEmployeeIds: [],
    };
  }
};