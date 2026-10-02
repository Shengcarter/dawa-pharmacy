/**
 * Shared SQL for product-level stock figures, computed from batches.
 * Parameters are referenced by the placeholders passed in.
 */
export function stockLateral(branchParam: string, todayParam: string) {
  return `LEFT JOIN LATERAL (
      SELECT COALESCE(sum(b.quantity_on_hand), 0)::int AS on_hand,
             COALESCE(sum(b.quantity_on_hand) FILTER (
               WHERE b.status = 'active' AND (b.expiry_date IS NULL OR b.expiry_date >= ${todayParam}::date)), 0)::int AS sellable,
             COALESCE(sum(b.quantity_on_hand) FILTER (WHERE b.expiry_date < ${todayParam}::date), 0)::int AS expired_qty,
             COALESCE(sum(b.quantity_on_hand * b.unit_cost), 0)::numeric(14,2) AS stock_value,
             min(b.expiry_date) FILTER (WHERE b.quantity_on_hand > 0 AND b.expiry_date >= ${todayParam}::date) AS nearest_expiry,
             count(*) FILTER (WHERE b.quantity_on_hand > 0)::int AS batch_count
        FROM product_batches b
       WHERE b.product_id = p.id AND b.branch_id = ${branchParam}
    ) s ON TRUE`;
}

/** in_stock | low_stock | critical | out_of_stock | expired, from sellable quantity vs reorder level. */
export function stockStatusSql(criticalPercentParam: string) {
  return `CASE
      WHEN s.sellable = 0 AND s.expired_qty > 0 THEN 'expired'
      WHEN s.sellable = 0 THEN 'out_of_stock'
      WHEN s.sellable <= floor(p.reorder_level * ${criticalPercentParam}::numeric / 100) THEN 'critical'
      WHEN s.sellable <= p.reorder_level THEN 'low_stock'
      ELSE 'in_stock' END`;
}
