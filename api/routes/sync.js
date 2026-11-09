import express from 'express';
import db from '../models/db.js';
import { requireStaff } from '../models/auth.js';
import { getStationData } from '../models/sync-data.js';

const router = express.Router();

const MEALS = new Set(['breakfast', 'lunch', 'dinner']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

// everything a phone needs to work offline for ITS gate only
router.get('/data', requireStaff, async (req, res) => {
  try {
    const data = await getStationData(req.staff.cafeteria_id, req.staff.gate);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'ERROR' });
  }
});

// scans a phone made while it could not reach the server
router.post('/scans', requireStaff, async (req, res) => {
  const scans = Array.isArray(req.body?.scans) ? req.body.scans : [];
  let inserted = 0;
  let accepted = 0;
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
      const [students] = await db.query(
        'SELECT id FROM students WHERE id = ? AND cafeteria_id = ? AND gate = ?',
        [s.studentId, req.staff.cafeteria_id, req.staff.gate]
      );
      if (students.length === 0) {
        skipped++;
        continue;
      }

      const [r] = await db.query(
        `INSERT IGNORE INTO meal_logs
           (student_id, meal_type, meal_date, scanned_at, method, cafeteria_id, gate)
         SELECT id, ?, ?, ?, ?, cafeteria_id, gate
         FROM students
         WHERE id = ? AND cafeteria_id = ? AND gate = ?`,
        [
          s.mealType, s.mealDate, s.scannedAt, s.method === 'manual' ? 'manual' : 'qr',
          s.studentId, req.staff.cafeteria_id, req.staff.gate
        ]
      );
      if (r.affectedRows === 1) inserted++;
      accepted++;
    } catch (err) {
      console.error('sync row failed', s.studentId, err.message);
      skipped++;
    }
  }

  res.json({ inserted, accepted, skipped });
});

export default router;
