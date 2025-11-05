import {
  getShiftAssignments,
  upsertShiftAssignments,
} from "../services/shiftAssignmentsService.js";

export const fetchShiftAssignments = async (req, res) => {
  try {
    const { projectId, monthYear } = req.params;
    const record = await getShiftAssignments(projectId, monthYear);
    res.status(200).json(record);
  } catch (error) {
    console.error("Error fetching shift assignments:", error);
    res.status(500).json({ message: "Error fetching shift assignments" });
  }
};

export const saveShiftAssignments = async (req, res) => {
  try {
    const { projectId, monthYear, assignments } = req.body;

    if (!projectId || !monthYear || !assignments) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const result = await upsertShiftAssignments(projectId, monthYear, assignments);
    res
      .status(200)
      .json({ message: "Shift assignments saved successfully", data: result });
  } catch (error) {
    console.error("Error saving shift assignments:", error);
    res.status(500).json({ message: "Error saving shift assignments" });
  }
};
