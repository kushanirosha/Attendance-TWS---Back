// services/attendanceLtlService.js
import { supabase } from "../config/db.js";

export const getLtlActiveNowCount = async () => {
  try {
    const LTL_PROJECTS = ["TTL", "ASS. TL", "TL"];
    const lookbackHours = 24; // 3 days to be safe
    const fromTime = new Date();
    fromTime.setHours(fromTime.getHours() - lookbackHours);

    // 1. Get all active LTL employees
    const { data: ltlEmployees } = await supabase
      .from("employees")
      .select("id, name, gender")
      .in("project", LTL_PROJECTS)
      .eq("status", "Active");

    if (!ltlEmployees || ltlEmployees.length === 0) {
      return { total: 0, male: 0, female: 0, activeEmployeeIds: [], activeEmployees: [] };
    }

    const ltlIds = ltlEmployees.map(e => e.id);
    const employeeInfo = Object.fromEntries(
      ltlEmployees.map(e => [e.id, { name: e.name, gender: e.gender }])
    );

    // 2. Fetch ALL logs in the last 72 hours (sorted)
    const { data: logs } = await supabase
      .from("attendance_logs_check_in")
      .select("employee_id, event_type, timestamp")
      .in("employee_id", ltlIds)
      .gte("timestamp", fromTime.toISOString())
      .order("timestamp", { ascending: true });

    if (!logs || logs.length === 0) {
      return { total: 0, male: 0, female: 0, activeEmployeeIds: [], activeEmployees: [] };
    }

    // 3. Group logs by employee and find current active session
    const activeEmployeeIds = [];
    const activeEmployees = [];
    let total = 0, male = 0, female = 0;

    const sessions = {}; // empId → { checkIn: time, checkOut: time|null }

    logs.forEach(log => {
      const id = log.employee_id;
      if (!sessions[id]) sessions[id] = { checkIn: null, checkOut: null };

      if (log.event_type === "check_in") {
        // Start a new session if none active
        if (!sessions[id].checkIn || sessions[id].checkOut) {
          sessions[id] = { checkIn: log.timestamp, checkOut: null };
        }
      } else if (log.event_type === "check_out") {
        // Close current session if open
        if (sessions[id].checkIn && !sessions[id].checkOut) {
          sessions[id].checkOut = log.timestamp;
        }
      }
    });

    // 4. Now evaluate only the latest session per employee
    for (const [empId, session] of Object.entries(sessions)) {
      const checkInTime = new Date(session.checkIn);
      const checkOutTime = session.checkOut ? new Date(session.checkOut) : null;

      const isStillInside = !checkOutTime;
      const hoursSinceCheckIn = checkOutTime
        ? (checkOutTime - checkInTime) / (1000 * 60 * 60)
        : (Date.now() - checkInTime) / (1000 * 60 * 60);

      // Active if: still inside OR checked out within last 18 hours
      if (isStillInside || hoursSinceCheckIn <= 18) {
        total++;
        activeEmployeeIds.push(empId);

        const info = employeeInfo[empId];
        if (info.gender === "Male") male++;
        else if (info.gender === "Female") female++;

        activeEmployees.push({
          id: empId,
          name: info.name,
          gender: info.gender,
          checkInTime: checkInTime.toLocaleString("en-US", { timeZone: "Asia/Colombo" }),
          checkOutTime: checkOutTime?.toLocaleString("en-US", { timeZone: "Asia/Colombo" }) || null,
          status: isStillInside ? "Inside" : "Checked out (within 18h)"
        });
      }
    }

    console.log(`LTL Active Now → ${total} employees:`, activeEmployeeIds);
    return {
      total,
      male,
      female,
      activeEmployeeIds,
      activeEmployees
    };

  } catch (err) {
    console.error("getLtlActiveNowCount error:", err.message);
    return { total: 0, male: 0, female: 0, activeEmployeeIds: [], activeEmployees: [] };
  }
};