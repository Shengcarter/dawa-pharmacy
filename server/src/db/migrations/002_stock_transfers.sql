-- Stock transfers between branches. Each line moves units of one batch; the
-- destination receives the same batch number, expiry and unit cost.
CREATE TABLE stock_transfers (
  id              SERIAL PRIMARY KEY,
  transfer_no     VARCHAR(30) NOT NULL UNIQUE,
  from_branch_id  INTEGER NOT NULL REFERENCES branches(id),
  to_branch_id    INTEGER NOT NULL REFERENCES branches(id),
  notes           VARCHAR(500),
  total_cost      NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_branch_id <> to_branch_id)
);
CREATE INDEX stock_transfers_created_idx ON stock_transfers (created_at DESC);

CREATE TABLE stock_transfer_items (
  id                SERIAL PRIMARY KEY,
  transfer_id       INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id        INTEGER NOT NULL REFERENCES products(id),
  from_batch_id     INTEGER NOT NULL REFERENCES product_batches(id),
  to_batch_id       INTEGER NOT NULL REFERENCES product_batches(id),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost         NUMERIC(14,2) NOT NULL
);
CREATE INDEX stock_transfer_items_transfer_idx ON stock_transfer_items (transfer_id);
