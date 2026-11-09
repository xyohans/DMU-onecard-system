import db from './db.js';
import { getEthiopiaNow } from './DB_QUERY.js';

async function getStationData(cafeteria, gate) {
  const { date } = getEthiopiaNow();
  const [students] = await db.query(
    'SELECT id, full_name, department, is_active FROM students WHERE cafeteria_id = ? AND gate = ?',
    [cafeteria, gate]
  );
  const [windows] = await db.query('SELECT meal_type, start_time, end_time FROM meal_windows');
  const [menu] = await db.query('SELECT day_of_week, meal_type, menu_name FROM weekly_menu');
  const [logs] = await db.query(
    `SELECT student_id, meal_type, meal_date, scanned_at FROM meal_logs
     WHERE meal_date = ? AND cafeteria_id = ? AND gate = ?`,
    [date, cafeteria, gate]
  );

  return { students, windows, menu, logs };
}

export { getStationData };
