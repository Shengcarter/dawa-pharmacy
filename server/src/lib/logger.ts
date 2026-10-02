import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.token'],
  ...(env.isProduction ? {} : { transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } } }),
});
