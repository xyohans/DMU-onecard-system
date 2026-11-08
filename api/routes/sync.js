import express from 'express';
import db from '../models/db.js';
import { getEthiopiaNow } from '../models/DB_QUERY.js';

const router = express.Router();

const MEALS = new Set(['breakfast', 'lunch', 'dinner']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function gateParams(src) {
  const cafeteria = Number(src?.cafeteria);
  const gate = Number(src?.gate);
  if (!Number.isInteger(cafeteria) || !Number.isInteger(gate)) return null;
  return { cafeteria, gate };
}

// everything a phone needs to work offline for ITS gate only
router.get('/data', async (req, res) => {
  const g = gateParams(req.query);
  if (!g) return res.status(400).json({ status: 'BAD_REQUEST' });

  try {
    const { date } = getEthiopiaNow();

    const [students] = await db.query(
      'SELECT id, full_name, department, is_active FROM students WHERE cafeteria_id = ? AND gate = ?',
      [g.cafeteria, g.gate]
    );
    const [windows] = await db.query('SELECT meal_type, start_time, end_time FROM meal_windows');
    const [menu] = await db.query('SELECT day_of_week, meal_type, menu_name FROM weekly_menu');
    const [logs] = await db.query(
      `SELECT student_id, meal_type, meal_date, scanned_at FROM meal_logs
       WHERE meal_date = ? AND cafeteria_id = ? AND gate = ?`,
      [date, g.cafeteria, g.gate]
    );

    res.json({ students, windows, menu, logs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'ERROR' });
  }
});

// scans a phone made while it could not reach the server
router.post('/scans', async (req, res) => {
  const g = gateParams(req.body);
  if (!g) return res.status(400).json({ status: 'BAD_REQUEST' });

  const scans = Array.isArray(req.body.scans) ? req.body.scans : [];
  let inserted = 0;
  let skipped = 0; // already recorded, invalid, or not a student of this gate

  for (const s of scans) {
    const valid =
      typeof s?.studentId === 'string' &&
      MEALS.has(s.mealType) &&
      DATE_RE.test(s.mealDate) &&
      DATETIME_RE.test(s.scannedAt);

    if (!valid) {
      skipped++;
      continue;
    }

    try {
      // the SELECT only returns a row when the student really belongs to this gate
      const [r] = await db.query(
        `INSERT IGNORE INTO meal_logs
           (student_id, meal_type, meal_date, scanned_at, method, cafeteria_id, gate)
         SELECT id, ?, ?, ?, ?, cafeteria_id, gate
         FROM students
         WHERE id = ? AND cafeteria_id = ? AND gate = ?`,
        [s.mealType, s.mealDate, s.scannedAt, s.method === 'manual' ? 'manual' : 'qr', s.studentId, g.cafeteria, g.gate]
      );
      if (r.affectedRows === 1) inserted++;
      else skipped++;
    } catch (err) {
      console.error('sync row failed', s.studentId, err.message);
      skipped++;
    }
  }

  res.json({ inserted, skipped });
});

export default router;
