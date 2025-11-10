// services/statsService.js
import { supabase } from "../config/db.js";

const getTodayDay = () => new Date().getDate().toString();

export const getDashboardStats = async (monthYear) => {
  // 1. Get ALL employees
  const { data: employees, error: empErr } = await supabase
    .from("employees")
    .select("id, gender, status");

  if (empErr) throw empErr;
  if (!employees) throw new Error("No employees found");

  // 2. Get ALL shift assignments for the month
  const { data: shifts, error: shiftErr } = await supabase
    .from("shift_assignments")
    .select("assignments")
    .eq("month_year", monthYear);

  if (shiftErr) throw shiftErr;

  // 3. Count Rest Days (RD)
  const rdByDay = {};
  const today = getTodayDay();

  shifts?.forEach((record) => {
    let assignments;
    try {
      assignments =
        typeof record.assignments === "string"
          ? JSON.parse(record.assignments)
          : record.assignments;
    } catch (e) {
      return;
    }

    Object.values(assignments).forEach((days) => {
      Object.entries(days).forEach(([day, shift]) => {
        if (shift === "RD") {
          rdByDay[day] = (rdByDay[day] || 0) + 1;
        }
      });
    });
  });

  const todayRD = rdByDay[today] || 0;

  // 4. Count employees by gender
  const totalMale = employees.filter(e => e.gender === "Male").length;
  const totalFemale = employees.filter(e => e.gender === "Female").length;
  const totalEmployees = employees.length;

  const activeMale = employees.filter(e => e.status === "Active" && e.gender === "Male").length;
  const activeFemale = employees.filter(e => e.status === "Active" && e.gender === "Female").length;
  const totalActive = activeMale + activeFemale;

  return {
    totalEmployees: {
      male: totalMale,
      female: totalFemale,
      total: totalEmployees,
      format: () => `M: ${totalMale} | F: ${totalFemale}`,
    },
    totalActive: {
      male: activeMale,
      female: activeFemale,
      total: totalActive,
      format: () => `M: ${activeMale} | F: ${activeFemale}`,
    },
    restDayShift: {
      today: todayRD,
      todayFormatted: `${todayRD} employee${todayRD !== 1 ? "s" : ""} on RD today`,
      byDay: rdByDay,
      formatToday: () => `${todayRD}`,
    },
  };
};