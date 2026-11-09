import 'dotenv/config';
import db from '../models/db.js';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || email.length > 150) {
    throw new Error('Usage: node api/scripts/revoke-staff-session.js staff@example.edu');
  }

  const [result] = await db.query(
    `DELETE ss FROM staff_sessions ss
     JOIN staff s ON s.id = ss.staff_id
     WHERE s.email = ?`,
    [email]
  );
  console.log(result.affectedRows === 1 ? `Revoked the active session for ${email}.` : `No active session for ${email}.`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
