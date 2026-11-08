import 'dotenv/config'; // must be the first import so db.js sees the variables
import cors from 'cors';
import express from 'express';
import scanRouter from './routes/scan.js';
import statusRouter from './routes/status.js';
import syncRouter from './routes/sync.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' })); // a phone may upload a whole day of offline scans

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/scan', scanRouter);
app.use('/status', statusRouter);
app.use('/sync', syncRouter);

const PORT = process.env.PORT || 3000;
// 0.0.0.0 so phones on the same network can reach the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Meal card API running on port ${PORT}`);
});
