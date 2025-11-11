import { supabase } from "../config/db.js";
import { upload } from "../config/multer.js";
import path from "path";
import fs from "fs/promises";

const getPublicUrl = (filename) => `/uploads/employees/${filename}`;

export const uploadMiddleware = upload.single("profileImage");

// -------------------- GET --------------------
export const getEmployees = async (req, res) => {
  const { data, error } = await supabase.from("employees").select("*").order("name");
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data });
};

export const getEmployeeById = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("employees")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return res.status(404).json({ success: false, message: "Employee not found" });
  res.json({ success: true, data });
};

// -------------------- ADD --------------------
export const addEmployee = async (req, res) => {
  const { id, name, gender, status, department, project } = req.body;

  let profileImage = null;
  if (req.file) profileImage = req.file.filename;
  else if (req.body.profileImage) profileImage = req.body.profileImage;

  const { data, error } = await supabase
    .from("employees")
    .insert([{ id, name, gender, status, department, project, profileImage }])
    .select();

  if (error) return res.status(500).json({ success: false, message: error.message });

  const employee = data[0];
  if (profileImage && req.file) employee.profileImageUrl = getPublicUrl(profileImage);
  res.json({ success: true, data: employee });
};

// -------------------- UPDATE --------------------
export const updateEmployee = async (req, res) => {
  const { id } = req.params;
  const updates = { ...req.body };

  // ---- replace image ----
  if (req.file) {
    // delete old file
    const { data: old } = await supabase
      .from("employees")
      .select("profileImage")
      .eq("id", id)
      .single();

    if (old?.profileImage) {
      const oldPath = path.join(process.cwd(), "uploads", "employees", old.profileImage);
      await fs.unlink(oldPath).catch(() => {});
    }
    updates.profileImage = req.file.filename;
  } else if (req.body.profileImage === "null") {
    updates.profileImage = null;
  }

  const { data, error } = await supabase
    .from("employees")
    .update(updates)
    .eq("id", id)
    .select();

  if (error) return res.status(500).json({ success: false, message: error.message });

  const employee = data[0];
  if (employee.profileImage) employee.profileImageUrl = getPublicUrl(employee.profileImage);
  res.json({ success: true, data: employee });
};

// -------------------- DELETE --------------------
export const deleteEmployee = async (req, res) => {
  const { id } = req.params;

  const { data: emp } = await supabase
    .from("employees")
    .select("profileImage")
    .eq("id", id)
    .single();

  if (emp?.profileImage) {
    const filePath = path.join(process.cwd(), "uploads", "employees", emp.profileImage);
    await fs.unlink(filePath).catch(() => {});
  }

  const { error } = await supabase.from("employees").delete().eq("id", id);
  if (error) return res.status(500).json({ success: false, message: error.message });

  res.json({ success: true, message: "Employee deleted" });
};