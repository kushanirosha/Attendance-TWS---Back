// services/statsService.js
import { supabase } from "../config/db.js";
import { getStlActiveNowCount } from "./attendanceStlService.js";
import { getAdminActiveNowCount } from "./attendanceAdminService.js";
import { getLtlActiveNowCount } from "./attendanceLtlService.js";
import { getSpecialEmployeesActiveNowCount } from "./attendanceSpecialService.js";

/* -------------------------------------------------
   BULLETPROOF COLOMBO TIMEZONE HELPER
   Works on ANY server (cPanel, VPS, localhost)
   ------------------------------------------------- */
const COLOMBO_TZ = "Asia/Colombo";

// Returns a proper Date object in Colombo time
const getColomboTime = (date = new Date()) => {
  return new Date(date.toLocaleString("en-US", { timeZone: COLOMBO_TZ }));
};

// Get today's date string in Colombo (YYYY-MM-DD)
const getTodayDateString = () => getColomboTime().toISOString().split("T")[0];

// Get current month-year (e.g., 2025-11)
const getCurrentMonthYear = () => {
  const c = getColomboTime();
  return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}`;
};

// Get current day of month (1–31)
const getTodayDay = () => getColomboTime().getDate().toString();

/* -------------------------------------------------
   SHIFT CONFIG & HELPERS
   ------------------------------------------------- */
const SHIFT_CONFIG = {
  Morning: { early: 4 * 60 + 30, onTimeEnd: 5 * 60 + 30, lateEnd: 7 * 60 + 30, halfDayEnd: 12 * 60 + 29 },
  Noon: { early: 12 * 60 + 30, onTimeEnd: 13 * 60 + 30, lateEnd: 15 * 60 + 30, halfDayEnd: 20 * 60 + 29 },
  Night: { early: 20 * 60 + 30, onTimeEnd: 21 * 60 + 30, lateEnd: 23 * 60 + 30, halfDayEnd: 4 * 60 + 29, nextDayWrap: true },
};

const getCurrentShift = () => {
  const colombo = getColomboTime();
  const minutes = colombo.getHours() * 60 + colombo.getMinutes();

  if (minutes >= SHIFT_CONFIG.Morning.onTimeEnd && minutes < SHIFT_CONFIG.Noon.onTimeEnd)
    return "Morning";
  if (minutes >= SHIFT_CONFIG.Noon.onTimeEnd) return "Noon";
  return "Night";
};

// Fixed: Now uses Colombo time correctly
const getAttendanceStatus = (utcTimestamp, cfg) => {
  const d = getColomboTime(new Date(utcTimestamp)); // Convert UTC → Colombo
  let totalMinutes = d.getHours() * 60 + d.getMinutes();

  // Handle night shift wrap-around (e.g., 2:00 AM check-in belongs to previous day's Night shift)
  if (cfg.nextDayWrap && totalMinutes < 300) {
    totalMinutes += 1440;
  }

  if (totalMinutes < cfg.early) return null;
  if (totalMinutes <= cfg.onTimeEnd) return "onTime";
  if (totalMinutes <= cfg.lateEnd) return "late";
  if (totalMinutes <= cfg.halfDayEnd + (cfg.nextDayWrap ? 1440 : 0)) return "halfDay";
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

      // Fixed: Properly get today's check-ins in Colombo time
      (async () => {
        const nowColombo = getColomboTime();
        const startOfDayColombo = new Date(nowColombo);
        startOfDayColombo.setHours(0, 0, 0, 0);

        const endOfDayColombo = new Date(startOfDayColombo);
        endOfDayColombo.setDate(endOfDayColombo.getDate() + 1);

        // Convert Colombo midnight → UTC for Supabase query
        const startUTC = new Date(startOfDayColombo.getTime() - 5.5 * 3600000).toISOString().slice(0, 19);
        const endUTC = new Date(endOfDayColombo.getTime() - 5.5 * 3600000).toISOString().slice(0, 19);

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

    /* ------------------ EXCLUSION LOGIC ------------------ */
    const EXCLUDED_PROJECTS = new Set(["TTL", "STL", "ASS. TL", "TL", "ADMIN", "CLEANING"]);
    const HARD_EXCLUDED_ID = "1007";

    const excludedForPresentIds = new Set([
      HARD_EXCLUDED_ID,
      ...employeesWithProject
        .filter(emp => EXCLUDED_PROJECTS.has((emp.project || "").toString().trim()))
        .map(emp => String(emp.id))
    ]);

    /* ------------------ SPECIAL ROLE COUNTS ------------------ */
    const stlActiveCount = stlResult.total || 0;
    const stlMale = stlResult.male || 0;
    const stlFemale = stlResult.female || 0;

    const adminActiveCount = adminResult.total || 0;
    const adminMale = adminResult.male || 0;
    const adminFemale = adminResult.female || 0;

    const ltlActiveCount = ltlResult.total || 0;
    const ltlMale = ltlResult.male || 0;
    const ltlFemale = ltlResult.female || 0;

    const specialResult = await getSpecialEmployeesActiveNowCount();
    const specialActive = specialResult.total || 0;
    const specialMale = specialResult.male || 0;
    const specialFemale = specialResult.female || 0;

    const logList = Array.isArray(logs) ? logs : [];

    /* ------------------ FIRST VALID PUNCH ------------------ */
    const firstValidPunch = {};
    logList.forEach(log => {
      const empId = String(log.employee_id);
      if (firstValidPunch[empId]) return;

      const status = getAttendanceStatus(log.timestamp, cfg);
      if (status) {
        firstValidPunch[empId] = log;
      }
    });

    /* ------------------ CLASSIFY ATTENDANCE ------------------ */
    const presentAny = new Set();
    const onTime = new Set(), late = new Set(), halfDay = new Set();

    Object.entries(firstValidPunch).forEach(([empId, log]) => {
      const status = getAttendanceStatus(log.timestamp, cfg);
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
    const absentInShift = new Set([...currentShiftEmployees]
      .filter(id => !allPresentInShift.has(id) && !rdToday.has(id))
      .filter(id => id !== "1007"));

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
        currentShiftScheduled: currentShiftEmployees.size,
        presentRegularOnly: presentStats.total,
        excludedFromPresentCount: excludedForPresentIds.size,
      }
    };

  } catch (error) {
    console.error("getDashboardStats error:", error);
    throw error;
  }
};