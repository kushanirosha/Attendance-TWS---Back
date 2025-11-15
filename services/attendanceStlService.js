// services/attendanceStlService.js
import { supabase } from "../config/db.js";
import moment from 'moment-timezone';

export async function getStlActiveNowCount(tz = 'Asia/Colombo') {
  try {
    // ---------------------------------------------------------------
    // 1. Get project PROJ011
    // ---------------------------------------------------------------
    const { data: proj, error: projErr } = await supabase
      .from('projects')
      .select('employees')
      .eq('id', 'PROJ011')
      .eq('department', 'Data Entry Department')
      .single();

    if (projErr || !proj) {
      console.warn('Project PROJ011 not found:', projErr?.message);
      return { total: 0, male: 0, female: 0 };
    }

    // ---------------------------------------------------------------
    // 2. Parse employees
    // ---------------------------------------------------------------
    let employeeIds = [];

    const raw = proj.employees;
    if (typeof raw === 'string') {
      try {
        const cleaned = raw.replace(/""/g, '"').trim();
        const parsed = JSON.parse(cleaned);
        employeeIds = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch (e) {
        console.error('Failed to parse employees JSON:', raw, e);
        return { total: 0, male: 0, female: 0 };
      }
    } else if (Array.isArray(raw)) {
      employeeIds = raw.map(String);
    } else {
      console.error('Invalid employees type:', typeof raw, raw);
      return { total: 0, male: 0, female: 0 };
    }

    employeeIds = employeeIds.filter(id => id && id.trim());
    if (employeeIds.length === 0) {
      console.warn('No employees in PROJ011');
      return { total: 0, male: 0, female: 0 };
    }

    console.log('STL Employees:', employeeIds);

    // ---------------------------------------------------------------
    // 3. 48-hour window (UTC)
    // ---------------------------------------------------------------
    const now = moment().utc();
    const windowStart = now.clone().subtract(48, 'hours').toISOString();
    const windowEnd = now.toISOString();

    // ---------------------------------------------------------------
    // 4. Fetch logs
    // ---------------------------------------------------------------
    const [inRes, outRes, empRes] = await Promise.all([
      supabase
        .from('attendance_logs_check_in')
        .select('employee_id, timestamp')
        .in('employee_id', employeeIds)
        .gte('timestamp', windowStart)
        .lte('timestamp', windowEnd),

      supabase
        .from('attendance_logs_check_out')
        .select('employee_id, timestamp')
        .in('employee_id', employeeIds)
        .gte('timestamp', windowStart)
        .lte('timestamp', windowEnd),

      // Fetch gender for all STL employees
      supabase
        .from('employees')
        .select('id, gender')
        .in('id', employeeIds)
    ]);

    if (inRes.error) throw inRes.error;
    if (outRes.error) throw outRes.error;
    if (empRes.error) throw empRes.error;

    const checkIns = inRes.data || [];
    const checkOuts = outRes.data || [];
    const employees = empRes.data || [];

    // Map employee_id → gender
    const genderMap = {};
    employees.forEach(emp => {
      genderMap[String(emp.id)] = emp.gender || 'Unknown';
    });

    // ---------------------------------------------------------------
    // 5. Latest in/out per employee_id
    // ---------------------------------------------------------------
    const latest = {};

    const update = (map, id, ts, type) => {
      if (!map[id]) map[id] = { in: null, out: null };
      if (type === 'in' && (!map[id].in || ts > map[id].in)) map[id].in = ts;
      if (type === 'out' && (!map[id].out || ts > map[id].out)) map[id].out = ts;
    };

    checkIns.forEach(log => update(latest, log.employee_id, log.timestamp, 'in'));
    checkOuts.forEach(log => update(latest, log.employee_id, log.timestamp, 'out'));

    // ---------------------------------------------------------------
    // 6. Count active + gender
    // ---------------------------------------------------------------
    let activeCount = 0;
    let maleCount = 0;
    let femaleCount = 0;

    for (const id in latest) {
      const { in: inTs, out: outTs } = latest[id];
      if (inTs && (!outTs || outTs < inTs)) {
        activeCount++;
        const gender = genderMap[id];
        if (gender === 'Male') maleCount++;
        else if (gender === 'Female') femaleCount++;
      }
    }

    console.log('STL Active:', { total: activeCount, male: maleCount, female: femaleCount });
    return { total: activeCount, male: maleCount, female: femaleCount };

  } catch (err) {
    console.error('STL active-now error:', err);
    return { total: 0, male: 0, female: 0 };
  }
}