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
      if (minutes <= 810) return "On time";      // 12:30–13:30
      if (minutes <= 930) return "Late";         // 13:31–15:30
      return "Half day";                         // >15:30
    }
    if (shift === "C") {
      if (minutes < 1050) return "On time";      // before 17:30
      if (minutes <= 1229) return "Late";        // 17:31–20:29
      if (minutes <= 1290) return "On time";     // 20:30–21:30
      if (minutes <= 1410) return "Late";        // 21:31–23:30
      return "Half day";
    }
    return minutes <= 570 ? "On time" : "Late";
  };

  // 5. REGULAR EMPLOYEES
  const getRegularStatus = (minutes, shift) => {
    if (shift === "A") {
      if (minutes <= 330) return "On time";
      if (minutes <= 450) return "Late";
      return "Half day";
    }
    if (shift === "B") {
      if (minutes <= 810) return "On time";      // 12:30 – 13:30
      if (minutes <= 930) return "Late";
      return "Half day";
    }
    if (shift === "C") {
      if (minutes >= 1230 && minutes <= 1290) return "On time"; // 20:30–21:30
      if ((minutes >= 1291 && minutes <= 1410) || minutes <= 269) return "Late";
      return "Half day";
    }
    return "On time";
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

    return getRegularStatus(minutes, shift);
  };

  // 7. Final output — NOW INCLUDES PROJECT NAME
  return Object.values(latestCheckIn).map(log => {
    const empId = log.employee_id;
    const project = projectMap[empId] || "UNKNOWN";

    return {
      id: empId,
      name: log.employee_name || "Unknown",
      project: project,  // ← This is the new field sent to frontend
      checkInTime: new Date(log.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      timestamp: log.timestamp,
      status: getStatus(log.timestamp, empId),
    };
  });
}