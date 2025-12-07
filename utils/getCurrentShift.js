// utils/getCurrentShift.js
export function getCurrentShiftAndDate() {
  // Get current time in Colombo as proper Date object (UTC-based, correct offset)
  const now = new Date();
  const colomboOffset = 5.5 * 60 * 60 * 1000; // Sri Lanka is UTC+5:30
  const colomboTime = new Date(now.getTime() + colomboOffset);

  const hours = colomboTime.getUTCHours();    // Use UTC methods to avoid DST bugs
  const minutes = colomboTime.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  const MORNING_START = 5 * 60 + 30;   // 5:30 AM
  const NOON_START    = 13 * 60 + 30;  // 1:30 PM
  const NIGHT_START   = 21 * 60 + 30;  // 9:30 PM

  let shift;
  let operationalDate = new Date(colomboTime); // base for operational day

  if (totalMinutes >= NIGHT_START || totalMinutes < MORNING_START) {
    shift = "Night";
    // If before 5:30 AM → belongs to previous calendar day
    if (totalMinutes < MORNING_START) {
      operationalDate.setUTCDate(operationalDate.getUTCDate() - 1);
    }
  } else if (totalMinutes >= MORNING_START && totalMinutes < NOON_START) {
    shift = "Morning";
  } else {
    shift = "Noon";
  }

  const shiftDate = operationalDate.toISOString().split("T")[0];

  return {
    currentShift: shift,
    shiftDate,                    // ← CORRECT: "2025-12-07" at 3:33 AM on 8th
    displayDate: now.toLocaleString("en-US", { timeZone: "Asia/Colombo" }).split(",")[0], // "12/8/2025"
    colomboISOTime: colomboTime.toISOString(),
  };
}