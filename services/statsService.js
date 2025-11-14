// services/statsService.js
import { supabase } from "../config/db.js";

/* -------------------------------------------------
   SHIFT CONFIG – early window & time bands (minutes)
   ------------------------------------------------- */
const SHIFT_CONFIG = {
  Morning: {
    early: 4 * 60 + 30,          // 04:30
    onTimeEnd: 5 * 60 + 30,      // 05:30
    lateEnd: 7 * 60 + 30,        // 07:30
    halfDayEnd: 12 * 60 + 29,    // 12:29
  },
  Noon: {
    early: 12 * 60 + 30,         // 12:30
    onTimeEnd: 13 * 60 + 30,     // 13:30
    lateEnd: 15 * 60 + 30,       // 15:30
    halfDayEnd: 20 * 60 + 29,    // 20:29
  },
  Night: {
    early: 20 * 60 + 30,         // 20:30
    onTimeEnd: 21 * 60 + 30,     // 21:30
    lateEnd: 23 * 60 + 30,       // 23:30
    halfDayEnd: 4 * 60 + 29,     // 04:29 (next day)
    nextDayWrap: true,
  },
};

/* -------------------------------------------------
   Helper: current shift name (Colombo time)
   ------------------------------------------------- */
const getCurrentShift = () => {
  const now = new Date();
  const colombo = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
  const minutes = colombo.getHours() * 60 + colombo.getMinutes();

  const { Morning, Noon, Night } = SHIFT_CONFIG;
  if (minutes >= Morning.onTimeEnd && minutes < Noon.onTimeEnd) return "Morning";
  if (minutes >= Noon.onTimeEnd && minutes < Night.onTimeEnd) return "Noon";
  return "Night";
};

/* -------------------------------------------------
   Helpers: date strings (Colombo time)
   ------------------------------------------------- */
const getTodayDateString = () => {
  const now = new Date();
  const colombo = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
  return colombo.toISOString().split("T")[0]; // YYYY-MM-DD
};

const getCurrentMonthYear = () => {
  const now = new Date();
  const colombo = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
  return `${colombo.getFullYear()}-${String(colombo.getMonth() + 1).padStart(2, "0")}`;
};

const getTodayDay = () => {
  const now = new Date();
  const colombo = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
  return colombo.getDate().toString(); // "14"
};

/* -------------------------------------------------
   Attendance status for a timestamp (first valid punch)
   ------------------------------------------------- */
const getAttendanceStatus = (timestamp, cfg) => {
  const d = new Date(timestamp);
  const minutes = d.getHours() * 60 + d.getMinutes();
  const total = cfg.nextDayWrap && minutes < 300 ? minutes + 1440 : minutes;

  if (total < cfg.early) return null;
  if (total <= cfg.onTimeEnd) return "onTime";
  if (total <= cfg.lateEnd) return "late";
  if (total <= cfg.halfDayEnd + (cfg.nextDayWrap ? 1440 : 0)) return "halfDay";
  return null;
};

/* -------------------------------------------------
   MAIN EXPORT
   ------------------------------------------------- */
export const getDashboardStats = async () => {
  const currentShiftName = getCurrentShift();
  const cfg = SHIFT_CONFIG[currentShiftName];

  const today = getTodayDateString();        // "2025-11-14"
  const monthYear = getCurrentMonthYear();   // "2025-11"
  const todayDay = getTodayDay();            // "14"

  const shiftMap = { A: "Morning", B: "Noon", C: "Night" };
  const currentShiftCode = Object.keys(shiftMap).find(k => shiftMap[k] === currentShiftName);

  try {
    /* ------------------ 1. FETCH RAW DATA ------------------ */
    const [
      { data: employees = [] },
      { data: shiftRecords = [] },
      { data: logs = [] }
    ] = await Promise.all([
      supabase.from("employees").select("id, gender"),
      supabase.from("shift_assignments").select("assignments").eq("month_year", monthYear),

      // FIXED: Correct table + event_type + UTC bounds
      (async () => {
        const colomboMidnight = new Date(
          new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" })
        );
        colomboMidnight.setHours(0, 0, 0, 0);

        const nextDayMidnight = new Date(colomboMidnight);
        nextDayMidnight.setDate(nextDayMidnight.getDate() + 1);

        const startUTC = colomboMidnight.toISOString().slice(0, 19); // "2025-11-14T00:00:00"
        const endUTC = nextDayMidnight.toISOString().slice(0, 19);   // "2025-11-15T00:00:00"

        return supabase
          .from("attendance_logs_check_in")        // CORRECT TABLE
          .select("employee_id, timestamp")
          .eq("event_type", "check_in")            // Only first punch
          .gte("timestamp", startUTC)
          .lt("timestamp", endUTC);
      })()
    ]);

    const empList = Array.isArray(employees) ? employees : [];
    const shiftList = Array.isArray(shiftRecords) ? shiftRecords : [];
    const logList = Array.isArray(logs) ? logs : [];

    /* ------------------ 2. FIRST VALID PUNCH (>= 04:30) ------------------ */
    const firstValidPunch = {};

    logList.forEach(log => {
      const empId = String(log.employee_id);
      const d = new Date(log.timestamp);
      const minutes = d.getHours() * 60 + d.getMinutes();
      const total = cfg.nextDayWrap && minutes < 300 ? minutes + 1440 : minutes;

      if (total < cfg.early || firstValidPunch[empId]) return;
      firstValidPunch[empId] = log;
    });

    /* ------------------ 3. CLASSIFY ATTENDANCE ------------------ */
    const onTime = new Set(), late = new Set(), halfDay = new Set(), presentAny = new Set();

    Object.entries(firstValidPunch).forEach(([empId, log]) => {
      const status = getAttendanceStatus(log.timestamp, cfg);
      if (!status) return;

      presentAny.add(empId);
      if (status === "onTime") onTime.add(empId);
      if (status === "late") late.add(empId);
      if (status === "halfDay") halfDay.add(empId);
    });

    /* ------------------ 4. SHIFT ASSIGNMENTS ------------------ */
    const currentShiftEmployees = new Set();
    const rdToday = new Set();

    shiftList.forEach(record => {
      let assignments;
      try {
        assignments = typeof record.assignments === "string"
          ? JSON.parse(record.assignments)
          : record.assignments;
      } catch (e) {
        console.warn("Failed to parse assignments", e);
        return;
      }

      if (!assignments || typeof assignments !== "object") return;

      Object.entries(assignments).forEach(([empId, days]) => {
        const shiftToday = days?.[todayDay];
        if (!shiftToday) return;

        const id = String(empId);
        if (shiftToday === "RD") {
          rdToday.add(id);
        } else if (
          shiftToday === currentShiftCode ||
          shiftMap[shiftToday] === currentShiftName
        ) {
          currentShiftEmployees.add(id);
        }
      });
    });

    /* ------------------ 5. GENDER BREAKDOWN ------------------ */
    const maleIds = new Set(empList.filter(e => e?.gender === "Male").map(e => String(e.id)));
    const femaleIds = new Set(empList.filter(e => e?.gender === "Female").map(e => String(e.id)));

    const countGender = (set) => {
      if (!set || set.size === 0) return { male: 0, female: 0, total: 0 };
      const males = [...set].filter(id => maleIds.has(id)).length;
      const females = [...set].filter(id => femaleIds.has(id)).length;
      return { male: males, female: females, total: set.size };
    };

    const totalStats = countGender(new Set(empList.map(e => String(e.id))));
    const presentStats = countGender(presentAny);
    const onTimeStats = countGender(onTime);
    const lateStats = countGender(late);
    const halfDayStats = countGender(halfDay);
    const absentStats = countGender(
      new Set([...currentShiftEmployees].filter(id => !presentAny.has(id) && !rdToday.has(id)))
    );
    const rdStats = countGender(rdToday);

    /* ------------------ 6. LATE + HALF-DAY = lateComing ------------------ */
    const totalLateCount = late.size + halfDay.size;
    const lateMale = lateStats.male + halfDayStats.male;
    const lateFemale = lateStats.female + halfDayStats.female;

    const latePercentage = currentShiftEmployees.size > 0
      ? ((totalLateCount / currentShiftEmployees.size) * 100).toFixed(1) + "%"
      : "0.0%";

    /* ------------------ 7. RETURN DASHBOARD OBJECT ------------------ */
    return {
      currentShift: currentShiftName,
      updatedAt: new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" }),

      totalEmployees: {
        male: totalStats.male,
        female: totalStats.female,
        total: totalStats.total,
        format: () => `M: ${totalStats.male} | F: ${totalStats.female}`
      },

      present: {
        total: presentStats.total,
        onTime: onTimeStats.total,
        late: lateStats.total,
        halfDay: halfDayStats.total,
        male: presentStats.male,
        female: presentStats.female,
        format: () => `On Time: ${onTimeStats.total} | Late: ${lateStats.total} | Half: ${halfDayStats.total}`
      },

      absent: {
        male: absentStats.male,
        female: absentStats.female,
        total: absentStats.total,
        format: () => `M: ${absentStats.male} | F: ${absentStats.female}`
      },

      restDayShift: {
        male: rdStats.male,
        female: rdStats.female,
        total: rdStats.total,
        todayFormatted: `${rdStats.total} employee${rdStats.total !== 1 ? "s" : ""} on Rest Day today`,
        format: () => `M: ${rdStats.male} | F: ${rdStats.female}`
      },

      lateComing: {
        male: lateMale,
        female: lateFemale,
        total: totalLateCount,
        percentage: latePercentage,
        format: () => `M: ${lateMale} | F: ${lateFemale} • ${totalLateCount} Late (${latePercentage})`
      },

      _debug: {
        currentShiftEmployees: currentShiftEmployees.size,
        presentTotal: presentAny.size,
        onTime: onTime.size,
        late: late.size,
        halfDay: halfDay.size,
        onRD: rdToday.size,
        employeesCount: empList.length,
        logsCount: logList.length,
        shiftRecordsCount: shiftList.length,
        today,
        todayDay,
        monthYear,
        serverTime: new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" }),

        // THEMKA 1165 DEBUG
        themika1165: {
          inEmployees: empList.some(e => String(e.id) === "1165"),
          inLogs: logList.some(l => String(l.employee_id) === "1165"),
          punchTime: logList.find(l => String(l.employee_id) === "1165")?.timestamp || null,
          inCurrentShift: currentShiftEmployees.has("1165"),
          inRD: rdToday.has("1165"),
          firstPunch: firstValidPunch["1165"]
            ? new Date(firstValidPunch["1165"].timestamp).toLocaleTimeString("en-US", { timeZone: "Asia/Colombo" })
            : null,
          status: firstValidPunch["1165"]
            ? getAttendanceStatus(firstValidPunch["1165"].timestamp, cfg)
            : null
        }
      }
    };

  } catch (error) {
    console.error("getDashboardStats error:", error);
    throw error;
  }
};