import { createHash } from 'node:crypto';
import db from './db.js';

function hashToken(token) {
  return createHash('sha256').update(token).digest();
}

function requireRole(role) {
  return async function roleMiddleware(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(authorization);
  if (!match) return res.status(401).json({ status: 'AUTH_REQUIRED' });

  try {
    const [rows] = await db.query(
      `SELECT s.id, s.email, s.full_name, s.role, s.cafeteria_id, s.gate
       FROM staff_sessions ss
       JOIN staff s ON s.id = ss.staff_id
       WHERE ss.token_hash = ? AND s.is_active = 1`,
      [hashToken(match[1])]
    );
    const staff = rows[0];
    if (!staff) return res.status(401).json({ status: 'AUTH_REQUIRED' });
    if (staff.role !== role) {
      return res.status(403).json({ status: 'FORBIDDEN' });
    }
    if (role === 'staff' && (!Number.isInteger(staff.cafeteria_id) || !Number.isInteger(staff.gate))) {
      return res.status(403).json({ status: 'FORBIDDEN' });
    }

    req.staff = staff;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'ERROR' });
  }
  };
}

const requireStaff = requireRole('staff');
const requireAdmin = requireRole('admin');

export { hashToken, requireAdmin, requireStaff };
