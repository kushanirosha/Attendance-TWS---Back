// routes/others.js
const express = require('express');
const { supabase } = require('../config/db');

const router = express.Router();

// ────────────────────────────────────────────────
// CLEANING STAFF (Janitorial)
// ────────────────────────────────────────────────

// POST /api/others/cleaning - Create new cleaning staff
router.post('/cleaning', async (req, res) => {
  const { id, name, gender = 'Female', status = 'Active', department = 'Cleaning Services', project = 'JANITOR' } = req.body;

  if (!id || !name) {
    return res.status(400).json({ message: 'ID and name are required' });
  }

  try {
    const { data, error } = await supabase
      .from('cleaning_staff')
      .insert({ id, name, gender, status, department, project })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ staff: data });
  } catch (err) {
    console.error('Create cleaning staff error:', err);
    res.status(400).json({ message: err.message });
  }
});

// GET /api/others/cleaning - Get all cleaning staff
router.get('/cleaning', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cleaning_staff')
      .select('id, name, gender, status, department, project, created_at, updated_at')
      .order('id');

    if (error) throw error;

    res.json({ staff: data });
  } catch (err) {
    console.error('Fetch cleaning staff error:', err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/others/cleaning/:id - Get single cleaning staff
router.get('/cleaning/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('cleaning_staff')
      .select('id, name, gender, status, department, project, created_at, updated_at')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Cleaning staff not found' });

    res.json({ staff: data });
  } catch (err) {
    console.error('Fetch single cleaning staff error:', err);
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/others/cleaning/:id - Update cleaning staff
router.put('/cleaning/:id', async (req, res) => {
  const { id } = req.params;
  const { name, gender, status, department, project } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Name is required' });
  }

  try {
    const { data, error } = await supabase
      .from('cleaning_staff')
      .update({ name, gender, status, department, project })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Cleaning staff not found' });

    res.json({ staff: data });
  } catch (err) {
    console.error('Update cleaning staff error:', err);
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/others/cleaning/:id - Delete cleaning staff
router.delete('/cleaning/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('cleaning_staff')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Cleaning staff not found' });

    res.json({ message: 'Cleaning staff deleted successfully' });
  } catch (err) {
    console.error('Delete cleaning staff error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ────────────────────────────────────────────────
// DRIVERS
// ────────────────────────────────────────────────

// POST /api/others/drivers - Create new driver
router.post('/drivers', async (req, res) => {
  const { id, name, gender = 'Male', status = 'Active', department = 'Transport Services', project = 'DRIVER' } = req.body;

  if (!id || !name) {
    return res.status(400).json({ message: 'ID and name are required' });
  }

  try {
    const { data, error } = await supabase
      .from('drivers')
      .insert({ id, name, gender, status, department, project })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ driver: data });
  } catch (err) {
    console.error('Create driver error:', err);
    res.status(400).json({ message: err.message });
  }
});

// GET /api/others/drivers - Get all drivers
router.get('/drivers', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('drivers')
      .select('id, name, gender, status, department, project, created_at, updated_at')
      .order('id');

    if (error) throw error;

    res.json({ drivers: data });
  } catch (err) {
    console.error('Fetch drivers error:', err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/others/drivers/:id - Get single driver
router.get('/drivers/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('drivers')
      .select('id, name, gender, status, department, project, created_at, updated_at')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Driver not found' });

    res.json({ driver: data });
  } catch (err) {
    console.error('Fetch single driver error:', err);
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/others/drivers/:id - Update driver
router.put('/drivers/:id', async (req, res) => {
  const { id } = req.params;
  const { name, gender, status, department, project } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Name is required' });
  }

  try {
    const { data, error } = await supabase
      .from('drivers')
      .update({ name, gender, status, department, project })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Driver not found' });

    res.json({ driver: data });
  } catch (err) {
    console.error('Update driver error:', err);
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/others/drivers/:id - Delete driver
router.delete('/drivers/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('drivers')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Driver not found' });

    res.json({ message: 'Driver deleted successfully' });
  } catch (err) {
    console.error('Delete driver error:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;