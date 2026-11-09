import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import db from '../models/db.js';
import { hashToken, requireStaff } from '../models/auth.js';
import { getStationData } from '../models/sync-data.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || email.length > 150 || !password || password.length > 200) {
    return res.status(400).json({ status: 'BAD_REQUEST' });
  }

  try {
    const [rows] = await db.query(
      `SELECT id, email, full_name, password_hash, role, cafeteria_id, gate, is_active
       FROM staff WHERE email = ? LIMIT 1`,
      [email]
    );
    const staff = rows[0];
    const passwordMatches = staff ? await bcrypt.compare(password, staff.password_hash) : false;
    if (!staff || !passwordMatches) return res.status(401).json({ status: 'INVALID_CREDENTIALS' });
    if (!staff.is_active) return res.status(403).json({ status: 'ACCOUNT_INACTIVE' });
    if (
      staff.role !== 'staff' ||
      !Number.isInteger(staff.cafeteria_id) ||
      staff.cafeteria_id < 1 ||
      staff.cafeteria_id > 2 ||
      !Number.isInteger(staff.gate) ||
      staff.gate < 1 ||
      staff.gate > 9
    ) {
      return res.status(403).json({ status: 'STATION_NOT_ASSIGNED' });
    }

    const data = await getStationData(staff.cafeteria_id, staff.gate);
    const token = randomBytes(32).toString('base64url');
    try {
      await db.query(
        'INSERT INTO staff_sessions (staff_id, token_hash) VALUES (?, ?)',
        [staff.id, hashToken(token)]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ status: 'SESSION_ALREADY_ACTIVE' });
      }
      throw err;
    }

    res.json({
      token,
      staff: {
        id: staff.id,
        email: staff.email,
        full_name: staff.full_name,
        cafeteria_id: staff.cafeteria_id,
        gate: staff.gate
      },
      data
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'ERROR' });
  }
});

router.get('/session', requireStaff, (req, res) => {
  res.json({ staff: req.staff });
});

router.post('/logout', requireStaff, async (req, res) => {
  try {
    await db.query('DELETE FROM staff_sessions WHERE staff_id = ?', [req.staff.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'ERROR' });
  }
});

export default router;
