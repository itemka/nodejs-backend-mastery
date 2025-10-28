import express from 'express';
import dotenv from 'dotenv';
import { env } from './env.js';

dotenv.config();

const PORT = env.PORT;
const NODE_ENV = env.NODE_ENV;

const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} in ${NODE_ENV} mode`);
});
