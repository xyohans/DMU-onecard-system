import 'dotenv/config';
import mysql from 'mysql2/promise';

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true
});

// make MySQL's own clock (scanned_at) use Ethiopia time
db.pool.on('connection', (conn) => conn.query("SET time_zone = '+03:00'"));

export default db;