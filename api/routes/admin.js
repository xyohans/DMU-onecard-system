import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import db from '../models/db.js';
import { hashToken, requireAdmin } from '../models/auth.js';

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function credentials(req) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!EMAIL_RE.test(email) || email.length > 150 || !password || password.length > 200) return null;
  return { email, password };
}

function staffInput(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const fullName = typeof body?.full_name === 'string' ? body.full_name.trim() : '';
  const cafeteria = Number(body?.cafeteria_id);
  const gate = Number(body?.gate);
  if (
    !EMAIL_RE.test(email) || email.length > 150 ||
    !fullName || fullName.length > 150 ||
    !Number.isInteger(cafeteria) || cafeteria < 1 || cafeteria > 2 ||
    !Number.isInteger(gate) || gate < 1 || gate > 9
  ) return null;
  return { email, fullName, cafeteria, gate };
}

function accountId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

router.post('/login', async (req, res) => {
  const input = credentials(req);
  if (!input) return res.status(400).json({ status: 'BAD_REQUEST' });

  try {
    const [rows] = await db.query(
      `SELECT id, email, full_name, password_hash, role, is_active
       FROM staff WHERE email = ? LIMIT 1`,
      [input.email]
    );
    const admin = rows[0];
    const passwordMatches = admin ? await bcrypt.compare(input.password, admin.password_hash) : false;
    if (!admin || admin.role !== 'admin' || !passwordMatches) {
      return res.status(401).json({ status: 'INVALID_CREDENTIALS' });
    }
    if (!admin.is_active) return res.status(403).json({ status: 'ACCOUNT_INACTIVE' });

    const token = randomBytes(32).toString('base64url');
    try {
      await db.query(
        'INSERT INTO staff_sessions (staff_id, token_hash) VALUES (?, ?)',
        [admin.id, hashToken(token)]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ status: 'SESSION_ALREADY_ACTIVE' });
      }
      throw err;
    }
    res.json({
      token,
      admin: { id: admin.id, email: admin.email, full_name: admin.full_name }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'ERROR' });
  }
});

router.get('/session', requireAdmin, (req, res) => {
  res.json({ admin: req.staff });
});

router.post('/logout', requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM staff_sessions WHERE staff_id = ?', [req.staff.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'ERROR' });
  }
});

router.get('/staff', requireAdmin, async (req, res) => {
  try {
    const [staff] = await db.query(
      `SELECT s.id, s.email, s.full_name, s.cafeteria_id, s.gate, s.is_active,
              EXISTS (SELECT 1 FROM staff_sessions ss WHERE ss.staff_id = s.id) AS session_active
       FROM staff s WHERE s.role = 'staff'
       ORDER BY s.cafeteria_id, s.gate, s.full_name`
    );
    res.json({ staff });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'ERROR' });
  }
});

router.post('/staff', requireAdmin, async (req, res) => {
  const input = staffInput(req.body);
  if (!input) return res.status(400).json({ status: 'BAD_REQUEST' });

  const password = randomBytes(18).toString('base64url');
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await db.query(
      `INSERT INTO staff (email, full_name, password_hash, role, cafeteria_id, gate, is_active)
       VALUES (?, ?, ?, 'staff', ?, ?, 1)`,
      [input.email, input.fullName, passwordHash, input.cafeteria, input.gate]
    );
    res.status(201).json({
      staff: {
        id: result.insertId,
        email: input.email,
        full_name: input.fullName,
        cafeteria_id: input.cafeteria,
        gate: input.gate,
        is_active: 1,
        session_active: 0
      },
      temporaryPassword: password
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ status: 'EMAIL_IN_USE' });
    console.error(err);
    res.status(500).json({ status: 'ERROR' });
  }
});

router.put('/staff/:id', requireAdmin, async (req, res) => {
  const id = accountId(req.params.id);
  const input = staffInput(req.body);
  const isActive = req.body?.is_active;
  if (!id || !input || ![0, 1, true, false].includes(isActive)) {
    return res.status(400).json({ status: 'BAD_REQUEST' });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [existingRows] = await connection.query(
      `SELECT s.id, s.email, s.full_name, s.cafeteria_id, s.gate, s.is_active,
              EXISTS (SELECT 1 FROM staff_sessions ss WHERE ss.staff_id = s.id) AS session_active
       FROM staff s WHERE s.id = ? AND s.role = 'staff' FOR UPDATE`,
      [id]
    );
    const existing = existingRows[0];
    if (!existing) {
      await connection.rollback();
      return res.status(404).json({ status: 'NOT_FOUND' });
    }

    const active = Number(Boolean(isActive));
    const stationChanged =
      Number(existing.cafeteria_id) !== input.cafeteria ||
      Number(existing.gate) !== input.gate ||
      Number(existing.is_active) !== active;
    await connection.query(
      `UPDATE staff
       SET email = ?, full_name = ?, cafeteria_id = ?, gate = ?, is_active = ?
       WHERE id = ? AND role = 'staff'`,
      [input.email, input.fullName, input.cafeteria, input.gate, active, id]
    );
    if (stationChanged) {
      await connection.query('DELETE FROM staff_sessions WHERE staff_id = ?', [id]);
    }
    await connection.commit();
    res.json({
      staff: {
        id,
        email: input.email,
        full_name: input.fullName,
        cafeteria_id: input.cafeteria,
        gate: input.gate,
        is_active: active,
        session_active: stationChanged ? 0 : Number(existing.session_active ?? 0)
      },
      sessionRevoked: stationChanged
    });
  } catch (err) {
    if (connection) await connection.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ status: 'EMAIL_IN_USE' });
    console.error(err);
    res.status(500).json({ status: 'ERROR' });
  } finally {
    connection?.release();
  }
});

router.post('/staff/:id/revoke', requireAdmin, async (req, res) => {
  const id = accountId(req.params.id);
  if (!id) return res.status(400).json({ status: 'BAD_REQUEST' });

  try {
    const [accounts] = await db.query(
      "SELECT id FROM staff WHERE id = ? AND role = 'staff'",
      [id]
    );
    if (!accounts[0]) return res.status(404).json({ status: 'NOT_FOUND' });
    const [result] = await db.query('DELETE FROM staff_sessions WHERE staff_id = ?', [id]);
    res.json({ revoked: result.affectedRows === 1 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'ERROR' });
  }
});

router.post('/staff/:id/reset-password', requireAdmin, async (req, res) => {
  const id = accountId(req.params.id);
  if (!id) return res.status(400).json({ status: 'BAD_REQUEST' });

  const password = randomBytes(18).toString('base64url');
  let connection;
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.query(
      "UPDATE staff SET password_hash = ? WHERE id = ? AND role = 'staff'",
      [passwordHash, id]
    );
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return res.status(404).json({ status: 'NOT_FOUND' });
    }
    await connection.query('DELETE FROM staff_sessions WHERE staff_id = ?', [id]);
    await connection.commit();
    res.json({ temporaryPassword: password });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error(err);
    res.status(500).json({ status: 'ERROR' });
  } finally {
    connection?.release();
  }
});

export default router;
