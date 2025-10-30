import express from 'express';

import { env } from './env.js';

const { NODE_ENV, PORT } = env;
const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} in ${NODE_ENV} mode`);
});
