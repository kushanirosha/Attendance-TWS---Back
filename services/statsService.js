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

export const getDashboardStats = async () => {
  const currentShift = getCurrentShift();
  const today = getTodayDateString();
  const monthYear = getCurrentMonthYear();
  const todayDay = getTodayDay();

  try {
    // 1. Get ALL employees
    const { data: employees } = await supabase
      .from("employees")
      .select("id, gender");

    // 2. Get shift assignments
    const { data: shiftRecords } = await supabase
      .from("shift_assignments")
      .select("assignments")
      .eq("month_year", monthYear);

    // 3. Get today's logs
    const { data: logs } = await supabase
      .from("attendance_logs")
      .select("employee_id")
      .gte("timestamp", `${today}T00:00:00+00`)
      .lte("timestamp", `${today}T23:59:59+00`);

    // Map shift codes
    const shiftMap = { A: "Morning", B: "Noon", C: "Night" };
    const currentShiftCode = Object.keys(shiftMap).find(key => shiftMap[key] === currentShift);

    // Sets
    const presentToday = new Set(logs?.map(l => l.employee_id.toString()) || []);
    const currentShiftEmployees = new Set();
    const rdToday = new Set();

    // Parse assignments
    shiftRecords?.forEach(record => {
      let assignments;
      try {
        assignments = typeof record.assignments === "string"
          ? JSON.parse(record.assignments)
          : record.assignments;
      } catch { return; }

      Object.entries(assignments).forEach(([empId, days]) => {
        const shiftToday = days[todayDay];
        if (shiftToday === currentShiftCode || shiftMap[shiftToday] === currentShift) {
          currentShiftEmployees.add(empId);
        }
        if (shiftToday === "RD") {
          rdToday.add(empId);
        }
      });
    });

    // Gender counts
    const maleIds = new Set(employees.filter(e => e.gender === "Male").map(e => e.id.toString()));
    const femaleIds = new Set(employees.filter(e => e.gender === "Female").map(e => e.id.toString()));

    const countGender = (set) => ({
      male: [...set].filter(id => maleIds.has(id)).length,
      female: [...set].filter(id => femaleIds.has(id)).length,
      total: set.size
    });

    const presentStats = countGender(new Set([...currentShiftEmployees].filter(id => presentToday.has(id))));
    const absentStats = countGender(new Set([...currentShiftEmployees].filter(id => !presentToday.has(id))));
    const rdStats = countGender(rdToday);
    const totalStats = countGender(new Set(employees.map(e => e.id.toString())));

    return {
      currentShift,
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
        today: rdStats.total,
        todayFormatted: `${rdStats.total} employee${rdStats.total !== 1 ? "s" : ""} on RD today`,
        format: () => `M: ${rdStats.male} | F: ${rdStats.female}`
      }
    };
  } catch (error) {
    console.error("getDashboardStats error:", error);
    throw error;
  }
};