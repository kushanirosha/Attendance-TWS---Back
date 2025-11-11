// services/statsService.js
import { supabase } from "../config/db.js";

const getCurrentShift = () => {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeInMinutes = hour * 60 + minute;

  const morningStart = 5 * 60 + 30; // 05:30
  const noonStart = 13 * 60 + 30;   // 13:30
  const nightStart = 21 * 60 + 30;  // 21:30

  if (timeInMinutes >= morningStart && timeInMinutes < noonStart) {
    return "Morning";
  } else if (timeInMinutes >= noonStart && timeInMinutes < nightStart) {
    return "Noon";
  } else {
    return "Night";
  }
};

const getTodayDateString = () => new Date().toISOString().split("T")[0];
const getCurrentMonthYear = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const getTodayDay = () => new Date().getDate().toString();

// Helper: Determine if a timestamp is "Late"
const getLateStatus = (timestamp) => {
  const date = new Date(timestamp);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  const currentShiftName = getCurrentShift();

  if (currentShiftName === "Morning") {
    return totalMinutes > 330 && totalMinutes <= 749 ? "Late" : null;
  }
  if (currentShiftName === "Noon") {
    return totalMinutes > 810 && totalMinutes <= 1229 ? "Late" : null;
  }
  if (currentShiftName === "Night") {
    if (totalMinutes >= 1230) {
      return totalMinutes > 1290 ? "Late" : null;
    }
    return totalMinutes <= 269 ? "Late" : null;
  }
  return null;
};

export const getDashboardStats = async () => {
  const currentShift = getCurrentShift();
  const today = getTodayDateString();
  const monthYear = getCurrentMonthYear();
  const todayDay = getTodayDay();

  const shiftMap = { A: "Morning", B: "Noon", C: "Night" };
  const currentShiftCode = Object.keys(shiftMap).find(key => shiftMap[key] === currentShift);

  try {
    const [
      { data: employees },
      { data: shiftRecords },
      { data: logs }
    ] = await Promise.all([
      supabase.from("employees").select("id, gender"),
      supabase.from("shift_assignments").select("assignments").eq("month_year", monthYear),
      supabase
        .from("attendance_logs")
        .select("employee_id, timestamp")
        .gte("timestamp", `${today}T00:00:00+00`)
        .lte("timestamp", `${today}T23:59:59+00`)
    ]);

    const presentToday = new Set();
    const latestCheckIn = {};
    logs?.forEach(log => {
      const empId = log.employee_id.toString();
      presentToday.add(empId);
      if (!latestCheckIn[empId] || new Date(log.timestamp) > new Date(latestCheckIn[empId].timestamp)) {
        latestCheckIn[empId] = log;
      }
    });

    const currentShiftEmployees = new Set();
    const rdToday = new Set();

    shiftRecords?.forEach(record => {
      let assignments;
      try {
        assignments = typeof record.assignments === "string" ? JSON.parse(record.assignments) : record.assignments;
      } catch (e) {
        console.warn("Failed to parse assignments JSON", e);
        return;
      }

      Object.entries(assignments).forEach(([empId, days]) => {
        const shiftToday = days[todayDay];
        if (shiftToday === "RD") {
          rdToday.add(empId.toString());
        } else if (shiftToday === currentShiftCode || shiftMap[shiftToday] === currentShift) {
          currentShiftEmployees.add(empId.toString());
        }
      });
    });

    const maleIds = new Set(employees.filter(e => e.gender === "Male").map(e => e.id.toString()));
    const femaleIds = new Set(employees.filter(e => e.gender === "Female").map(e => e.id.toString()));

    const countGender = (set) => {
      const males = [...set].filter(id => maleIds.has(id)).length;
      const females = [...set].filter(id => femaleIds.has(id)).length;
      return { male: males, female: females, total: set.size };
    };

    const totalStats = countGender(new Set(employees.map(e => e.id.toString())));
    const presentStats = countGender(new Set([...currentShiftEmployees].filter(id => presentToday.has(id))));
    const absentStats = countGender(new Set([...currentShiftEmployees].filter(id => !presentToday.has(id) && !rdToday.has(id))));
    const rdStats = countGender(rdToday);

    // LATE COUNT WITH GENDER BREAKDOWN
    let lateCount = 0;
    let lateMale = 0;
    let lateFemale = 0;

    currentShiftEmployees.forEach(empId => {
      if (presentToday.has(empId)) {
        const log = latestCheckIn[empId];
        if (log && getLateStatus(log.timestamp) === "Late") {
          lateCount++;
          if (maleIds.has(empId)) lateMale++;
          if (femaleIds.has(empId)) lateFemale++;
        }
      }
    });

    const latePercentage = currentShiftEmployees.size > 0
      ? ((lateCount / currentShiftEmployees.size) * 100).toFixed(1) + "%"
      : "0%";

    return {
      currentShift,
      updatedAt: new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" }),

      totalEmployees: {
        male: totalStats.male,
        female: totalStats.female,
        total: totalStats.total,
        format: () => `M: ${totalStats.male} | F: ${totalStats.female}`
      },

      present: {
        male: presentStats.male,
        female: presentStats.female,
        total: presentStats.total,
        format: () => `M: ${presentStats.male} | F: ${presentStats.female}`
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

      lateInCurrentShift: {
        count: lateCount,
        male: lateMale,
        female: lateFemale,
        percentage: latePercentage,
        outOf: currentShiftEmployees.size,
        format: () => `M: ${lateMale} | F: ${lateFemale} • ${lateCount} Late (${latePercentage})`
      },

      _debug: {
        currentShiftEmployees: currentShiftEmployees.size,
        presentToday: presentToday.size,
        onRD: rdToday.size,
      }
    };

  } catch (error) {
    console.error("getDashboardStats error:", error);
    throw error;
  }
};