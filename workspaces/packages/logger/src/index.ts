// TODO: revisit this errors package and rework (look at config package)

import pino from 'pino';
import pinoHttp from 'pino-http';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});

export const httpLogger = pinoHttp({
  logger,
  customProps: () => ({ service: process.env.SERVICE_NAME }),
});
