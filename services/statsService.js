// services/statsService.js
import { supabase } from "../config/db.js";
import { getActiveNowCount } from "./activeNowService.js";
import { getAttendanceLogs } from "./attendanceService.js";
import { getCurrentShiftAndDate } from '../utils/getCurrentShift.js';

export const getDashboardStats = async () => {
  const { currentShift, shiftDate } = getCurrentShiftAndDate();
  const operationalDate = shiftDate;
  
  const colomboNow = new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" });
  const calendarDate = colomboNow.split(",")[0].trim();
  const [month, day, year] = calendarDate.split("/");
  const displayDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

  const today = operationalDate;
  const monthYear = today.slice(0, 7);
  const todayDayPadded = today.split("-")[2];
  const todayDayRaw = todayDayPadded.replace(/^0/, '');

  console.log("=== DATE DEBUG ===");
  console.log("Operational Date (for shift logic):", today);
  console.log("Calendar Date (what people see):   ", displayDate);
  console.log("Current Shift:", currentShift);
  console.log("Colombo Time Now:", new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
  console.log("================\n");

  const shiftNameToCode = { Morning: "A", Noon: "B", Night: "C", morning: "A", noon: "B", night: "C" };
  const currentShiftCode = shiftNameToCode[currentShift];

  // Only exclude specific employee IDs (e.g., test/fake accounts)
  const EXCLUDED_EMPLOYEE_IDS = new Set(["1007"]);

  // These projects are NO LONGER excluded from shift logic (TL, ADMIN, etc. will now be counted)
  const EXCLUDED_PROJECTS = new Set([]); // ← Now empty! Or keep only if you still want to filter something else

  try {
    const [
      activeNowResult,
      attendanceLogs,
      { data: employeesAll = [] },
      { data: employeesWithProject = [] },
      { data: shiftRecords = [] }
    ] = await Promise.all([
      getActiveNowCount(),
      getAttendanceLogs(today),
      supabase.from("employees").select("id, gender"),
      supabase.from("employees").select("id, project"),
      supabase.from("shift_assignments").select("assignments").eq("month_year", monthYear)
    ]);

    const activeNow = activeNowResult || { total: 0, male: 0, female: 0, activeEmployeeIds: [] };
    const presentIds = new Set(activeNow.activeEmployeeIds.map(String));

    // === Only exclude specific employee IDs (like test accounts), NOT project-based roles ===
    const excludedIds = new Set(
      employeesWithProject
        .filter(e => EXCLUDED_EMPLOYEE_IDS.has(String(e.id)))
        .map(e => String(e.id))
    );

    // === Parse shift assignments (now includes TL, ADMIN, etc.) ===
    const scheduledToday = new Set();
    const restDayToday = new Set();

    for (const record of shiftRecords || []) {
      let assignments;
      try {
        assignments = typeof record.assignments === "string"
          ? JSON.parse(record.assignments)
          : record.assignments;
      } catch (e) {
        console.warn("Failed to parse shift assignments:", e);
        continue;
      }

      if (!assignments || typeof assignments !== "object") continue;

      for (const [empId, days] of Object.entries(assignments)) {
        const id = String(empId);

        // Only skip explicitly excluded IDs (e.g., test employees)
        if (excludedIds.has(id)) continue;

        const shiftValue = days?.[todayDayPadded] ?? days?.[todayDayRaw];
        if (!shiftValue) continue;

        const val = String(shiftValue).trim().toUpperCase();

        if (val === "RD") {
          restDayToday.add(id);
        } else if (val === currentShiftCode) {
          scheduledToday.add(id);
        }
      }
    }

    // === Absent = Scheduled today BUT NOT present ===
    const absentIds = new Set();
    for (const id of scheduledToday) {
      if (!presentIds.has(id)) {
        absentIds.add(id);
      }
    }
    const sortedAbsentIds = [...absentIds].sort((a, b) => Number(a) - Number(b));

    // === Gender sets ===
    const maleIds = new Set(employeesAll.filter(e => e.gender === "Male").map(e => String(e.id)));
    const femaleIds = new Set(employeesAll.filter(e => e.gender === "Female").map(e => String(e.id)));

    const countGender = (set) => ({
      male: [...set].filter(id => maleIds.has(id)).length,
      female: [...set].filter(id => femaleIds.has(id)).length,
      total: set.size
    });

    const absentStats = countGender(absentIds);
    const restDayStats = countGender(restDayToday);

    // === Late count: Now includes TL, ADMIN, etc. if they are scheduled & have logs ===
    const scheduledEmployeeIds = new Set([...scheduledToday]);
    const scheduledLogs = attendanceLogs.filter(log => {
      const empId = String(log.employee_id || log.id);
      return scheduledEmployeeIds.has(empId);
    });

    const lateLogs = scheduledLogs.filter(l => l.status === "Late" || l.status === "Half day");
    const lateCount = lateLogs.length;

    const lateMaleCount = lateLogs.filter(l => {
      const id = String(l.employee_id || l.id);
      return maleIds.has(id);
    }).length;

    const lateFemaleCount = lateLogs.filter(l => {
      const id = String(l.employee_id || l.id);
      return femaleIds.has(id);
    }).length;

    const onTimeOrLateTotal = scheduledLogs.length;
    const latePercentage = onTimeOrLateTotal > 0
      ? ((lateCount / onTimeOrLateTotal) * 100).toFixed(1) + "%"
      : "0.0%";

    // === Final Response ===
    return {
      currentShift,
      shiftDate: today,
      updatedAt: new Date().toISOString(),

      totalEmployees: {
        male: maleIds.size,
        female: femaleIds.size,
        total: employeesAll.length,
      },

      present: {
        total: activeNow.total,
        male: activeNow.male,
        female: activeNow.female,
      },

      absent: {
        total: absentStats.total,
        male: absentStats.male,
        female: absentStats.female,
        ids: sortedAbsentIds,
      },

      restDayShift: {
        total: restDayStats.total,
        male: restDayStats.male,
        female: restDayStats.female,
      },

      lateComing: {
        total: lateCount,
        male: lateMaleCount,
        female: lateFemaleCount,
        percentage: latePercentage,
      },

      _debug: {
        currentShiftCode,
        scheduledCount: scheduledToday.size,
        restDayCount: restDayToday.size,
        presentInFactoryCount: activeNow.total,
        absentCount: absentIds.size,
        lateCount,
        scheduledLogsCount: scheduledLogs.length,
        message: "TL, ADMIN, LTL, etc. are NOW INCLUDED in Absent/Late/RestDay counts"
      }
    };

  } catch (error) {
    console.error("getDashboardStats error:", error);
    throw error;
  }
};