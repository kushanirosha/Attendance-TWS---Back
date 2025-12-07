// services/statsService.js
import { supabase } from "../config/db.js";
import { getStlActiveNowCount } from "./attendanceStlService.js";
import { getAdminActiveNowCount } from "./attendanceAdminService.js";
import { getLtlActiveNowCount } from "./attendanceLtlService.js";
import { getSpecialEmployeesActiveNowCount } from "./attendanceSpecialService.js";
import { getActiveNowCount } from "./activeNowService.js";
import { getAttendanceLogs } from "../services/attendanceService.js";  // ← YOUR PERFECT FILE

const COLOMBO_TZ = "Asia/Colombo";
const getColomboTime = (date = new Date()) => {
  return new Date(date.toLocaleString("en-US", { timeZone: COLOMBO_TZ }));
};

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

const getCurrentShift = () => {
  const colombo = getColomboTime();
  const minutes = colombo.getHours() * 60 + colombo.getMinutes();
  if (minutes >= 330 && minutes < 810) return "Morning";
  if (minutes >= 810) return "Noon";
  return "Night";
};

export const getDashboardStats = async () => {
  const currentShiftName = getCurrentShift();
  const today = getTodayDateString();
  const monthYear = getCurrentMonthYear();
  const todayDay = getTodayDay();

  const shiftMap = { A: "Morning", B: "Noon", C: "Night" };
  const currentShiftCode = Object.keys(shiftMap).find(k => shiftMap[k] === currentShiftName);

  try {
    const activeNow = await getActiveNowCount();
    const attendanceLogs = await getAttendanceLogs();  // ← YOUR PERFECT LOGIC

    const [
      { data: employeesAll = [] },
      { data: employeesWithProject = [] },
      { data: shiftRecords = [] },
      stlResult,
      adminResult,
      ltlResult
    ] = await Promise.all([
      supabase.from("employees").select("id, gender"),
      supabase.from("employees").select("id, gender, project"),
      supabase.from("shift_assignments").select("assignments").eq("month_year", monthYear),
      getStlActiveNowCount().catch(() => ({ total: 0, male: 0, female: 0, activeEmployeeIds: [] })),
      getAdminActiveNowCount().catch(() => ({ total: 0, male: 0, female: 0, activeEmployeeIds: [] })),
      getLtlActiveNowCount().catch(() => ({ total: 0, male: 0, female: 0, activeEmployeeIds: [] }))
    ]);

    const specialResult = await getSpecialEmployeesActiveNowCount();
    const specialActiveObj = specialResult || { total: 0, male: 0, female: 0, activeEmployeeIds: [] };

    const EXCLUDED_PROJECTS = new Set(["TTL", "STL", "ASS. TL", "TL", "ADMIN", "CLEANING", "LTL"]);
    const excludedForPresentIds = new Set([
      "1007",
      ...employeesWithProject
        .filter(emp => emp.project && EXCLUDED_PROJECTS.has(emp.project.trim()))
        .map(emp => String(emp.id))
    ]);

    const specialEmployeeIds = new Set([
      ...(stlResult?.activeEmployeeIds || []),
      ...(adminResult?.activeEmployeeIds || []),
      ...(ltlResult?.activeEmployeeIds || []),
      ...(specialActiveObj?.activeEmployeeIds || []),
      ...excludedForPresentIds
    ]);

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

    const activeIds = new Set(activeNow.activeEmployeeIds?.map(String) || []);
    const presentInShift = new Set([...activeIds].filter(id => currentShiftEmployees.has(id)));

    const absentInShift = new Set(
      [...currentShiftEmployees]
        .filter(id => !presentInShift.has(id))
        .filter(id => !rdToday.has(id))
        .filter(id => !specialEmployeeIds.has(id))
        .filter(id => id !== "1007")
    );

    const maleIds = new Set(employeesAll.filter(e => e?.gender === "Male").map(e => String(e.id)));
    const femaleIds = new Set(employeesAll.filter(e => e?.gender === "Female").map(e => String(e.id)));

    const countGenderSet = (set) => {
      if (!set?.size) return { male: 0, female: 0, total: 0 };
      const m = [...set].filter(id => maleIds.has(id)).length;
      const f = [...set].filter(id => femaleIds.has(id)).length;
      return { male: m, female: f, total: set.size };
    };

    const absentStats = countGenderSet(absentInShift);
    const rdStats = countGenderSet(rdToday);
    const absentIds = [...absentInShift].sort((a, b) => a - b);

    // USE YOUR PERFECT attendance.js LOGIC FOR LATE COUNT
    const lateCount = attendanceLogs.filter(log => 
      log.status === "Late" || log.status === "Half day"
    ).length;

    const onTimeCount = attendanceLogs.filter(log => 
      log.status === "On time"
    ).length;

    const finalPresentTotal = activeNow.total || 0;
    const finalPresentMale = activeNow.male || 0;
    const finalPresentFemale = activeNow.female || 0;

    console.log(`\nLATE TODAY: ${lateCount} | ON TIME: ${onTimeCount} | TOTAL LOGS: ${attendanceLogs.length}`);

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
        regular: finalPresentTotal - (stlResult.total + adminResult.total + ltlResult.total + specialActiveObj.total),
        stlActive: stlResult.total || 0,
        adminActive: adminResult.total || 0,
        ltlActive: ltlResult.total || 0,
        special: specialActiveObj.total || 0,
        male: finalPresentMale,
        female: finalPresentFemale,
        onTime: onTimeCount,
        late: lateCount,
        halfDay: attendanceLogs.filter(l => l.status === "Half day").length,
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
        total: lateCount,
        percentage: (onTimeCount + lateCount) > 0
          ? ((lateCount / (onTimeCount + lateCount)) * 100).toFixed(1) + "%"
          : "0.0%",
        male: 0,
        female: 0,
      },
    };

  } catch (error) {
    console.error("getDashboardStats error:", error);
    throw error;
  }
};