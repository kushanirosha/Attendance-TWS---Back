// services/statsService.js
import { supabase } from "../config/db.js";
import { getStlActiveNowCount } from "./attendanceStlService.js";     // STL
import { getAdminActiveNowCount } from "./attendanceAdminService.js"; // ADMIN
import { getLtlActiveNowCount } from "./attendanceLtlService.js";     // LTL (ASS.TL, TL, TTL)
import { CLIENT_RENEG_LIMIT } from "tls";

/* -------------------------------------------------
   SHIFT CONFIG – early window & time bands (minutes)
   ------------------------------------------------- */
const SHIFT_CONFIG = {
  Morning: { early: 4 * 60 + 30, onTimeEnd: 5 * 60 + 30, lateEnd: 7 * 60 + 30, halfDayEnd: 12 * 60 + 29 },
  Noon: { early: 12 * 60 + 30, onTimeEnd: 13 * 60 + 30, lateEnd: 15 * 60 + 30, halfDayEnd: 20 * 60 + 29 },
  Night: { early: 20 * 60 + 30, onTimeEnd: 21 * 60 + 30, lateEnd: 23 * 60 + 30, halfDayEnd: 4 * 60 + 29, nextDayWrap: true },
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
  return colombo.toISOString().split("T")[0];
};

const getCurrentMonthYear = () => {
  const now = new Date();
  const colombo = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
  return `${colombo.getFullYear()}-${String(colombo.getMonth() + 1).padStart(2, "0")}`;
};

const getTodayDay = () => {
  const now = new Date();
  const colombo = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
  return colombo.getDate().toString();
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

  const today = getTodayDateString();
  const monthYear = getCurrentMonthYear();
  const todayDay = getTodayDay();

  const shiftMap = { A: "Morning", B: "Noon", C: "Night" };
  const currentShiftCode = Object.keys(shiftMap).find(k => shiftMap[k] === currentShiftName);

  try {
    /* ------------------ 1. FETCH RAW DATA ------------------ */
    const [
      { data: employees = [] },
      { data: shiftRecords = [] },
      { data: logs = [] },
      stlResult,
      adminResult,
      ltlResult
    ] = await Promise.all([
      supabase.from("employees").select("id, gender"),
      supabase.from("shift_assignments").select("assignments").eq("month_year", monthYear),

      // Check-in logs for current shift day (Colombo midnight to midnight)
      (async () => {
        const colomboMidnight = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
        colomboMidnight.setHours(0, 0, 0, 0);
        const nextDayMidnight = new Date(colomboMidnight);
        nextDayMidnight.setDate(nextDayMidnight.getDate() + 1);
        const startUTC = colomboMidnight.toISOString().slice(0, 19);
        const endUTC = nextDayMidnight.toISOString().slice(0, 19);
        return supabase
          .from("attendance_logs_check_in")
          .select("employee_id, timestamp")
          .eq("event_type", "check_in")
          .gte("timestamp", startUTC)
          .lt("timestamp", endUTC);
      })(),

      // STL: 48-hour active window
      getStlActiveNowCount().catch(err => {
        console.warn('STL service failed:', err.message);
        return { total: 0, male: 0, female: 0 };
      }),

      // ADMIN: 24-hour active window
      getAdminActiveNowCount().catch(err => {
        console.warn('ADMIN service failed:', err.message);
        return { total: 0, male: 0, female: 0 };
      }),

      // LTL (ASS.TL, TL, TTL): check-in + check-out within 18 hours
      getLtlActiveNowCount().catch(err => {
        console.warn('LTL service failed:', err.message);
        return { total: 0, male: 0, female: 0 };
      })
    ]);

    // Extract counts
    const stlActiveCount = stlResult.total || 0;
    const stlMale = stlResult.male || 0;
    const stlFemale = stlResult.female || 0;

    const adminActiveCount = adminResult.total || 0;
    const adminMale = adminResult.male || 0;
    const adminFemale = adminResult.female || 0;

    const ltlActiveCount = ltlResult.total || 0;
    const ltlMale = ltlResult.male || 0;
    const ltlFemale = ltlResult.female || 0;

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
        assignments = typeof record.assignments === "string" ? JSON.parse(record.assignments) : record.assignments;
      } catch (e) { console.warn("Parse error:", e); return; }
      if (!assignments || typeof assignments !== "object") return;

      Object.entries(assignments).forEach(([empId, days]) => {
        const shiftToday = days?.[todayDay];
        if (!shiftToday) return;
        const id = String(empId);
        if (shiftToday === "RD") rdToday.add(id);
        else if (shiftToday === currentShiftCode || shiftMap[shiftToday] === currentShiftName) {
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

    // TOTAL EMPLOYEES
    const totalStats = countGender(new Set(empList.map(e => String(e.id))));

    // PRESENT = current shift only (regular employees)
    const presentInCurrentShift = new Set([...presentAny].filter(id => currentShiftEmployees.has(id)));
    const presentStats = countGender(presentInCurrentShift);

    console.log("Present Employee IDs (Regular Shift):", [...presentInCurrentShift]);

    // FINAL TOTAL = Regular + STL + Admin + LTL
    const finalPresentTotal = presentStats.total + stlActiveCount + adminActiveCount + ltlActiveCount;

    // COLLECT ALL PRESENT EMPLOYEE IDs
    const allPresentEmployeeIds = [
      // 1. Regular shift present
      ...presentInCurrentShift,

      // 2. STL active now
      ...(stlResult.activeEmployeeIds || []),

      // 3. Admin active now
      ...(adminResult.activeEmployeeIds || []),

      // 4. LTL active now (ASS.TL, TL, TTL)
      ...(ltlResult.activeEmployeeIds || [])
    ];

    // PRINT THEM BEAUTIFULLY
    console.log(`\nPresent Employees (${allPresentEmployeeIds.length}):`);
    console.log("→ Regular Shift :", [...presentInCurrentShift].sort((a, b) => a - b).join(", "));
    console.log("→ STL Active    :", (stlResult.activeEmployeeIds || []).sort((a, b) => a - b).join(", ") || "none");
    console.log("→ Admin Active  :", (adminResult.activeEmployeeIds || []).sort((a, b) => a - b).join(", ") || "none");
    console.log("→ LTL Active    :", (ltlResult.activeEmployeeIds || []).sort((a, b) => a - b).join(", ") || "none");
    console.log("All Present IDs :", allPresentEmployeeIds.sort((a, b) => a - b).join(", "));
    console.log(`Total Present   : ${finalPresentTotal}\n`);

    // FINAL GENDER BREAKDOWN
    const finalPresentMale = presentStats.male + stlMale + adminMale + ltlMale;
    const finalPresentFemale = presentStats.female + stlFemale + adminFemale + ltlFemale;

    // ON TIME / LATE / HALF-DAY = regular shift only
    const onTimeInShift = new Set([...onTime].filter(id => currentShiftEmployees.has(id)));
    const lateInShift = new Set([...late].filter(id => currentShiftEmployees.has(id)));
    const halfDayInShift = new Set([...halfDay].filter(id => currentShiftEmployees.has(id)));

    const onTimeStats = countGender(onTimeInShift);
    const lateStats = countGender(lateInShift);
    const halfDayStats = countGender(halfDayInShift);

    // ABSENT = current shift - present - RD
    const absentInShift = new Set([...currentShiftEmployees].filter(id => !presentInCurrentShift.has(id) && !rdToday.has(id)));
    const absentStats = countGender(absentInShift);
    const rdStats = countGender(rdToday);

    console.log("Absent employee IDs:", [...absentInShift]);

    /* ------------------ 6. LATE COMING ------------------ */
    const totalLateCount = lateInShift.size;
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
        total: finalPresentTotal,
        regular: presentStats.total,
        stlActive: stlActiveCount,
        adminActive: adminActiveCount,
        ltlActive: ltlActiveCount,                    // New: ASS.TL / TL / TTL
        stlMale, stlFemale,
        adminMale, adminFemale,
        ltlMale, ltlFemale,
        onTime: onTimeStats.total,
        late: lateStats.total,
        halfDay: halfDayStats.total,
        male: finalPresentMale,
        female: finalPresentFemale,
        format: () => `Present: ${finalPresentTotal} (M: ${finalPresentMale} | F: ${finalPresentFemale}) ` +
          `| STL: ${stlActiveCount} | Admin: ${adminActiveCount} | LTL: ${ltlActiveCount} ` +
          `| On Time: ${onTimeStats.total} | Late: ${lateStats.total} | Half: ${halfDayStats.total}`
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
        male: lateStats.male,
        female: lateStats.female,
        total: totalLateCount,
        percentage: latePercentage,
        format: () => `M: ${lateStats.male} | F: ${lateStats.female} • ${totalLateCount} Late (${latePercentage})`
      },

      _debug: {
        currentShiftEmployees: currentShiftEmployees.size,
        presentInCurrentShift: presentInCurrentShift.size,
        stlActiveCount,
        adminActiveCount,
        ltlActiveCount,
        finalPresentTotal,
        finalPresentMale,
        finalPresentFemale,
        absentInShift: absentInShift.size,
        rdToday: rdToday.size,
        employeesCount: empList.length,
        logsCount: logList.length,
        today,
        todayDay,
        serverTime: new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" })
      }
    };

  } catch (error) {
    console.error("getDashboardStats error:", error);
    throw error;
  }
};