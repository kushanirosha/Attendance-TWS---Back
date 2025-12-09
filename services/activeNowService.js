import { supabase } from "../config/db.js";

export const getActiveNowCount = async () => {
  try {
    // 1. Get ALL employees (except special roles if you want — but we'll include all)
    const { data: employees, error: empErr } = await supabase
      .from("employees")
      .select("id, gender");

    if (empErr || !employees || employees.length === 0) {
      console.warn("No employees found");
      return { total: 0, male: 0, female: 0, activeEmployeeIds: [] };
    }

    const employeeIds = employees.map(e => String(e.id));
    const genderMap = {};
    employees.forEach(e => {
      genderMap[String(e.id)] = e.gender || "Unknown";
    });

    // 2. Last 13 hours in UTC (proven working window)
    const now = new Date();
    const windowStart = new Date(now.getTime() - 13 * 60 * 60 * 1000); // 13 hours ago

    // 3. Fetch check-ins & check-outs in last 13 hours
    const [inRes, outRes] = await Promise.all([
      supabase
        .from("attendance_logs_check_in")
        .select("employee_id, timestamp")
        .in("employee_id", employeeIds)
        .gte("timestamp", windowStart.toISOString()),

      supabase
        .from("attendance_logs_check_out")
        .select("employee_id, timestamp")
        .in("employee_id", employeeIds)
        .gte("timestamp", windowStart.toISOString())
    ]);

    if (inRes.error) throw inRes.error;
    if (outRes.error) throw outRes.error;

    const checkIns = inRes.data || [];
    const checkOuts = outRes.data || [];

    // 4. Track latest in/out per employee
    const latest = {};

    const update = (id, ts, type) => {
      if (!latest[id]) latest[id] = { in: null, out: null };
      if (type === "in" && (!latest[id].in || ts > latest[id].in)) latest[id].in = ts;
      if (type === "out" && (!latest[id].out || ts > latest[id].out)) latest[id].out = ts;
    };

    checkIns.forEach(log => update(log.employee_id, log.timestamp, "in"));
    checkOuts.forEach(log => update(log.employee_id, log.timestamp, "out"));

    // 5. Determine who is active now
    const activeIds = [];
    let male = 0;
    let female = 0;

    for (const id in latest) {
      const { in: inTs, out: outTs } = latest[id];
      // Active if: checked in AND (no checkout OR checkout before checkin)
      if (inTs && (!outTs || outTs < inTs)) {
        activeIds.push(id);
        const gender = genderMap[id];
        if (gender === "Male") male++;
        else if (gender === "Female") female++;
      }
    }

    activeIds.sort((a, b) => a.localeCompare(b));

    console.log(`Active Now: ${activeIds.length} employees`);

    return {
      total: activeIds.length,
      male,
      female,
      activeEmployeeIds: activeIds,
      updatedAt: new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" }),
      _debug: {
        windowStart: windowStart.toLocaleString("en-US", { timeZone: "Asia/Colombo" }),
        totalCheckIns: checkIns.length,
        totalCheckOuts: checkOuts.length,
        employeesCheckedIn: Object.keys(latest).length
      }
    };

  } catch (error) {
    console.error("getActiveNowCount error:", error);
    return {
      total: 0,
      male: 0,
      female: 0,
      activeEmployeeIds: [],
      error: error.message
    };
  }
};