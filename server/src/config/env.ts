import { z } from 'zod';

/** Environment is validated once at boot; the process refuses to start on bad config. */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(4000),
  /** Runtime connection: a role with data access only (see docs/SECURITY.md). */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  /** Optional separate connection that owns the schema and runs migrations. */
  MIGRATIONS_DATABASE_URL: z.string().optional(),
  /** 32 random bytes, base64 — encrypts 2FA secrets. Required in production. */
  DATA_ENCRYPTION_KEY: z
    .string()
    .optional()
    .refine((v) => !v || Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)'),
  /** 32 random bytes, base64 — encrypts backup files. Keep a copy off the server: restores need it. */
  BACKUP_ENCRYPTION_KEY: z
    .string()
    .optional()
    .refine((v) => !v || Buffer.from(v, 'base64').length === 32, 'BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)'),
  /** Second location for backups (another disk, a NAS mount, a synced folder). */
  BACKUP_COPY_DIR: z.string().optional(),
  /** ClamAV daemon for scanning uploads; when set, files that cannot be scanned are refused. */
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  CORS_ORIGIN: z.string().optional(),
  APP_URL: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  STORAGE_DIR: z.string().default('./storage'),
  SERVE_WEB: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  WEB_DIST_DIR: z.string().default('../web/dist'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  PG_DUMP_PATH: z.string().default('pg_dump'),
  ALERTS_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(30),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

// Production refuses to run with example or missing secrets.
if (parsed.data.NODE_ENV === 'production') {
  const problems: string[] = [];
  const placeholder = /change[-_ ]?me|example|secret123|password|test-secret/i;
  if (placeholder.test(parsed.data.JWT_ACCESS_SECRET)) problems.push('JWT_ACCESS_SECRET is still the example value; generate one with: openssl rand -base64 48');
  if (!parsed.data.DATA_ENCRYPTION_KEY) problems.push('DATA_ENCRYPTION_KEY is required in production; generate one with: openssl rand -base64 32');
  if (/:(change[-_]?me|password|dawa_dev_pw)@/i.test(parsed.data.DATABASE_URL)) problems.push('DATABASE_URL uses an example password');
  if (problems.length) {
    console.error(`Refusing to start in production:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
}

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  cookieSecure: parsed.data.COOKIE_SECURE ?? parsed.data.NODE_ENV === 'production',
};
export type Env = typeof env;
