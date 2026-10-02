import path from 'node:path';
import { existsSync } from 'node:fs';
import express, { Router } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { PUBLIC_DIR } from './lib/uploads';
import { authenticate } from './middleware/auth';
import { camelCaseResponses } from './middleware/camelCase';
import { errorHandler, notFoundHandler } from './middleware/error';
import { apiLimiter } from './middleware/rateLimit';
import { pool } from './db/pool';
import { authRouter } from './modules/auth/routes';
import { rolesRouter, usersRouter } from './modules/users/routes';
import { categoriesRouter, manufacturersRouter, productsRouter } from './modules/catalog/routes';
import { inventoryRouter } from './modules/inventory/routes';
import { suppliersRouter } from './modules/suppliers/routes';
import { purchasingRouter } from './modules/purchasing/routes';
import { customersRouter } from './modules/customers/routes';
import { salesRouter } from './modules/sales/routes';
import { publicReceiptRouter } from './modules/sales/receiptRoutes';
import { prescriptionsRouter } from './modules/prescriptions/routes';
import { expensesRouter } from './modules/expenses/routes';
import { reportsRouter } from './modules/reports/routes';
import { dashboardRouter } from './modules/dashboard/routes';
import { notificationsRouter } from './modules/notifications/routes';
import { searchRouter } from './modules/search/routes';
import { auditRouter } from './modules/audit/routes';
import { settingsRouter, publicSettingsRouter } from './modules/settings/routes';
import { backupsRouter } from './modules/backups/routes';
import { branchesRouter } from './modules/branches/routes';
import { insuranceRouter } from './modules/insurance/routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          // Only force HTTPS sub-resources when the deployment actually serves HTTPS.
          upgradeInsecureRequests: env.cookieSecure ? [] : null,
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  if (env.CORS_ORIGIN) {
    const allowed = env.CORS_ORIGIN.split(',').map((o) => o.trim());
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Dawa-Client');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') return void res.status(204).end();
      next();
    });
  }
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  });

  app.use('/uploads', express.static(PUBLIC_DIR, { maxAge: '7d', index: false, dotfiles: 'deny' }));

  const api = Router();
  api.use(apiLimiter);
  api.use(camelCaseResponses);
  api.use('/auth', authRouter);
  api.use('/public', publicSettingsRouter);
  api.use('/public/receipts', publicReceiptRouter);

  const secured = Router();
  secured.use(authenticate);
  secured.use('/users', usersRouter);
  secured.use('/roles', rolesRouter);
  secured.use('/products', productsRouter);
  secured.use('/categories', categoriesRouter);
  secured.use('/manufacturers', manufacturersRouter);
  secured.use('/inventory', inventoryRouter);
  secured.use('/suppliers', suppliersRouter);
  secured.use('/purchasing', purchasingRouter);
  secured.use('/customers', customersRouter);
  secured.use('/sales', salesRouter);
  secured.use('/prescriptions', prescriptionsRouter);
  secured.use('/expenses', expensesRouter);
  secured.use('/insurance', insuranceRouter);
  secured.use('/reports', reportsRouter);
  secured.use('/dashboard', dashboardRouter);
  secured.use('/notifications', notificationsRouter);
  secured.use('/search', searchRouter);
  secured.use('/audit-logs', auditRouter);
  secured.use('/settings', settingsRouter);
  secured.use('/backups', backupsRouter);
  secured.use('/branches', branchesRouter);
  api.use(secured);

  app.use('/api', api);
  app.use('/api', notFoundHandler);

  if (env.SERVE_WEB) {
    const dist = path.resolve(env.WEB_DIST_DIR);
    if (existsSync(dist)) {
      app.use(express.static(dist, { index: false, maxAge: '1h' }));
      app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    } else {
      logger.warn({ dist }, 'SERVE_WEB is true but the web build was not found');
    }
  }

  app.use(errorHandler);
  return app;
}
