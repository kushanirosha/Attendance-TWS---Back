import { supabase } from "../config/db.js";

export async function getAttendanceLogs() {
  const { data, error } = await supabase
    .from("attendance_logs")
    .select("id, employee_id, employee_name, timestamp, event_type")
    .order("timestamp", { ascending: false });

  if (error) throw new Error(error.message);
  if (!data) return [];

  // ✅ Get the latest record per employee
  const latestByEmployee = {};
  for (const rec of data) {
    const prev = latestByEmployee[rec.employee_id];
    if (!prev || new Date(rec.timestamp) > new Date(prev.timestamp)) {
      latestByEmployee[rec.employee_id] = rec;
    }
  }

 // ✅ Function to get shift status
const getStatus = (checkInTime) => {
  const time = new Date(checkInTime);
  const hours = time.getHours();
  const minutes = time.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  // Morning Shift (04:30 AM - 12:29 PM)
  if (totalMinutes >= 270 && totalMinutes <= 749) {
    if (totalMinutes <= 330) return "On time"; // 04:30–05:30
    if (totalMinutes <= 450) return "Late";    // 05:31–07:30
    return "Half day";                         // 07:31–12:29
  }

  // Noon Shift (12:30 PM - 08:29 PM)
  if (totalMinutes >= 750 && totalMinutes <= 1229) {
    if (totalMinutes <= 810) return "On time"; // 12:30–01:30
    if (totalMinutes <= 930) return "Late";    // 01:31–03:30
    return "Half day";                         // 03:31–08:29
  }

  // Night Shift (08:30 PM - 04:29 AM next day)
  // Handle time wrap around midnight
  if (totalMinutes >= 1230 || totalMinutes <= 269) {
    if (totalMinutes >= 1230 && totalMinutes <= 1290) return "On time"; // 08:30–09:30 PM
    if ((totalMinutes >= 1291 && totalMinutes <= 1410) || (totalMinutes >= 0 && totalMinutes <= 0)) return "Late"; // 09:31–11:30 PM
    return "Half day"; // 11:31 PM–04:29 AM
  }

  // Outside all ranges
  return "Unknown shift";
};


  // ✅ Return both formatted and raw time
  return Object.values(latestByEmployee).map((rec) => ({
    id: rec.employee_id,
    name: rec.employee_name || "N/A",
    checkInTime: new Date(rec.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    timestamp: rec.timestamp,
    status: getStatus(rec.timestamp),
  }));
}
