import { Router } from 'express';
import { publicReceipt } from './service';

/** Unauthenticated digital receipt, addressed by a 128-bit random token. */
export const publicReceiptRouter = Router();
publicReceiptRouter.get('/:token', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.json(await publicReceipt(req.params.token));
});
