import 'dotenv/config'; // must be the first import so db.js sees the variables
import cors from 'cors';
import express from 'express';
import { fileURLToPath } from 'node:url';
import adminRouter from './routes/admin.js';
import authRouter from './routes/auth.js';
import scanRouter from './routes/scan.js';
import statusRouter from './routes/status.js';
import syncRouter from './routes/sync.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' })); // a phone may upload a whole day of offline scans

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/admin', adminRouter);
app.use('/auth', authRouter);
app.use('/scan', scanRouter);
app.use('/status', statusRouter);
app.use('/sync', syncRouter);

const adminDirectory = fileURLToPath(new URL('../admin/', import.meta.url));
app.use('/admin', (req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}, express.static(adminDirectory, { index: 'index.html', fallthrough: false }));

const PORT = process.env.PORT || 3000;
// 0.0.0.0 so phones on the same network can reach the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Meal card API running on port ${PORT}`);
});
