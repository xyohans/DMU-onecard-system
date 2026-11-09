import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import db from '../models/db.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

async function main() {
  const email = option('email')?.trim().toLowerCase();
  const fullName = option('name')?.trim();
  if (!EMAIL_RE.test(email || '') || email.length > 150 || !fullName || fullName.length > 150) {
    throw new Error('Usage: node api/scripts/create-admin.js --email admin@example.edu --name "Admin Name"');
  }

  const password = randomBytes(18).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);
  await db.query(
    `INSERT INTO staff (email, full_name, password_hash, role, cafeteria_id, gate, is_active)
     VALUES (?, ?, ?, 'admin', NULL, NULL, 1)`,
    [email, fullName, passwordHash]
  );
  console.log(`Created administrator account for ${email}. Give this initial password securely:`);
  console.log(password);
}

main()
  .catch((err) => {
    console.error(err.code === 'ER_DUP_ENTRY' ? 'An account already uses that email.' : err.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
