import { supabase } from '../config/db.js';

// 🧮 Generate project ID like PROJ001, PROJ002
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

// 🧹 Normalize employees to string array
const normalizeEmployees = (input) => {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map(e => (typeof e === 'object' ? String(e.id || e) : String(e)));
  }
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed)
        ? parsed.map(e => (typeof e === 'object' ? String(e.id || e) : String(e)))
        : [];
    } catch {
      return [];
    }
  }
  return [];
};

// ✅ Add Project
export const addProject = async (req, res) => {
  const { name, department, employees } = req.body;

  if (!name || !department)
    return res.status(400).json({ success: false, message: 'Name and department are required' });

  try {
    const id = await generateProjectId();
    const employeeIds = normalizeEmployees(employees);

    console.log('🟢 Adding project with employees:', employeeIds);

    // 🔁 Remove these employees from any existing project
    if (employeeIds.length > 0) {
      const { data: allProjects, error: fetchError } = await supabase.from('projects').select('*');
      if (fetchError) throw fetchError;

      for (const proj of allProjects) {
        const updated = (proj.employees || []).filter(e => !employeeIds.includes(e));
        if (updated.length !== (proj.employees || []).length) {
          await supabase.from('projects').update({ employees: updated }).eq('id', proj.id);
        }
      }
    }

    // ✅ Insert the new project
    const { data, error } = await supabase
      .from('projects')
      .insert([{ id, name, department, employees: employeeIds }])
      .select()
      .single();

    if (error) throw error;

    // ✅ Update employees' project field (save project name)
    if (employeeIds.length > 0) {
      const { error: updateError } = await supabase
        .from('employees')
        .update({ project: name }) // ✅ store name, not ID
        .in('id', employeeIds);
      if (updateError) throw updateError;
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('❌ Error adding project:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ Update project (moves employees automatically)
export const updateProject = async (req, res) => {
  const { id } = req.params;

  try {
    const updates = { ...req.body };
    if (updates.employees) updates.employees = normalizeEmployees(updates.employees);

    const newEmployees = updates.employees || [];

    // 🧮 Get current project info
    const { data: currentProject, error: currentError } = await supabase
      .from('projects')
      .select('name, employees')
      .eq('id', id)
      .single();

    if (currentError) throw currentError;

    const oldEmployees = currentProject?.employees || [];
    const projectName = updates.name || currentProject.name;

    // 🧩 Employees removed and added
    const removed = oldEmployees.filter(e => !newEmployees.includes(e));
    const added = newEmployees.filter(e => !oldEmployees.includes(e));

    // 🧹 Remove added employees from any other projects
    if (added.length > 0) {
      const { data: allProjects, error: fetchError } = await supabase.from('projects').select('*');
      if (fetchError) throw fetchError;

      for (const proj of allProjects) {
        if (proj.id !== id) {
          const updated = (proj.employees || []).filter(e => !added.includes(e));
          if (updated.length !== (proj.employees || []).length) {
            await supabase.from('projects').update({ employees: updated }).eq('id', proj.id);
          }
        }
      }
    }

    // 🧹 Remove project name from removed employees
    if (removed.length > 0) {
      await supabase.from('employees').update({ project: null }).in('id', removed);
    }

    // 🔁 Assign added employees to this project (store project name)
    if (added.length > 0) {
      await supabase.from('employees').update({ project: projectName }).in('id', added);
    }

    // 💾 Update project record
    const { data, error } = await supabase
      .from('projects')
      .update({ ...updates, name: projectName })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    console.error('❌ Error updating project:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ Delete project
export const deleteProject = async (req, res) => {
  const { id } = req.params;
  try {
    // 🧹 Clear project name for all employees under this project
    const { data: project, error: projError } = await supabase
      .from('projects')
      .select('name, employees')
      .eq('id', id)
      .single();

    if (projError) throw projError;

    if (project?.employees?.length > 0) {
      await supabase
        .from('employees')
        .update({ project: null })
        .in('id', project.employees);
    }

    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error deleting project:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ Get all projects
export const getProjects = async (req, res) => {
  const { data, error } = await supabase.from('projects').select('*');
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data });
};

// ✅ Get single project
export const getProjectById = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).single();
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data });
};
