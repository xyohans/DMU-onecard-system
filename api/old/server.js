import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import scanRouter from './routes/scan.js';
import statusRouter from './routes/status.js';

const app = express();
app.use(cors());
app.use(express.json());

// routes
app.use('/scan', scanRouter);
app.use('/status', statusRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});