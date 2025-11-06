// services/shiftAssignmentsService.js
import { supabase } from "../config/db.js";

// Fetch assignments
export const getShiftAssignments = async (projectId, monthYear) => {
  const { data, error } = await supabase
    .from("shift_assignments")
    .select("assignments")
    .eq("project_id", projectId)
    .eq("month_year", monthYear)
    .single();

  if (error && error.code !== "PGRST116") throw error; // PGRST116 = no rows
  return { assignments: data?.assignments || {} };
};

// Upsert + return whether it was INSERT or UPDATE
export const upsertShiftAssignments = async (projectId, monthYear, assignments) => {
  const { data, error, count } = await supabase
    .from("shift_assignments")
    .upsert(
      {
        project_id: projectId,
        month_year: monthYear,
        assignments,
        updated_at: new Date(),
      },
      { onConflict: "project_id,month_year" }
    )
    .select()
    .single();

  if (error) throw error;

  // Check if row existed before upsert
  const { data: existing } = await supabase
    .from("shift_assignments")
    .select("id")
    .eq("project_id", projectId)
    .eq("month_year", monthYear)
    .neq("id", data.id) // if this finds a row, means upsert did UPDATE
    .limit(1);

  const inserted = !existing || existing.length === 0;

  return { inserted }; // This is what frontend expects
};