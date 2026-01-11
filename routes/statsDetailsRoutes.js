// routes/statsDetailsRoutes.js
import express from "express";
import { supabase } from "../config/db.js";
import { getActiveNowCount } from "../services/activeNowService.js";
import { getDashboardStats } from "../services/statsService.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const mainStats = await getDashboardStats();
    const activeNow = await getActiveNowCount();

    const activeIds = (activeNow.activeEmployeeIds || []).map(String);

    // Initialize activeNow gender breakdown (all start at 0)
    const activeNowCounts = {
      TL:   { total: 0, male: 0, female: 0 },
      PTS:   { total: 0, male: 0, female: 0 },
      IT:    { total: 0, male: 0, female: 0 },
      ADMIN: { total: 0, male: 0, female: 0 }
    };

    // === Fetch real absent employee details (name + project) ===
    let absentList = [];
    if (mainStats.absent?.ids && mainStats.absent.ids.length > 0) {
      const { data: absentEmployees, error: absentErr } = await supabase
        .from("employees")
        .select("id, name, project")
        .in("id", mainStats.absent.ids);

      if (!absentErr && absentEmployees) {
        absentList = absentEmployees.map(emp => ({
          id: emp.id,
          name: emp.name || `ID:${emp.id}`,
          project: emp.project || "—"
        }));
      } else {
        absentList = mainStats.absent.ids.map(id => ({
          id,
          name: `ID:${id}`,
          project: "—"
        }));
      }
    }

    // If no one is active
    if (activeIds.length === 0) {
      return res.json({
        currentShift: mainStats.currentShift,
        updatedAt: mainStats.updatedAt,
        projects: [],
        present: {},
        activeByProject: {},
        active: { total: 0, male: 0, female: 0 },
        activeNow: activeNowCounts,
        absent: { total: mainStats.absent.total, list: absentList }
      });
    }

    // === Fetch all active employees with details ===
    const { data: activeEmployees, error } = await supabase
      .from("employees")
      .select("id, name, project, gender")
      .in("id", activeIds);

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ error: "Database error", details: error.message });
    }

    const activeByProject = {};

    (activeEmployees || []).forEach(emp => {
      const id = emp.id.toString();
      const name = emp.name || `ID:${id}`;
      const proj = (emp.project || "No Project").trim();
      const gender = (emp.gender || "Unknown").trim().toLowerCase() === "female" ? "Female" : "Male";

      // === Build activeByProject ===
      if (!activeByProject[proj]) {
        activeByProject[proj] = {
          total: 0,
          male: 0,
          female: 0,
          employees: []
        };
      }
      activeByProject[proj].total++;
      if (gender === "Male") activeByProject[proj].male++;
      if (gender === "Female") activeByProject[proj].female++;
      activeByProject[proj].employees.push({ id, name });

      // === Build activeNowCounts (TL, PTS, IT, ADMIN) ===
      if (["ASS. TL", "TL", "TTL"].includes(proj)) {
        activeNowCounts.TL.total++;
        if (gender === "Male") activeNowCounts.TL.male++;
        if (gender === "Female") activeNowCounts.TL.female++;
      }
      else if (proj === "PTS") {
        activeNowCounts.PTS.total++;
        if (gender === "Male") activeNowCounts.PTS.male++;
        if (gender === "Female") activeNowCounts.PTS.female++;
      }
      else if (proj === "IT") {
        activeNowCounts.IT.total++;
        if (gender === "Male") activeNowCounts.IT.male++;
        if (gender === "Female") activeNowCounts.IT.female++;
      }
      else if (proj === "ADMIN") {
        activeNowCounts.ADMIN.total++;
        if (gender === "Male") activeNowCounts.ADMIN.male++;
        if (gender === "Female") activeNowCounts.ADMIN.female++;
      }
    });

    // Sort employee names alphabetically in each project
    Object.values(activeByProject).forEach(group => {
      group.employees.sort((a, b) => a.name.localeCompare(b.name));
    });

    const projectList = Object.keys(activeByProject).sort();

    // Final response
    res.json({
      currentShift: mainStats.currentShift,
      updatedAt: mainStats.updatedAt,
      projects: projectList,
      present: Object.fromEntries(
        projectList.map(p => [p, activeByProject[p].total])
      ),
      activeByProject,
      active: {
        total: activeNow.total || activeEmployees.length,
        male: activeNow.male || 0,
        female: activeNow.female || 0
      },
      activeNow: activeNowCounts,
      absent: {
        total: mainStats.absent.total,
        list: absentList
      }
    });

  } catch (error) {
    console.error("Stats Details Error:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

export default router;