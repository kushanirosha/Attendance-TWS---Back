// services/attendanceAdminService.js
import { supabase } from "../config/db.js";
import moment from 'moment-timezone';

/**
 * Returns { total: 2, male: 1, female: 1 } for active admins in last 18h
 */
export async function getAdminActiveNowCount(tz = 'Asia/Colombo') {
  try {
    // ---------------------------------------------------------------
    // 1. Get all employees with project = "ADMIN"
    // ---------------------------------------------------------------
    const { data: admins, error: adminErr } = await supabase
      .from('employees')
      .select('id, gender')
      .eq('project', 'ADMIN');

    if (adminErr || !admins || admins.length === 0) {
      console.warn('No ADMIN employees found:', adminErr?.message);
      return { total: 0, male: 0, female: 0 };
    }

    const adminIds = admins.map(a => String(a.id));
    const genderMap = {};
    admins.forEach(a => {
      genderMap[String(a.id)] = a.gender || 'Unknown';
    });

    console.log('ADMIN Employees:', adminIds);

    // ---------------------------------------------------------------
    // 2. 12-hour window (UTC)
    // ---------------------------------------------------------------
    const now = moment().utc();
    const windowStart = now.clone().subtract(18, 'hours').toISOString();
    const windowEnd = now.toISOString();

    // ---------------------------------------------------------------
    // 3. Fetch check-in & check-out logs
    // ---------------------------------------------------------------
    const [inRes, outRes] = await Promise.all([
      supabase
        .from('attendance_logs_check_in')
        .select('employee_id, timestamp')
        .in('employee_id', adminIds)
        .gte('timestamp', windowStart)
        .lte('timestamp', windowEnd),

      supabase
        .from('attendance_logs_check_out')
        .select('employee_id, timestamp')
        .in('employee_id', adminIds)
        .gte('timestamp', windowStart)
        .lte('timestamp', windowEnd),
    ]);

    if (inRes.error) throw inRes.error;
    if (outRes.error) throw outRes.error;

    const checkIns = inRes.data || [];
    const checkOuts = outRes.data || [];

    // ---------------------------------------------------------------
    // 4. Latest in/out per employee
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
    // 5. Count active + gender
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

    console.log('ADMIN Active:', { total: activeCount, male: maleCount, female: femaleCount });
    return { total: activeCount, male: maleCount, female: femaleCount };

  } catch (err) {
    console.error('ADMIN active-now error:', err);
    return { total: 0, male: 0, female: 0 };
  }
}