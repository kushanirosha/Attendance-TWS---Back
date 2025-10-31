import { supabase } from "../config/db.js";

export async function getAttendanceLogs() {
  const { data, error } = await supabase
    .from("attendance_logs")
    .select("id, employee_id, employee_name, timestamp, event_type");

  if (error) throw new Error(error.message);

  // Get latest event per employee
  const latestByEmployee = {};
  data.forEach((rec) => {
    const prev = latestByEmployee[rec.employee_id];
    if (!prev || new Date(rec.timestamp) > new Date(prev.timestamp)) {
      latestByEmployee[rec.employee_id] = rec;
    }
  });

  // Determine status (on time, late, half day)
  const getStatus = (checkInTime) => {
    const shiftStart = new Date();
    shiftStart.setHours(5, 30, 0, 0); // Morning shift start
    const lateTime = new Date();
    lateTime.setHours(5, 45, 0, 0);
    const halfDay = new Date();
    halfDay.setHours(9, 0, 0, 0);

    const checkIn = new Date(checkInTime);
    if (checkIn <= lateTime) return "On time";
    if (checkIn <= halfDay) return "Late";
    return "Half day";
  };

  return Object.values(latestByEmployee).map((rec) => ({
    id: rec.employee_id,
    name: rec.employee_name || "N/A",
    eventType: rec.event_type, // Added event type since we're getting all events
    timestamp: new Date(rec.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    status: getStatus(rec.timestamp),
  }));
}
