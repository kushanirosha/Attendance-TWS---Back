import { supabase } from '../config/db.js';

// Get all employees
export const getEmployees = async (req, res) => {
  const { data, error } = await supabase.from('employees').select('*').order('name');
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data });
};

// Get employee by ID
export const getEmployeeById = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('employees').select('*').eq('id', id).single();
  if (error) return res.status(404).json({ success: false, message: 'Employee not found' });
  res.json({ success: true, data });
};

// Add employee
export const addEmployee = async (req, res) => {
  const { id, name, gender, status, department, project, profileImage } = req.body;
  const { data, error } = await supabase
    .from('employees')
    .insert([{ id, name, gender, status, department, project, profileImage }]);
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data: data[0] });
};

// Update employee
export const updateEmployee = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const { data, error } = await supabase.from('employees').update(updates).eq('id', id).select();
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data: data[0] });
};

// Delete employee
export const deleteEmployee = async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('employees').delete().eq('id', id);
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, message: 'Employee deleted' });
};
