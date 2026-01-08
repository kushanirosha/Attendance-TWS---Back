// services/reportService.js
import { supabase } from "../config/db.js";
import {
  getAttendanceStatus,
  fetchProjectMap,
} from "../utils/attendanceStatus.js";
import { getCheckoutStatus } from "../utils/checkoutStatus.js";

/**
 * Convert UTC ISO timestamp to Colombo local time "HH:MM"
 */
function toColomboTime(utcIsoString) {
  if (!utcIsoString) return "-";
  return new Date(utcIsoString).toLocaleString("en-US", {
    timeZone: "Asia/Colombo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Get YYYY-MM-DD date in Colombo timezone
 */
function getColomboDate(utcIsoString) {
  return new Date(utcIsoString).toLocaleDateString("en-CA", {
    timeZone: "Asia/Colombo",
  });
}

/**
 * Calculate working hours — handles overnight shifts
 */
function calculateWorkingHours(inIso, outIso) {
  if (!inIso || !outIso) return "-";
  let diff = new Date(outIso) - new Date(inIso);
  if (diff < 0) diff += 24 * 3600 * 1000;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}h ${m}m`;
}

const shiftDisplayMap = {
  A: "Morning",
  B: "Noon",
  C: "Night",
  RD: "Rest Day",
};

const specialExemptIds = new Set(["1007"]);

export const getAttendanceReports = async (employeeIds, year, month) => {
  if (!employeeIds || employeeIds.length === 0) {
    throw new Error("At least one employee ID is required");
  }

  const monthPadded = String(month).padStart(2, "0");
  const monthYear = `${year}-${monthPadded}`;
  const daysInMonth = new Date(year, month, 0).getDate();

  const nowInColombo = new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" });
  const today = new Date(nowInColombo);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const startDate = `${prevYear}-${String(prevMonth).padStart(2, "0")}-25T00:00:00Z`;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-05T23:59:59Z`;

  try {
    // 1. Shift assignments
    const { data: shiftRecords } = await supabase
      .from("shift_assignments")
      .select("project_id, assignments")
      .eq("month_year", monthYear);

    const allAssignments = {};
    for (const rec of shiftRecords || []) {
      let ass;
      try {
        ass = typeof rec.assignments === "string" ? JSON.parse(rec.assignments) : rec.assignments;
      } catch (e) {
        continue;
      }
      if (ass) Object.assign(allAssignments, ass);
    }

    // 2. Employee data
    const [genderRes, projectMap] = await Promise.all([
      supabase.from("employees").select("id, gender").in("id", employeeIds),
      fetchProjectMap(employeeIds),
    ]);

    const genderMap = {};
    genderRes.data?.forEach((e) => (genderMap[String(e.id)] = e.gender || "Unknown"));

    // 3. Logs
    const [inRes, outRes] = await Promise.all([
      supabase
        .from("attendance_logs_check_in")
        .select("employee_id, timestamp")
        .in("employee_id", employeeIds)
        .gte("timestamp", startDate)
        .lte("timestamp", endDate),
      supabase
        .from("attendance_logs_check_out")
        .select("employee_id, timestamp")
        .in("employee_id", employeeIds)
        .gte("timestamp", startDate)
        .lte("timestamp", endDate),
    ]);

    const checkIns = inRes.data || [];
    const checkOuts = outRes.data || [];

    // 4. Group logs by Colombo date
    const dailyAttendance = {};
    employeeIds.forEach((id) => (dailyAttendance[id] = {}));

    const processLog = (log, type) => {
      const empId = String(log.employee_id);
      const dateKey = getColomboDate(log.timestamp);

      if (!dailyAttendance[empId][dateKey]) {
        dailyAttendance[empId][dateKey] = { in: null, out: null, inTime: "-", outTime: "-" };
      }

      const ts = new Date(log.timestamp).getTime();
      const key = type === "in" ? "in" : "out";
      const timeKey = type === "in" ? "inTime" : "outTime";
      const existing = dailyAttendance[empId][dateKey][key]
        ? new Date(dailyAttendance[empId][dateKey][key]).getTime()
        : 0;

      if (ts > existing) {
        dailyAttendance[empId][dateKey][key] = log.timestamp;
        dailyAttendance[empId][dateKey][timeKey] = toColomboTime(log.timestamp);
      }
    };

    checkIns.forEach((log) => processLog(log, "in"));
    checkOuts.forEach((log) => processLog(log, "out"));

    // === FINAL LOGIC: Move check-out backward to previous Night shift day ===
    for (const empId of employeeIds) {
      const assignments = allAssignments[empId] || {};

      let changed = true;
      while (changed) {
        changed = false;

        // Loop from last day to first to ensure full chaining
        for (let day = daysInMonth; day >= 1; day--) {
          const dayPadded = String(day).padStart(2, "0");
          const targetDate = `${year}-${monthPadded}-${dayPadded}`;

          const shiftRaw = (assignments[dayPadded] || assignments[day.toString()] || "")
            .toString()
            .trim()
            .toUpperCase();

          if (shiftRaw !== "C") continue; // Only for Night shift

          const dayData = dailyAttendance[empId][targetDate];
          if (!dayData) continue;

          if (dayData.out) continue; // Already has check-out

          // Look at next day
          const nextDay = new Date(targetDate);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayStr = nextDay.toISOString().split("T")[0];
          const nextDayData = dailyAttendance[empId][nextDayStr];

          if (nextDayData && nextDayData.out) {
            // Move check-out from next day to this day
            dayData.out = nextDayData.out;
            dayData.outTime = nextDayData.outTime;

            // Remove from next day
            delete nextDayData.out;
            delete nextDayData.outTime;

            changed = true;
          }
        }
      }
    }

    // 5. Build reports
    const monthNames = [
      "", "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    const reports = employeeIds.map((empId) => {
      const empAssignments = allAssignments[empId] || {};
      const empProject = projectMap[empId] || "";

      let assigned = 0, working = 0, rd = 0, absent = 0, late = 0;

      const attendance = {};

      for (let day = 1; day <= daysInMonth; day++) {
        const dayPadded = String(day).padStart(2, "0");
        const dayStr = String(day);
        const targetDate = `${year}-${monthPadded}-${dayPadded}`;

        const shiftRaw = (empAssignments[dayPadded] || empAssignments[dayStr] || "")
          .toString()
          .trim()
          .toUpperCase();

        const displayShift = shiftDisplayMap[shiftRaw] || (shiftRaw === "RD" ? "Rest Day" : "-");

        const isFutureDay =
          year > currentYear ||
          (year === currentYear && month > currentMonth) ||
          (year === currentYear && month === currentMonth && day > currentDay);

        const dayData = dailyAttendance[empId][targetDate] || {};
        const inIso = dayData.in || null;
        const outIso = dayData.out || null;
        const checkIn = dayData.inTime || "-";
        const checkOut = dayData.outTime || "-";
        const workingHours = calculateWorkingHours(inIso, outIso);

        let checkInStatus = "-";
        let checkOutStatus = "-";
        let remark = "-";

        if (isFutureDay) {
          attendance[dayStr] = {
            shift: displayShift,
            checkIn: "-",
            checkOut: "-",
            checkInStatus: "-",
            checkOutStatus: "-",
            remark: "-",
            working: "-",
          };
          continue;
        }

        if (shiftRaw === "RD") {
          rd++;
          if (checkIn !== "-" || checkOut !== "-") {
            remark = "Punched on Rest Day";
          }
        } else if (["A", "B", "C"].includes(shiftRaw)) {
          assigned++;

          if (!inIso && !outIso) {
            remark = "Absent";
            absent++;
          } else if (inIso && outIso) {
            checkInStatus = getAttendanceStatus(inIso, empProject, shiftRaw);
            checkOutStatus = getCheckoutStatus(outIso, shiftRaw, empProject, empId, specialExemptIds);
            if (checkInStatus === "Late") late++;
            if (["On time", "Late", "Half day"].includes(checkInStatus)) working++;
            remark = "Completed";
          } else if (inIso && !outIso) {
            checkInStatus = getAttendanceStatus(inIso, empProject, shiftRaw);
            checkOutStatus = "No Checkout";
            if (checkInStatus === "Late") late++;
            if (["On time", "Late", "Half day"].includes(checkInStatus)) working++;
            remark = "Active (No Checkout)";
          } else if (!inIso && outIso) {
            checkOutStatus = getCheckoutStatus(outIso, shiftRaw, empProject, empId, specialExemptIds);
            remark = "Only Checkout (Invalid)";
          }
        } else {
          if (inIso || outIso) {
            remark = "Punched on Off Day";
          }
        }

        attendance[dayStr] = {
          shift: displayShift,
          checkIn,
          checkOut,
          checkInStatus,
          checkOutStatus,
          remark,
          working: workingHours,
        };
      }

      return {
        employeeId: empId,
        gender: genderMap[empId] || "Unknown",
        project: empProject || "Unknown",
        attendance,
        summaries: { assigned, working, rd, absent, late },
      };
    });

    return {
      success: true,
      data: reports,
      meta: {
        year,
        month,
        monthName: monthNames[month],
        daysInMonth,
        employeeCount: reports.length,
      },
    };
  } catch (error) {
    console.error("[Reports] ERROR:", error);
    throw error;
  }
};