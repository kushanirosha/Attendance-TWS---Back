// routes/statsDetailsRoutes.js
import express from "express";
import { supabase } from "../config/db.js";
import { getActiveNowCount } from "../services/activeNowService.js";
import { getDashboardStats } from "../services/statsService.js";
import { getAdminActiveNowCount } from "../services/attendanceAdminService.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const mainStats = await getDashboardStats();
    const activeNow = await getActiveNowCount();

    const activeIds = (activeNow.activeEmployeeIds || []).map(String);

    // === Gender-wise activeNow (from previous update) ===
    const activeNowCounts = {
      LTL: { total: 0, male: 0, female: 0 },
      STL: { total: 0, male: 0, female: 0 },
      IT:  { total: 0, male: 0, female: 0 },
      ADMIN: { total: 0, male: 0, female: 0 }
    };

    const adminActive = await getAdminActiveNowCount();
    activeNowCounts.ADMIN = {
      total: adminActive.total,
      male: adminActive.male,
      female: adminActive.female
    };

    // === NEW: Fetch real absent employee details (name + project) ===
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
        // Fallback: keep ID-only if query fails
        absentList = mainStats.absent.ids.map(id => ({
          id,
          name: `ID:${id}`,
          project: "—"
        }));
      }
    }
    // ====================================================

    if (activeIds.length === 0) {
      return res.json({
        currentShift: mainStats.currentShift,
        updatedAt: mainStats.updatedAt,
        projects: [],
        present: {},
        activeByProject: {},
        active: { total: 0, male: 0, female: 0 },
        activeNow: activeNowCounts,
        absent: { 
          total: mainStats.absent.total, 
          list: absentList 
        }
      });
    }

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
      const proj = (emp.project || "No Project").trim();
      const gender = (emp.gender || "Unknown").trim();

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
      activeByProject[proj].employees.push({
        id: emp.id,
        name: emp.name || `ID:${emp.id}`
      });

      // activeNow gender count
      if (["ASS. TL", "TL", "TTL"].includes(proj)) {
        activeNowCounts.LTL.total++;
        if (gender === "Male") activeNowCounts.LTL.male++;
        if (gender === "Female") activeNowCounts.LTL.female++;
      } else if (proj === "STL") {
        activeNowCounts.STL.total++;
        if (gender === "Male") activeNowCounts.STL.male++;
        if (gender === "Female") activeNowCounts.STL.female++;
      } else if (proj === "IT") {
        activeNowCounts.IT.total++;
        if (gender === "Male") activeNowCounts.IT.male++;
        if (gender === "Female") activeNowCounts.IT.female++;
      }
    });

    Object.values(activeByProject).forEach(group => {
      group.employees.sort((a, b) => a.name.localeCompare(b.name));
    });

    const projectList = Object.keys(activeByProject).sort();

    res.json({
      currentShift: mainStats.currentShift,
      updatedAt: mainStats.updatedAt,
      projects: projectList,
      present: Object.fromEntries(
        projectList.map(p => [p, activeByProject[p].total])
      ),
      activeByProject,
      active: {
        total: activeNow.total,
        male: activeNow.male,
        female: activeNow.female
      },
      activeNow: activeNowCounts,
      absent: {
        total: mainStats.absent.total,
        list: absentList  // ← Now shows real name + project
      }
    });

  } catch (error) {
    console.error("Stats Details Error:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

export default router;