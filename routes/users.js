// routes/users.js
const express = require('express');
const { supabase } = require('../config/db');

const router = express.Router();

// POST /api/users - Create new user
router.post('/', async (req, res) => {
  const { employee_id, name, password, role } = req.body;

  if (!employee_id || !name || !password || !role) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .insert({ employee_id, name, password, role })
      .select()
      .single();

    if (error) throw error;

    res.json({ user: data });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(400).json({ message: err.message });
  }
});

// GET /api/users - Get all users
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, employee_id, name, role, created_at')
      .order('id');

    if (error) throw error;

    res.json({ users: data });
  } catch (err) {
    console.error('Fetch users error:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;