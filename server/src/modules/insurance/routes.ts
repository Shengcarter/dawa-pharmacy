import { Router } from 'express';
import { z } from 'zod';
import {
  claimListQuery, claimPaymentSchema, closeClaimSchema, insuranceSchemeSchema, schemePricesSchema, submitClaimsSchema,
} from '@dawa/shared';
import { actorOf, requirePermission } from '../../middleware/auth';
import { sendCsv } from '../../lib/csv';
import * as insurance from './service';

const idParam = (v: unknown) => z.coerce.number().int().positive().parse(v);

export const insuranceRouter = Router();

// ---- Schemes ---------------------------------------------------------------
insuranceRouter.get('/schemes', requirePermission('insurance.view', 'insurance.manage', 'customers.manage', 'pos.sell'), async (req, res) => {
  const all = req.query.all === 'true';
  res.json(await insurance.listSchemes(all));
});
insuranceRouter.get('/schemes/:id', requirePermission('insurance.view', 'insurance.manage'), async (req, res) => {
  res.json(await insurance.getScheme(idParam(req.params.id)));
});
insuranceRouter.post('/schemes', requirePermission('insurance.manage'), async (req, res) => {
  res.status(201).json(await insurance.createScheme(actorOf(req), insuranceSchemeSchema.parse(req.body)));
});
insuranceRouter.put('/schemes/:id', requirePermission('insurance.manage'), async (req, res) => {
  res.json(await insurance.updateScheme(actorOf(req), idParam(req.params.id), insuranceSchemeSchema.parse(req.body)));
});

// ---- Price lists -------------------------------------------------------------
insuranceRouter.get('/schemes/:id/prices', requirePermission('insurance.view', 'insurance.manage'), async (req, res) => {
  const q = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().trim().max(100).optional(),
  }).parse(req.query);
  res.json(await insurance.listSchemePrices(idParam(req.params.id), q));
});
insuranceRouter.get('/schemes/:id/prices/export', requirePermission('insurance.view', 'insurance.manage'), async (req, res) => {
  const scheme = await insurance.getScheme(idParam(req.params.id));
  const rows = await insurance.allSchemePrices(scheme.id);
  sendCsv(res, `${scheme.code.toLowerCase()}-price-list.csv`, [
    { header: 'SKU', value: (r) => r.sku },
    { header: 'Product', value: (r) => [r.name, r.strength].filter(Boolean).join(' ') },
    { header: 'Unit', value: (r) => r.unit },
    { header: 'Normal price', value: (r) => r.selling_price },
    { header: 'Scheme price', value: (r) => r.unit_price },
  ], rows);
});
/** Agreed prices for the products in the till's cart. */
insuranceRouter.get('/schemes/:id/cart-prices', requirePermission('pos.sell'), async (req, res) => {
  const ids = z.string().regex(/^\d+(,\d+)*$/).transform((s) => s.split(',').map(Number)).pipe(z.array(z.number().int().positive()).max(200)).parse(req.query.productIds ?? '');
  res.json(await insurance.pricesForProducts(idParam(req.params.id), ids));
});
insuranceRouter.put('/schemes/:id/prices', requirePermission('insurance.manage'), async (req, res) => {
  const { prices } = schemePricesSchema.parse(req.body);
  res.json(await insurance.saveSchemePrices(actorOf(req), idParam(req.params.id), prices));
});
insuranceRouter.post('/schemes/:id/prices/import', requirePermission('insurance.manage'), async (req, res) => {
  const { rows } = z.object({
    rows: z.array(z.object({
      sku: z.string().trim().min(1, 'SKU is required').max(40),
      unitPrice: z.union([z.literal(''), z.null()]).transform(() => null).or(z.coerce.number().positive('Prices must be above zero').max(99_999_999_999)),
    })).min(1, 'The file has no price rows').max(5000),
  }).parse(req.body);
  res.json(await insurance.importSchemePrices(actorOf(req), idParam(req.params.id), rows));
});

// ---- Claims ------------------------------------------------------------------
insuranceRouter.get('/claims/summary', requirePermission('insurance.view', 'insurance.claims'), async (req, res) => {
  res.json(await insurance.claimSummary(actorOf(req)));
});
insuranceRouter.get('/claims', requirePermission('insurance.view', 'insurance.claims'), async (req, res) => {
  res.json(await insurance.listClaims(actorOf(req), claimListQuery.parse(req.query)));
});
insuranceRouter.get('/claims/:id', requirePermission('insurance.view', 'insurance.claims'), async (req, res) => {
  res.json(await insurance.getClaim(actorOf(req), idParam(req.params.id)));
});
insuranceRouter.post('/claims/submit', requirePermission('insurance.claims'), async (req, res) => {
  const { claimIds, submissionRef } = submitClaimsSchema.parse(req.body);
  res.json(await insurance.submitClaims(actorOf(req), claimIds, submissionRef));
});
insuranceRouter.post('/claims/:id/payments', requirePermission('insurance.claims'), async (req, res) => {
  res.status(201).json(await insurance.recordClaimPayment(actorOf(req), idParam(req.params.id), claimPaymentSchema.parse(req.body)));
});
insuranceRouter.post('/claims/:id/close', requirePermission('insurance.claims'), async (req, res) => {
  res.json(await insurance.closeClaim(actorOf(req), idParam(req.params.id), closeClaimSchema.parse(req.body)));
});
