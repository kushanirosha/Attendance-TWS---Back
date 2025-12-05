// services/statsService.js
import { supabase } from "../config/db.js";
import { getStlActiveNowCount } from "./attendanceStlService.js";
import { getAdminActiveNowCount } from "./attendanceAdminService.js";
import { getLtlActiveNowCount } from "./attendanceLtlService.js";
import { getSpecialEmployeesActiveNowCount } from "./attendanceSpecialService.js";

/* -------------------------------------------------
   BULLETPROOF COLOMBO TIMEZONE HELPER
   ------------------------------------------------- */
const COLOMBO_TZ = "Asia/Colombo";

const getColomboTime = (date = new Date()) => {
  return new Date(date.toLocaleString("en-US", { timeZone: COLOMBO_TZ }));
};

// Operational "today" starts at 5:30 AM Colombo time
const getOperationalDate = () => {
  let c = getColomboTime();
  if (c.getHours() < 5 || (c.getHours() === 5 && c.getMinutes() < 30)) {
    c = new Date(c.getTime() - 24 * 60 * 60 * 1000);
  }
  return c;
};

const getTodayDateString = () => getOperationalDate().toISOString().split("T")[0];
const getCurrentMonthYear = () => {
  const d = getOperationalDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const getTodayDay = () => getOperationalDate().getDate().toString();

/* -------------------------------------------------
   SHIFT CONFIG & HELPERS
   ------------------------------------------------- */
const SHIFT_CONFIG = {
  Morning: { early: 4 * 60 + 30, onTimeEnd: 5 * 60 + 30, lateEnd: 7 * 60 + 30, halfDayEnd: 12 * 60 + 29 },
  Noon:    { early: 12 * 60 + 30, onTimeEnd: 13 * 60 + 30, lateEnd: 15 * 60 + 30, halfDayEnd: 20 * 60 + 29 },
  Night:   { early: 8 * 60 + 0,   onTimeEnd: 21 * 60 + 30, lateEnd: 23 * 60 + 30, halfDayEnd: 4 * 60 + 29, nextDayWrap: true },
};

const getCurrentShift = () => {
  const colombo = getColomboTime();
  const minutes = colombo.getHours() * 60 + colombo.getMinutes();

  if (minutes >= SHIFT_CONFIG.Morning.onTimeEnd && minutes < SHIFT_CONFIG.Noon.onTimeEnd) return "Morning";
  if (minutes >= SHIFT_CONFIG.Noon.onTimeEnd) return "Noon";
  return "Night";
};

const getAttendanceStatus = (utcTimestamp, cfg) => {
  const d = getColomboTime(new Date(utcTimestamp));
  let totalMinutes = d.getHours() * 60 + d.getMinutes();

  if (cfg.nextDayWrap && totalMinutes < 300) totalMinutes += 1440;

  if (totalMinutes < cfg.early) return null;
  if (totalMinutes <= cfg.onTimeEnd) return "onTime";
  if (totalMinutes <= cfg.lateEnd) return "late";
  if (totalMinutes <= cfg.halfDayEnd + (cfg.nextDayWrap ? 1440 : 0)) return "halfDay";
  return null;
};

/* -------------------------------------------------
   MAIN EXPORT - FULLY FIXED
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
    const [
      { data: employeesAll = [] },
      { data: employeesWithProject = [] },
      { data: shiftRecords = [] },
      { data: logs = [] },
      stlResult,
      adminResult,
      ltlResult
    ] = await Promise.all([
      supabase.from("employees").select("id, gender"),
      supabase.from("employees").select("id, gender, project"),
      supabase.from("shift_assignments").select("assignments").eq("month_year", monthYear),

      // FINAL FIX — NIGHT SHIFT LOGS FROM 8:00 AM PREVIOUS DAY
      (async () => {
        const now = getColomboTime();

        // Operational day: 5:30 AM → 5:30 AM
        let operationalStart = new Date(now);
        if (now.getHours() < 5 || (now.getHours() === 5 && now.getMinutes() < 30)) {
          operationalStart.setDate(operationalStart.getDate() - 1);
        }
        operationalStart.setHours(5, 30, 0, 0);

        const operationalEnd = new Date(operationalStart);
        operationalEnd.setDate(operationalEnd.getDate() + 1);

        let logStart = operationalStart;
        if (currentShiftName === "Night") {
          logStart = new Date(operationalStart);
          logStart.setDate(logStart.getDate() - 1);
          logStart.setHours(8, 0, 0, 0);  // ← 8:00 AM previous day
        }

        const startUTC = new Date(logStart.getTime() - 5.5 * 3600000).toISOString().slice(0, 19);
        const endUTC   = new Date(operationalEnd.getTime() - 5.5 * 3600000).toISOString().slice(0, 19);

        return supabase
          .from("attendance_logs_check_in")
          .select("employee_id, timestamp")
          .eq("event_type", "check_in")
          .gte("timestamp", startUTC)
          .lt("timestamp", endUTC);
      })(),

      getStlActiveNowCount().catch(() => ({ total: 0, male: 0, female: 0, activeEmployeeIds: [] })),
      getAdminActiveNowCount().catch(() => ({ total: 0, male: 0, female: 0, activeEmployeeIds: [] })),
      getLtlActiveNowCount().catch(() => ({ total: 0, male: 0, female: 0, activeEmployeeIds: [] }))
    ]);

    const specialResult = await getSpecialEmployeesActiveNowCount();
    const specialActiveObj = specialResult || { total: 0, male: 0, female: 0, activeEmployeeIds: [] };

    /* ------------------ EXCLUSIONS & SPECIAL ROLES ------------------ */
    const EXCLUDED_PROJECTS = new Set(["TTL", "STL", "ASS. TL", "TL", "ADMIN", "CLEANING", "LTL"]);
    const excludedForPresentIds = new Set([
      "1007",
      ...employeesWithProject
        .filter(emp => emp.project && EXCLUDED_PROJECTS.has(emp.project.trim()))
        .map(emp => String(emp.id))
    ]);

    // All special employees (active or not) must be excluded from absent list
    const specialEmployeeIds = new Set([
      ...(stlResult?.activeEmployeeIds || []),
      ...(adminResult?.activeEmployeeIds || []),
      ...(ltlResult?.activeEmployeeIds || []),
      ...(specialActiveObj?.activeEmployeeIds || []),
      ...excludedForPresentIds
    ]);

    /* ------------------ SPECIAL COUNTS ------------------ */
    const stlActiveCount = stlResult.total || 0;
    const adminActiveCount = adminResult.total || 0;
    const ltlActiveCount = ltlResult.total || 0;
    const specialActive = specialActiveObj.total || 0;

    const stlMale = stlResult.male || 0;
    const stlFemale = stlResult.female || 0;
    const adminMale = adminResult.male || 0;
    const adminFemale = adminResult.female || 0;
    const ltlMale = ltlResult.male || 0;
    const ltlFemale = ltlResult.female || 0;
    const specialMale = specialActiveObj.male || 0;
    const specialFemale = specialActiveObj.female || 0;

    const logList = Array.isArray(logs) ? logs : [];

    /* ------------------ FIRST VALID PUNCH ------------------ */
    const firstValidPunch = {};
    logList.forEach(log => {
      const empId = String(log.employee_id);
      if (firstValidPunch[empId]) return;
      const status = getAttendanceStatus(log.timestamp, cfg);
      if (status) firstValidPunch[empId] = log;
    });

    /* ------------------ CLASSIFY ATTENDANCE ------------------ */
    const presentAny = new Set();
    const onTime = new Set(), late = new Set(), halfDay = new Set();

    Object.entries(firstValidPunch).forEach(([empId]) => {
      const status = getAttendanceStatus(firstValidPunch[empId].timestamp, cfg);
      if (!status) return;
      presentAny.add(empId);
      if (status === "onTime") onTime.add(empId);
      if (status === "late") late.add(empId);
      if (status === "halfDay") halfDay.add(empId);
    });

    /* ------------------ SHIFT ASSIGNMENTS ------------------ */
    const currentShiftEmployees = new Set();
    const rdToday = new Set();

    (shiftRecords || []).forEach(record => {
      let assignments;
      try {
        assignments = typeof record.assignments === "string" ? JSON.parse(record.assignments) : record.assignments;
      } catch (e) { return; }
      if (!assignments || typeof assignments !== "object") return;

      Object.entries(assignments).forEach(([empId, days]) => {
        const id = String(empId);
        const shiftToday = days?.[todayDay];
        if (!shiftToday) return;

        if (shiftToday === "RD") rdToday.add(id);
        else if (shiftToday === currentShiftCode || shiftMap[shiftToday] === currentShiftName)
          currentShiftEmployees.add(id);
      });
    });

    /* ------------------ GENDER HELPERS ------------------ */
    const maleIds = new Set(employeesAll.filter(e => e?.gender === "Male").map(e => String(e.id)));
    const femaleIds = new Set(employeesAll.filter(e => e?.gender === "Female").map(e => String(e.id)));

    const countGenderSet = (set) => {
      if (!set?.size) return { male: 0, female: 0, total: 0 };
      const m = [...set].filter(id => maleIds.has(id)).length;
      const f = [...set].filter(id => femaleIds.has(id)).length;
      return { male: m, female: f, total: set.size };
    };

    /* ------------------ FINAL CALCULATIONS ------------------ */
    const presentInCurrentShiftRegular = new Set(
      [...presentAny]
        .filter(id => currentShiftEmployees.has(id))
        .filter(id => !excludedForPresentIds.has(id))
    );

    const presentStats = countGenderSet(presentInCurrentShiftRegular);
    const allPresentInShift = new Set([...presentAny].filter(id => currentShiftEmployees.has(id)));

    // FIXED: Special employees (LTL/STL/ADMIN) excluded from absent list
    const absentInShift = new Set(
      [...currentShiftEmployees]
        .filter(id => !allPresentInShift.has(id))
        .filter(id => !rdToday.has(id))
        .filter(id => !specialEmployeeIds.has(id))  // This removes false absentees
        .filter(id => id !== "1007")
    );

    const onTimeInShift = new Set([...onTime].filter(id => currentShiftEmployees.has(id)));
    const lateInShift = new Set([...late].filter(id => currentShiftEmployees.has(id)));
    const halfDayInShift = new Set([...halfDay].filter(id => currentShiftEmployees.has(id)));

    const absentStats = countGenderSet(absentInShift);
    const rdStats = countGenderSet(rdToday);
    const onTimeStats = countGenderSet(onTimeInShift);
    const lateStats = countGenderSet(lateInShift);
    const halfDayStats = countGenderSet(halfDayInShift);

    const absentIds = [...absentInShift].sort((a, b) => a - b);
    console.log(`\nABSENT TODAY (${absentIds.length}): ${absentIds.join(", ") || "None"}\n`);

    const latePercentage = currentShiftEmployees.size > 0
      ? ((lateStats.total / currentShiftEmployees.size) * 100).toFixed(1) + "%"
      : "0.0%";

    const finalPresentTotal = presentStats.total + stlActiveCount + adminActiveCount + ltlActiveCount + specialActive;
    const finalPresentMale = presentStats.male + stlMale + adminMale + ltlMale + specialMale;
    const finalPresentFemale = presentStats.female + stlFemale + adminFemale + ltlFemale + specialFemale;

    /* ------------------ RETURN ------------------ */
    return {
      currentShift: currentShiftName,
      updatedAt: getColomboTime().toLocaleString("en-US", { timeZone: COLOMBO_TZ }),

      totalEmployees: {
        male: employeesAll.filter(e => e.gender === "Male").length,
        female: employeesAll.filter(e => e.gender === "Female").length,
        total: employeesAll.length,
      },

      present: {
        total: finalPresentTotal,
        regular: presentStats.total,
        stlActive: stlActiveCount,
        adminActive: adminActiveCount,
        ltlActive: ltlActiveCount,
        special: specialActive,
        male: finalPresentMale,
        female: finalPresentFemale,
        onTime: onTimeStats.total,
        late: lateStats.total,
        halfDay: halfDayStats.total,
      },

      absent: {
        male: absentStats.male,
        female: absentStats.female,
        total: absentStats.total,
        ids: absentIds,
      },

      restDayShift: {
        male: rdStats.male,
        female: rdStats.female,
        total: rdStats.total,
      },

      lateComing: {
        total: lateStats.total,
        percentage: latePercentage,
        male: lateStats.male,
        female: lateStats.female,
      },

      _debug: {
        today,
        operationalDayStart: getOperationalDate().toLocaleDateString(),
        currentShiftScheduled: currentShiftEmployees.size,
        logFetchWindow: currentShiftName === "Night" ? "8:30 PM prev day → 5:30 AM today" : "5:30 AM → 5:30 AM",
      }
    };

  } catch (error) {
    console.error("getDashboardStats error:", error);
    throw error;
  }
};