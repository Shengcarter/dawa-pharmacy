import { pool, withTransaction, type Tx } from '../../db/pool';
import { occurredAt, type Actor } from '../../lib/actor';
import { audit } from '../../lib/audit';
import { notFound, unprocessable } from '../../lib/errors';
import { likeParam, pageParams, paginated } from '../../lib/pagination';
import { nextDocumentNumber } from '../../lib/sequences';
import { businessToday } from '../../lib/today';

interface RxInput {
  customerId: number;
  prescriberName: string;
  prescriberFacility: string | null;
  prescriberRegNo: string | null;
  prescriptionDate: string;
  validUntil: string | null;
  diagnosisNote: string | null;
  notes: string | null;
  items: { productId: number; dosageInstructions: string; quantity: number; durationDays: number | null; refillsAllowed: number }[];
}

/** Status follows dispensing: nothing → pending, some → partially dispensed, all fills → dispensed. */
export async function recomputePrescriptionStatus(tx: Tx, prescriptionId: number) {
  await tx.query(
    `UPDATE prescriptions p SET status = CASE
         WHEN p.status = 'cancelled' THEN 'cancelled'
         WHEN agg.done THEN 'dispensed'
         WHEN agg.any THEN 'partially_dispensed'
         ELSE 'pending' END,
       updated_at = now()
       FROM (SELECT bool_and(quantity_dispensed >= quantity * (refills_allowed + 1)) AS done, bool_or(quantity_dispensed > 0) AS any
               FROM prescription_items WHERE prescription_id = $1) agg
      WHERE p.id = $1`,
    [prescriptionId],
  );
}

export async function listPrescriptions(
  actor: Actor,
  q: { page: number; pageSize: number; search?: string; status?: string; customerId?: number; from?: string | null; to?: string | null },
) {
  const params: unknown[] = [actor.branchId];
  const where = ['rx.branch_id = $1'];
  if (q.search) {
    params.push(likeParam(q.search));
    where.push(`(rx.rx_number ILIKE $${params.length} OR c.full_name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR rx.prescriber_name ILIKE $${params.length})`);
  }
  if (q.status) { params.push(q.status); where.push(`rx.status = $${params.length}`); }
  if (q.customerId) { params.push(q.customerId); where.push(`rx.customer_id = $${params.length}`); }
  if (q.from) { params.push(q.from); where.push(`rx.prescription_date >= $${params.length}::date`); }
  if (q.to) { params.push(q.to); where.push(`rx.prescription_date <= $${params.length}::date`); }
  const { limit, offset } = pageParams(q.page, q.pageSize);
  const { rows } = await pool.query(
    `SELECT rx.id, rx.rx_number, rx.prescription_date, rx.valid_until, rx.status, rx.prescriber_name, rx.prescriber_facility, rx.created_at,
            c.id AS customer_id, c.full_name AS customer_name, c.phone AS customer_phone, u.full_name AS recorded_by_name,
            (SELECT count(*)::int FROM prescription_items i WHERE i.prescription_id = rx.id) AS item_count,
            (SELECT max(d.dispensed_at) FROM prescription_dispensings d WHERE d.prescription_id = rx.id) AS last_dispensed_at,
            count(*) OVER() AS total_count
       FROM prescriptions rx JOIN customers c ON c.id = rx.customer_id JOIN users u ON u.id = rx.recorded_by
      WHERE ${where.join(' AND ')} ORDER BY rx.created_at DESC, rx.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return paginated(rows.map(({ total_count: _t, ...r }) => r), rows[0]?.total_count ?? 0, q.page, q.pageSize);
}

export async function getPrescription(actor: Actor, id: number) {
  const today = await businessToday();
  const { rows } = await pool.query(
    `SELECT rx.*, c.full_name AS customer_name, c.phone AS customer_phone, c.code AS customer_code, c.date_of_birth, c.gender,
            u.full_name AS recorded_by_name, (rx.valid_until IS NOT NULL AND rx.valid_until < $3::date) AS is_expired
       FROM prescriptions rx JOIN customers c ON c.id = rx.customer_id JOIN users u ON u.id = rx.recorded_by
      WHERE rx.id = $1 AND rx.branch_id = $2`,
    [id, actor.branchId, today],
  );
  if (!rows[0]) throw notFound('Prescription');
  const items = await pool.query(
    `SELECT i.*, p.name AS product_name, p.sku, p.strength, p.unit, p.requires_prescription, p.selling_price,
            (i.quantity * (i.refills_allowed + 1) - i.quantity_dispensed) AS quantity_remaining
       FROM prescription_items i JOIN products p ON p.id = i.product_id WHERE i.prescription_id = $1 ORDER BY i.id`,
    [id],
  );
  const history = await pool.query(
    `SELECT d.id, d.quantity, d.dispensed_at, p.name AS product_name, s.id AS sale_id, s.invoice_no, u.full_name AS dispensed_by_name
       FROM prescription_dispensings d JOIN prescription_items i ON i.id = d.prescription_item_id JOIN products p ON p.id = i.product_id
       JOIN sales s ON s.id = d.sale_id JOIN users u ON u.id = d.dispensed_by
      WHERE d.prescription_id = $1 ORDER BY d.dispensed_at DESC, d.id DESC`,
    [id],
  );
  return { ...rows[0], items: items.rows, dispensings: history.rows };
}

async function validate(tx: Tx, d: RxInput, today: string) {
  const c = await tx.query('SELECT full_name, status FROM customers WHERE id = $1', [d.customerId]);
  if (!c.rows[0]) throw unprocessable('Patient not found.');
  if (d.prescriptionDate > today) throw unprocessable('Prescription date cannot be in the future.');
  if (d.validUntil && d.validUntil < d.prescriptionDate) throw unprocessable('"Valid until" must be on or after the prescription date.');
  const ids = d.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) throw unprocessable('Each medicine can appear only once; combine the quantities.');
  const p = await tx.query('SELECT id FROM products WHERE id = ANY($1::int[])', [ids]);
  if (p.rowCount !== ids.length) throw unprocessable('One of the medicines no longer exists.');
  return c.rows[0].full_name as string;
}

async function writeItems(tx: Tx, id: number, items: RxInput['items']) {
  await tx.query('DELETE FROM prescription_items WHERE prescription_id = $1', [id]);
  for (const i of items) {
    await tx.query(
      `INSERT INTO prescription_items (prescription_id, product_id, dosage_instructions, quantity, duration_days, refills_allowed)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, i.productId, i.dosageInstructions, i.quantity, i.durationDays, i.refillsAllowed],
    );
  }
}

export async function createPrescription(actor: Actor, d: RxInput) {
  const today = await businessToday(actor);
  return withTransaction(async (tx) => {
    const patient = await validate(tx, d, today);
    const at = occurredAt(actor);
    const rxNumber = await nextDocumentNumber(tx, 'RX', at);
    const { rows } = await tx.query(
      `INSERT INTO prescriptions (rx_number, branch_id, customer_id, prescriber_name, prescriber_facility, prescriber_reg_no,
                                  prescription_date, valid_until, diagnosis_note, notes, recorded_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
      [rxNumber, actor.branchId, d.customerId, d.prescriberName, d.prescriberFacility, d.prescriberRegNo, d.prescriptionDate,
       d.validUntil, d.diagnosisNote, d.notes, actor.userId, at],
    );
    await writeItems(tx, rows[0].id, d.items);
    await audit(tx, actor, {
      action: 'create', module: 'prescriptions', entityType: 'prescription', entityId: rows[0].id,
      summary: `${actor.userName} recorded prescription ${rxNumber} for ${patient} from ${d.prescriberName} (${d.items.length} item(s))`,
    });
    return { id: rows[0].id, rxNumber };
  });
}

export async function updatePrescription(actor: Actor, id: number, d: RxInput) {
  const today = await businessToday(actor);
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM prescriptions WHERE id = $1 AND branch_id = $2 FOR UPDATE', [id, actor.branchId]);
    if (!rows[0]) throw notFound('Prescription');
    if (rows[0].status !== 'pending') throw unprocessable('Only prescriptions that have not been dispensed can be edited.');
    await validate(tx, d, today);
    await tx.query(
      `UPDATE prescriptions SET customer_id=$2, prescriber_name=$3, prescriber_facility=$4, prescriber_reg_no=$5, prescription_date=$6,
              valid_until=$7, diagnosis_note=$8, notes=$9, updated_at=now() WHERE id=$1`,
      [id, d.customerId, d.prescriberName, d.prescriberFacility, d.prescriberRegNo, d.prescriptionDate, d.validUntil, d.diagnosisNote, d.notes],
    );
    await writeItems(tx, id, d.items);
    await audit(tx, actor, { action: 'update', module: 'prescriptions', entityType: 'prescription', entityId: id, summary: `${actor.userName} edited prescription ${rows[0].rx_number}` });
    return { id };
  });
}

export async function cancelPrescription(actor: Actor, id: number, reason: string) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM prescriptions WHERE id = $1 AND branch_id = $2 FOR UPDATE', [id, actor.branchId]);
    if (!rows[0]) throw notFound('Prescription');
    if (['cancelled', 'dispensed'].includes(rows[0].status)) throw unprocessable(`This prescription is already ${rows[0].status}.`);
    await tx.query(`UPDATE prescriptions SET status = 'cancelled', cancelled_reason = $2, updated_at = now() WHERE id = $1`, [id, reason]);
    await audit(tx, actor, {
      action: 'cancel', module: 'prescriptions', entityType: 'prescription', entityId: id,
      summary: `${actor.userName} cancelled prescription ${rows[0].rx_number}: ${reason}`,
      oldValues: { status: rows[0].status }, newValues: { status: 'cancelled' },
    });
  });
}
