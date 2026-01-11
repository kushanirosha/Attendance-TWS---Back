// services/attendanceTlService.js
import { supabase } from "../config/db.js";

export const getTlActiveNowCount = async () => {
  try {
    const TL_PROJECTS = ["TTL", "ASS. TL", "TL"];

    // 1. Get all active TL employees
    const { data: employees } = await supabase
      .from("employees")
      .select("id, name, gender")
      .in("project", TL_PROJECTS)
      .eq("status", "Active");

    if (!employees || employees.length === 0) {
      return { total: 0, male: 0, female: 0, activeEmployeeIds: [], activeEmployees: [] };
    }

    const employeeMap = Object.fromEntries(
      employees.map(e => [String(e.id), { name: e.name, gender: e.gender }])
    );
    const empIds = employees.map(e => e.id);

    // 2. Fetch from BOTH check-in and check-out tables (last 48 hours)
    const fromTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const [checkInRes, checkOutRes] = await Promise.all([
      supabase
        .from("attendance_logs_check_in")
        .select("employee_id, timestamp")
        .in("employee_id", empIds)
        .gte("timestamp", fromTime),

      supabase
        .from("attendance_logs_check_out")
        .select("employee_id, timestamp")
        .in("employee_id", empIds)
        .gte("timestamp", fromTime)
    ]);

    // Combine all events
    const allEvents = [];

    checkInRes.data?.forEach(log => {
      allEvents.push({
        employee_id: String(log.employee_id),
        type: "check_in",
        time: new Date(log.timestamp)
      });
    });

    checkOutRes.data?.forEach(log => {
      allEvents.push({
        employee_id: String(log.employee_id),
        type: "check_out",
        time: new Date(log.timestamp)
      });
    });

    if (allEvents.length === 0) {
      return { total: 0, male: 0, female: 0, activeEmployeeIds: [], activeEmployees: [] };
    }

    // Group and sort by employee + time
    const logsByEmployee = {};
    allEvents.forEach(event => {
      if (!logsByEmployee[event.employee_id]) logsByEmployee[event.employee_id] = [];
      logsByEmployee[event.employee_id].push(event);
    });

    Object.values(logsByEmployee).forEach(logs => {
      logs.sort((a, b) => a.time - b.time);
    });

    // 3. Determine who is currently inside
    const activeEmployeeIds = [];
    const activeEmployees = [];
    let total = 0, male = 0, female = 0;
    const now = Date.now();
    const MAX_HOURS = 16;
    const MAX_MS = MAX_HOURS * 3600000;

    for (const [empId, logs] of Object.entries(logsByEmployee)) {
      let isInside = false;
      let lastCheckInTime = null;

      for (const log of logs) {
        if (log.type === "check_in") {
          isInside = true;
          lastCheckInTime = log.time;
        } else if (log.type === "check_out") {
          isInside = false;
          lastCheckInTime = null;
        }
      }

      // Still inside + checked in within last 16 hours
      if (isInside && lastCheckInTime && (now - lastCheckInTime.getTime()) <= MAX_MS) {
        total++;
        activeEmployeeIds.push(empId);

        const info = employeeMap[empId];
        if (info.gender === "Male") male++;
        else if (info.gender === "Female") female++;

        activeEmployees.push({
          id: empId,
          name: info.name,
          gender: info.gender,
          checkInTime: lastCheckInTime.toLocaleString("en-US", { timeZone: "Asia/Colombo" }),
          status: "Inside"
        });
      }
    }

    console.log(`TL Active Now → ${total} employees:`, activeEmployeeIds);
    return {
      total,
      male,
      female,
      activeEmployeeIds,
      activeEmployees: activeEmployees.sort((a, b) => a.name.localeCompare(b.name))
    };

  } catch (err) {
    console.error("getTlActiveNowCount error:", err.message);
    return { total: 0, male: 0, female: 0, activeEmployeeIds: [], activeEmployees: [] };
  }
};