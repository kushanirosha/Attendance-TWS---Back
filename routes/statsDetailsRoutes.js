// routes/statsDetailsRoutes.js
import express from "express";
import { supabase } from "../config/db.js";

const router = express.Router();

/* -------------------------------------------------
   COLOMBO TIME & YOUR EXACT SHIFT CONFIG
   ------------------------------------------------- */
const getColomboTime = (date = new Date()) => {
  return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
};

const SHIFT_CONFIG = {
  Morning: { early: 4 * 60 + 30, onTimeEnd: 5 * 60 + 30, lateEnd: 7 * 60 + 30, halfDayEnd: 12 * 60 + 29 },
  Noon:    { early: 12 * 60 + 30, onTimeEnd: 13 * 60 + 30, lateEnd: 15 * 60 + 30, halfDayEnd: 20 * 60 + 29 },
  Night:   { early: 20 * 60 + 30, onTimeEnd: 21 * 60 + 30, lateEnd: 23 * 60 + 30, halfDayEnd: 4 * 60 + 29, nextDayWrap: true },
};

const getCurrentShift = () => {
  const colombo = getColomboTime();
  const minutes = colombo.getHours() * 60 + colombo.getMinutes();

  if (minutes >= SHIFT_CONFIG.Morning.onTimeEnd && minutes < SHIFT_CONFIG.Noon.onTimeEnd)
    return "Morning";
  if (minutes >= SHIFT_CONFIG.Noon.onTimeEnd)
    return "Noon";
  return "Night";
};

const getTodayColomboDateString = () => {
  return getColomboTime().toISOString().split("T")[0];
};

/* -------------------------------------------------
   GET /api/stats-details
   ------------------------------------------------- */
router.get("/stats-details", async (req, res) => {
  try {
    const currentShift = getCurrentShift();
    const today = getTodayColomboDateString();

    // 1. Fetch all projects
    const { data: projects = [], error: projError } = await supabase
      .from("projects")
      .select("id, name, department")
      .order("name");

    if (projError) throw projError;

    const projectNames = projects
      .map(p => p.name?.trim())
      .filter(Boolean);

    const safeProjectNames = projectNames.length > 0
      ? projectNames
      : ["Warehouse", "Assembly", "KK8-Warehouse", "KK8-Distribution", "W1W", "HoB"];

    // FIXED LINE → Added parentheses
    const presentByProject = {};
    safeProjectNames.forEach((name) => {
      presentByProject[name] = 0;
    });

    // 2. Today's check-ins
    const { data: checkIns = [] } = await supabase
      .from("attendance_logs_check_in")
      .select("employee_id")
      .eq("event_type", "check_in")
      .gte("timestamp", `${today}T00:00:00+05:30`)
      .lt("timestamp", `${today}T23:59:59+05:30`);

    const checkedInIds = new Set(checkIns.map(log => String(log.employee_id)));

    // 3. Count present + gender
    let maleCount = 0;
    let femaleCount = 0;

    if (checkedInIds.size > 0) {
      const { data: presentEmps = [] } = await supabase
        .from("employees")
        .select("id, project, gender")
        .in("id", Array.from(checkedInIds));

      presentEmps.forEach(emp => {
        const projName = (emp.project || "").trim();
        if (presentByProject.hasOwnProperty(projName)) {
          presentByProject[projName]++;
        }
        if (emp.gender === "Male") maleCount++;
        if (emp.gender === "Female") femaleCount++;
      });
    }

    // 4. Absent list
    const { data: allProjectEmps = [] } = await supabase
      .from("employees")
      .select("id, full_name, project")
      .in("project", safeProjectNames);

    const absentList = allProjectEmps
      .filter(emp => !checkedInIds.has(String(emp.id)))
      .map(emp => ({
        name: emp.full_name || `ID:${emp.id}`,
        project: (emp.project || "—").trim()
      }))
      .slice(0, 20);

    // 5. Active Now
    const activeNow = {
      LTL: 9,
      STL: 1,
      IT: 2,
      ADMIN: 3
    };

    // 6. Send response
    res.json({
      currentShift,
      updatedAt: getColomboTime().toLocaleString("en-LK", { timeZone: "Asia/Colombo" }),

      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        department: p.department || ""
      })),

      present: presentByProject,

      gender: { male: maleCount, female: femaleCount },

      active: {
        total: maleCount + femaleCount,
        male: maleCount,
        female: femaleCount
      },

      absent: { total: absentList.length },

      activeNow,
      absentList
    });

  } catch (error) {
    console.error("[/api/stats-details] Error:", error);
    res.status(500).json({
      error: "Failed to load stats",
      details: error.message
    });
  }
});

// Test route
router.get("/test", (req, res) => {
  res.json({
    message: "Stats Details API is LIVE!",
    shift: getCurrentShift(),
    time: getColomboTime().toLocaleString("en-LK")
  });
});

export default router;