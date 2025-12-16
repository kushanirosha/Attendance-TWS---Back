// services/restDayService.js
import { supabase } from "../config/db.js";

const countGender = (set, maleIds, femaleIds) => ({
  male: [...set].filter(id => maleIds.has(id)).length,
  female: [...set].filter(id => femaleIds.has(id)).length,
  total: set.size
});

export const getRestDayStatsForShift = async (
  currentShiftCode,
  operationalDate,
  // We keep excludedIds for consistency, but we'll IGNORE it for RD calculation
  excludedIds, // ← Not used for RD anymore
  maleIds,
  femaleIds
) => {
  // Calculate yesterday's operational date
  const todayDate = new Date(operationalDate);
  const yesterdayDate = new Date(todayDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10); // YYYY-MM-DD
  const yesterdayMonthYear = yesterday.slice(0, 7);
  const yesterdayDayPadded = yesterday.split("-")[2];
  const yesterdayDayRaw = yesterdayDayPadded.replace(/^0/, '');

  // Today's details
  const monthYear = operationalDate.slice(0, 7);
  const todayDayPadded = operationalDate.split("-")[2];
  const todayDayRaw = todayDayPadded.replace(/^0/, '');

  // Fetch shift assignments for both today and yesterday
  const [
    { data: todayShiftRecords = [] },
    { data: yesterdayShiftRecords = [] }
  ] = await Promise.all([
    supabase.from("shift_assignments").select("assignments").eq("month_year", monthYear),
    supabase.from("shift_assignments").select("assignments").eq("month_year", yesterdayMonthYear)
  ]);

  // Step 1: Find all employees with RD today (NO exclusion of test IDs)
  const restDayToday = new Set();

  for (const record of todayShiftRecords) {
    let assignments;
    try {
      assignments = typeof record.assignments === "string"
        ? JSON.parse(record.assignments)
        : record.assignments;
    } catch (e) {
      console.warn("Failed to parse today's shift assignments:", e);
      continue;
    }

    if (!assignments || typeof assignments !== "object") continue;

    for (const [empId, days] of Object.entries(assignments)) {
      const id = String(empId);

      const shiftValue = days?.[todayDayPadded] ?? days?.[todayDayRaw];
      if (!shiftValue) continue;

      const val = String(shiftValue).trim().toUpperCase();

      if (val === "RD") {
        restDayToday.add(id);
      }
    }
  }

  // Step 2: Among RD employees today, find those whose YESTERDAY shift was the current shift (A/B/C)
  const restDayForThisShift = new Set();

  for (const record of yesterdayShiftRecords) {
    let assignments;
    try {
      assignments = typeof record.assignments === "string"
        ? JSON.parse(record.assignments)
        : record.assignments;
    } catch (e) {
      console.warn("Failed to parse yesterday's shift assignments:", e);
      continue;
    }

    if (!assignments || typeof assignments !== "object") continue;

    for (const id of restDayToday) {
      const days = assignments[id];
      if (!days) continue;

      const shiftValue = days?.[yesterdayDayPadded] ?? days?.[yesterdayDayRaw];
      if (!shiftValue) continue;

      const val = String(shiftValue).trim().toUpperCase();

      if (val === currentShiftCode) {
        restDayForThisShift.add(id);
      }
    }
  }

  // Return gender breakdown (test employees now INCLUDED in RD count)
  return countGender(restDayForThisShift, maleIds, femaleIds);
};