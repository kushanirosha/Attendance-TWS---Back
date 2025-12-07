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

    if (activeIds.length === 0) {
      return res.json({
        currentShift: mainStats.currentShift,
        updatedAt: mainStats.updatedAt,
        projects: [],
        present: {},
        activeByProject: {},
        active: { total: 0, male: 0, female: 0 },
        activeNow: {
          LTL: mainStats.present.ltlActive || 0,
          STL: mainStats.present.stlActive || 0,
          IT: mainStats.present.special || 0,
          ADMIN: mainStats.present.adminActive || 0
        },
        absent: { total: mainStats.absent.total, list: [] }
      });
    }

    // ONE QUERY: Get ALL active employees with their REAL project from DB
    const { data: activeEmployees, error } = await supabase
      .from("employees")
      .select("id, name, project, gender")
      .in("id", activeIds);

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ error: "Database error", details: error.message });
    }

    // Group by REAL project from database
    const activeByProject = {};

    (activeEmployees || []).forEach(emp => {
      const proj = (emp.project || "No Project").trim();

      if (!activeByProject[proj]) {
        activeByProject[proj] = {
          total: 0,
          male: 0,
          female: 0,
          employees: []
        };
      }

      activeByProject[proj].total++;
      if (emp.gender === "Male") activeByProject[proj].male++;
      if (emp.gender === "Female") activeByProject[proj].female++;

      activeByProject[proj].employees.push({
        id: emp.id,
        name: emp.full_name || `ID:${emp.id}`
      });
    });

    // Sort names in each project
    Object.values(activeByProject).forEach(group => {
      group.employees.sort((a, b) => a.name.localeCompare(b.name));
    });

    const projectList = Object.keys(activeByProject).sort();

    res.json({
      currentShift: mainStats.currentShift,
      updatedAt: mainStats.updatedAt,

      // ALL PROJECTS FROM DATABASE — NO HARDCODING
      projects: projectList,

      // Present count per project
      present: Object.fromEntries(
        projectList.map(p => [p, activeByProject[p].total])
      ),

      // FULL DETAILS
      activeByProject,

      active: {
        total: activeNow.total,
        male: activeNow.male,
        female: activeNow.female
      },

      activeNow: {
        LTL: mainStats.present.ltlActive || 0,
        STL: mainStats.present.stlActive || 0,
        IT: mainStats.present.special || 0,
        ADMIN: mainStats.present.adminActive || 0
      },

      absent: {
        total: mainStats.absent.total,
        list: mainStats.absent.ids?.slice(0, 50).map(id => ({
          id,
          name: `ID:${id}`,
          project: "—"
        })) || []
      }
    });

  } catch (error) {
    console.error("Stats Details Error:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

export default router;