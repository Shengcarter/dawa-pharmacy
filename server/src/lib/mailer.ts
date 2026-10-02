import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

/** True when outgoing email is configured (SMTP_* environment variables). */
export const mailEnabled = Boolean(env.SMTP_HOST && env.SMTP_FROM);

const transport = mailEnabled
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    })
  : null;

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!transport) {
    if (!env.isProduction) logger.info({ to, subject, text }, 'Email (SMTP not configured — logged instead of sent)');
    return false;
  }
  await transport.sendMail({ from: env.SMTP_FROM, to, subject, text });
  return true;
}
