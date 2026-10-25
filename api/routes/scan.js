import express from 'express';
import db from '../config/db.js';
import { cleanId, getCurrentMeal } from '../models/DB_QUERY.js';
const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const studentId = cleanId(req.body?.studentId);
    if (!studentId) return res.status(400).json({ status: 'BAD_REQUEST' });
    const method = req.body?.method === 'manual' ? 'manual' : 'qr';

    // 1. is a meal open?
    const meal = await getCurrentMeal();
    if (!meal) return res.status(403).json({ status: 'CLOSED' });

    // 2. find the student
    const [students] = await db.query('SELECT * FROM students WHERE id = ?', [studentId]);
    const student = students[0];
    if (!student) return res.status(404).json({ status: 'NOT_FOUND' });
    if (!student.is_active) return res.status(403).json({ status: 'INACTIVE', student, meal });

    // 3. try to mark as eaten (the UNIQUE key blocks a second use)
    try {
      await db.query(
        'INSERT INTO meal_logs (student_id, meal_type, meal_date, method) VALUES (?, ?, ?, ?)',
        [studentId, meal.meal_type, meal.date, method]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        const [first] = await db.query(
          `SELECT scanned_at FROM meal_logs
           WHERE student_id = ? AND meal_type = ? AND meal_date = ?`,
          [studentId, meal.meal_type, meal.date]
        );
        return res.status(409).json({
          status: 'ALREADY_USED',
          student,
          meal,
          firstScan: first[0] ?? null
        });
      }
      throw err;
    }

    res.json({ status: 'ALLOWED', student, meal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'ERROR' });
  }
});

export default router;