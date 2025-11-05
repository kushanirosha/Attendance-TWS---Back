import { supabase } from "../config/db.js";

// ✅ Fetch assignments for a project + month
export const getShiftAssignments = async (projectId, monthYear) => {
  const { data, error } = await supabase
    .from("shift_assignments")
    .select("*")
    .eq("project_id", projectId)
    .eq("month_year", monthYear)
    .single();

  if (error && error.code !== "PGRST116") throw error; // ignore "no rows found"
  return data || { assignments: {} };
};

// ✅ Insert or update shift assignments
export const upsertShiftAssignments = async (projectId, monthYear, assignments) => {
  const { data, error } = await supabase
    .from("shift_assignments")
    .upsert([
      {
        project_id: projectId,
        month_year: monthYear,
        assignments,
        updated_at: new Date(),
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
};
