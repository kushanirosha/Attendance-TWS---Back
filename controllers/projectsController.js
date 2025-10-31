import { supabase } from '../config/db.js';

// Helper to generate a project ID
const generateProjectId = async () => {
  const { data: projects, error } = await supabase.from('projects').select('id');
  if (error) throw new Error(error.message);

  const numbers = projects
    .map(p => parseInt(p.id.replace(/^PROJ/, ''), 10))
    .filter(n => !isNaN(n));

  const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
  const newNumber = (maxNumber + 1).toString().padStart(3, '0');

  return `PROJ${newNumber}`;
};

// Get all projects
export const getProjects = async (req, res) => {
  const { data, error } = await supabase.from('projects').select('*');
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data });
};

// Get project by ID
export const getProjectById = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).single();
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data });
};

// Add project
export const addProject = async (req, res) => {
  const { name, department, employees } = req.body;

  if (!name || !department) 
    return res.status(400).json({ success: false, message: 'Name and department are required' });

  try {
    const id = await generateProjectId();
    const sanitizedEmployees = sanitizeEmployees(employees);

    const { data, error } = await supabase
      .from('projects')
      .insert([{ id, name: String(name), department: String(department), employees: sanitizedEmployees }])
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error adding project:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update project
export const updateProject = async (req, res) => {
  const { id } = req.params;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, message: 'Invalid project ID' });
  }

  try {
    const updates = sanitizeUpdates(req.body);

    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error updating project:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Delete project
export const deleteProject = async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase.from('projects').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error deleting project:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Helper: sanitize employees input to always return a JSON array
const sanitizeEmployees = (input) => {
  if (!input) return [];

  // If array, process each item
  if (Array.isArray(input)) {
    return input.map(item => {
      // If it's already an object with "id", leave it
      if (item && typeof item === 'object' && 'id' in item) return item;
      // If primitive (string/number), wrap it
      return { id: String(item) };
    });
  }

  // If single object with id, wrap in array
  if (input && typeof input === 'object' && 'id' in input) return [input];

  // If primitive, wrap in object
  if (typeof input === 'string' || typeof input === 'number') return [{ id: String(input) }];

  return [];
};


// Helper: sanitize updates to match column types
const sanitizeUpdates = (updates) => {
  const safeUpdates = {};

  if (updates.name !== undefined) safeUpdates.name = String(updates.name);
  if (updates.department !== undefined) safeUpdates.department = String(updates.department);
  if (updates.employees !== undefined) safeUpdates.employees = sanitizeEmployees(updates.employees);

  // Never allow updating the ID
  if (safeUpdates.id) delete safeUpdates.id;

  return safeUpdates;
};
