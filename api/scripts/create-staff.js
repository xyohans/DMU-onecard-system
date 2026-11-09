import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import db from '../models/db.js';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

async function main() {
  const email = option('email')?.trim().toLowerCase();
  const fullName = option('name')?.trim();
  const cafeteria = Number(option('cafeteria'));
  const gate = Number(option('gate'));

  if (
    !email || email.length > 150 ||
    !fullName || fullName.length > 150 ||
    !Number.isInteger(cafeteria) || cafeteria < 1 || cafeteria > 2 ||
    !Number.isInteger(gate) || gate < 1 || gate > 9
  ) {
    throw new Error(
      'Usage: node api/scripts/create-staff.js --email staff@example.edu --name "Staff Name" --cafeteria 1 --gate 1'
    );
  }

  const password = randomBytes(18).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);
  await db.query(
    `INSERT INTO staff (email, full_name, password_hash, role, cafeteria_id, gate)
     VALUES (?, ?, ?, 'staff', ?, ?)`,
    [email, fullName, passwordHash, cafeteria, gate]
  );
  console.log(`Created staff account for ${email}. Give this initial password to the staff member once:`);
  console.log(password);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
