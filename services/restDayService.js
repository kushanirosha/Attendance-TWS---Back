// services/restDayService.js
import { supabase } from "../config/db.js";

const countGender = (set, maleIds, femaleIds) => ({
  male: [...set].filter(id => maleIds.has(id)).length,
  female: [...set].filter(id => femaleIds.has(id)).length,
  total: set.size,
});

/**
 * Rest Day stats for current shift
 * - Uses yesterday's shift by default
 * - ONLY if yesterday was RD → looks further back to find last real shift (A/B/C)
 * - Fixed: Always fetches current + previous month to handle year/month crossovers safely
 */
export const getRestDayStatsForShift = async (
  currentShiftCode,
  operationalDate,
  maleIds,
  femaleIds
) => {
  const today = new Date(operationalDate);
  const todayStr = operationalDate;
  const monthYear = todayStr.slice(0, 7);
  const todayDayPadded = todayStr.split("-")[2];
  const todayDayRaw = todayDayPadded.replace(/^0/, "");

  // Calculate yesterday safely
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);
  const yesterdayMonthYear = yesterdayStr.slice(0, 7);

  // Always fetch current month + previous month (handles Jan 2 case perfectly)
  const fetchPromises = [
    supabase.from("shift_assignments").select("assignments").eq("month_year", monthYear),
  ];

  // Only add previous month query if it's different from current
  if (yesterdayMonthYear !== monthYear) {
    fetchPromises.push(
      supabase.from("shift_assignments").select("assignments").eq("month_year", yesterdayMonthYear)
    );
  }

  const responses = await Promise.all(fetchPromises);

  // Merge all assignments: { empId: { "01": "A", "02": "RD", ... } }
  const assignments = {};

  const parseAndMerge = (records) => {
    for (const rec of records) {
      let data;
      try {
        data = typeof rec.assignments === "string" ? JSON.parse(rec.assignments) : rec.assignments;
      } catch (e) {
        console.warn("Failed to parse shift assignments:", e);
        continue;
      }
      if (!data || typeof data !== "object") continue;

      for (const [empId, days] of Object.entries(data)) {
        if (!assignments[empId]) assignments[empId] = {};
        Object.assign(assignments[empId], days);
      }
    }
  };

  responses.forEach(({ data = [] }) => parseAndMerge(data));

  // Step 1: Find employees on RD today
  const restDayToday = new Set();

  for (const [empId, days] of Object.entries(assignments)) {
    const value = days[todayDayPadded] ?? days[todayDayRaw];
    if (value && String(value).trim().toUpperCase() === "RD") {
      restDayToday.add(empId);
    }
  }

  if (restDayToday.size === 0) {
    return { total: 0, male: 0, female: 0 };
  }

  // Debug log
  //console.log(`RD employees today: ${restDayToday.size} (IDs: ${[...restDayToday].sort().join(", ")})`);

  // Step 2: Determine which RD employees belong to current shift
  const restDayForThisShift = new Set();
  const validShifts = new Set(["A", "B", "C"]);

  for (const empId of restDayToday) {
    const days = assignments[empId];
    if (!days) continue;

    // Start from yesterday
    let checkDate = new Date(yesterdayDate);
    let foundShift = false;
    let attempts = 0;
    const maxAttempts = 60;

    while (!foundShift && attempts < maxAttempts) {
      const d = checkDate.getDate().toString();
      const dPadded = d.padStart(2, "0");
      const dRaw = d;

      const value = days[dPadded] ?? days[dRaw];

      if (value !== undefined) {
        const val = String(value).trim().toUpperCase();

        if (validShifts.has(val)) {
          // Found real working shift
          if (val === currentShiftCode) {
            restDayForThisShift.add(empId);
          }
          foundShift = true;
          //console.log(`Employee ${empId}: Assigned to shift ${val} (from ${checkDate.toISOString().slice(0,10)})`);
        } else if (val === "RD") {
          // Yesterday was RD → continue looking back
          checkDate.setDate(checkDate.getDate() - 1);
          attempts++;
        } else {
          // Other value (e.g. OFF, Leave) → stop, don't count
          foundShift = true;
        }
      } else {
        // No assignment for this day → keep looking back
        checkDate.setDate(checkDate.getDate() - 1);
        attempts++;
      }
    }

    if (!foundShift) {
      console.warn(`No working shift found for employee ${empId} in last ${maxAttempts} days`);
    }
  }

  //console.log(`Final RD count for shift ${currentShiftCode}: ${restDayForThisShift.size}`);

  return countGender(restDayForThisShift, maleIds, femaleIds);
};