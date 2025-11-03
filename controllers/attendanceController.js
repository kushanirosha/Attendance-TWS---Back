// controllers/attendanceController.js
import { getAttendanceLogs } from "../services/attendanceService.js";

export const fetchAttendance = async (req, res) => {
  try {
    const attendance = await getAttendanceLogs();
    res.status(200).json({ success: true, data: attendance });
  } catch (error) {
    console.error("❌ Error fetching attendance logs:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
