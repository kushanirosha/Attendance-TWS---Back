// utils/attendance.js
import { supabase } from "../config/db.js";

export async function getAttendanceLogs() {
  const { data: logs, error: logError } = await supabase
    .from("attendance_logs_check_in")
    .select("id, employee_id, employee_name, timestamp")
    .order("timestamp", { ascending: false });

  if (logError) throw new Error(logError.message);
  if (!logs || logs.length === 0) return [];

  const today = new Date();
  const dayOfMonth = today.getDate();
  const monthYear = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  // 1. Load shift assignments from ALL projects
  const { data: shiftRows } = await supabase
    .from("shift_assignments")
    .select("assignments")
    .eq("month_year", monthYear);

  const todayShiftMap = {};
  shiftRows?.forEach(row => {
    const assignments = row.assignments || {};
    Object.entries(assignments).forEach(([empId, dates]) => {
      const shift = dates?.[dayOfMonth.toString()];
      if (shift && shift !== "RD") todayShiftMap[empId] = shift;
    });
  });

  // 2. Load employee project
  const employeeIds = [...new Set(logs.map(l => l.employee_id))];
  const { data: employees } = await supabase
    .from("employees")
    .select("id, project")
    .in("id", employeeIds);

  const projectMap = {};
  employees?.forEach(e => {
    projectMap[e.id] = (e.project || "").toString().trim().toUpperCase();
  });

  // 3. Latest check-in per employee
  const latestCheckIn = {};
  for (const log of logs) {
    const prev = latestCheckIn[log.employee_id];
    if (!prev || new Date(log.timestamp) > new Date(prev.timestamp)) {
      latestCheckIn[log.employee_id] = log;
    }
  }

  // 4. TL / ASS.TL / TTL – Special detailed rules
  const getTLStatus = (minutes, shift) => {
    if (shift === "A") {
      if (minutes <= 330) return "On time";      // ≤05:30
      if (minutes <= 450) return "Late";         // ≤07:30
      return "Half day";
    }
    if (shift === "B") {
      if (minutes <= 570) return "On time";      // ≤09:30
      if (minutes <= 749) return "Late";         // ≤12:29
      if (minutes <= 810) return "On time";      // 12:30–01:30
      if (minutes <= 930) return "Late";         // 01:31–03:30
      return "Half day";                         // 03:31–08:29
    }
    if (shift === "C") {
      if (minutes < 1050) return "On time";      // before 05:30 PM
      if (minutes <= 1229) return "Late";        // 05:31–08:29 PM
      if (minutes <= 1290) return "On time";     // 08:30–09:30 PM
      if (minutes <= 1410) return "Late";        // 09:31–11:30 PM
      return "Half day";                         // 11:31 PM – 04:29 AM
    }
    return minutes <= 570 ? "On time" :  "Late"; // no shift
  };

  // 5. REGULAR EMPLOYEES – Full original shift rules
  const getRegularStatus = (minutes, shift) => {
    if (shift === "A") {
      if (minutes <= 330) return "On time";      // ≤05:30
      if (minutes <= 450) return "Late";         // ≤07:30
      return "Half day";
    }
    if (shift === "B") {
      if (minutes <= 810) return "On time";      // 12:30 – 01:30 PM
      if (minutes <= 930) return "Late";         // 01:31 – 03:30 PM
      return "Half day";                         // after 03:30 PM
    }
    if (shift === "C") {
      if (minutes >= 1230 && minutes <= 1290) return "On time"; // 08:30–09:30 PM
      if ((minutes >= 1291 && minutes <= 1410) || minutes <= 269) return "Late";
      return "Half day";
    }
    return "On time"; // no shift assigned
  };

  // 6. MAIN STATUS DECIDER
  const getStatus = (timestamp, empId) => {
    const project = projectMap[empId] || "";
    const shift = todayShiftMap[empId];
    const minutes = new Date(timestamp).getHours() * 60 + new Date(timestamp).getMinutes();

    if (project === "ADMIN" || project === "STL") return "N/A";

    if (["TL", "ASS. TL", "TTL"].includes(project)) {
      return getTLStatus(minutes, shift);
    }

    // All other employees (regular workers)
    return getRegularStatus(minutes, shift);
  };

  // 7. Final output
  return Object.values(latestCheckIn).map(log => ({
    id: log.employee_id,
    name: log.employee_name || "Unknown",
    checkInTime: new Date(log.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    timestamp: log.timestamp,
    status: getStatus(log.timestamp, log.employee_id),
  }));
}