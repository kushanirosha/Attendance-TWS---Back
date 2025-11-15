// routes/auth.js
import express from 'express';
import { supabase } from '../config/db.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  const { employeeId, password } = req.body;

  // Must be strings
  if (!employeeId || !password) {
    return res.status(400).json({ message: 'Employee ID and password are required' });
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, employee_id, name, role')
      .eq('employee_id', employeeId)   // string match
      .eq('password', password)        // plain text (as requested)
      .single();

    if (error || !data) {
      console.log('Supabase login failed:', error?.message);
      return res.status(401).json({ message: 'Invalid Employee ID or Password' });
    }

    res.json({
      user: {
        id: data.id,
        employeeId: data.employee_id,
        name: data.name.trim(), // removes trailing space in "Kushan "
        role: data.role,
      },
    });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;