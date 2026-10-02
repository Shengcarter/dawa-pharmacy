-- Insurance schemes, their agreed price lists, and claims for the insurer's share of a sale.
CREATE TABLE insurance_schemes (
  id                   SERIAL PRIMARY KEY,
  code                 VARCHAR(20) NOT NULL UNIQUE,
  name                 VARCHAR(120) NOT NULL,
  contact_name         VARCHAR(120),
  phone                VARCHAR(30),
  email                VARCHAR(150),
  address              VARCHAR(300),
  -- Share of each covered line the patient pays at the till.
  copay_percent        NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (copay_percent BETWEEN 0 AND 100),
  -- 'listed_only': only medicines on the price list are covered (others are paid by the patient);
  -- 'all_products': unlisted medicines are covered at the normal selling price.
  coverage             VARCHAR(20) NOT NULL DEFAULT 'listed_only' CHECK (coverage IN ('listed_only', 'all_products')),
  requires_prescription BOOLEAN NOT NULL DEFAULT TRUE,
  claim_terms_days     INTEGER NOT NULL DEFAULT 30 CHECK (claim_terms_days BETWEEN 0 AND 365),
  status               VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes                VARCHAR(1000),
  created_by           INTEGER REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX insurance_schemes_name_idx ON insurance_schemes (lower(name));

-- Agreed price per base unit (strip, bottle…) for each product the scheme covers.
CREATE TABLE insurance_scheme_prices (
  scheme_id   INTEGER NOT NULL REFERENCES insurance_schemes(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_price  NUMERIC(14,2) NOT NULL CHECK (unit_price > 0),
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scheme_id, product_id)
);

ALTER TABLE customers ADD COLUMN insurance_scheme_id INTEGER REFERENCES insurance_schemes(id);

-- Existing free-text providers become schemes so patients keep their cover.
INSERT INTO insurance_schemes (code, name)
SELECT 'INS' || lpad(row_number() OVER (ORDER BY min(id))::text, 3, '0'), min(trim(insurance_provider))
  FROM customers WHERE trim(COALESCE(insurance_provider, '')) <> ''
 GROUP BY lower(trim(insurance_provider));
UPDATE customers c SET insurance_scheme_id = s.id
  FROM insurance_schemes s WHERE lower(trim(c.insurance_provider)) = lower(s.name);

-- The insurer's share of a sale; the patient's share is amount_paid + balance_due.
ALTER TABLE sales
  ADD COLUMN insurance_scheme_id INTEGER REFERENCES insurance_schemes(id),
  ADD COLUMN insurance_member_no VARCHAR(60),
  ADD COLUMN insurance_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (insurance_amount >= 0);
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_type_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_type_check
  CHECK (payment_type IN ('cash','card','mobile_money','bank_transfer','store_credit','credit','split','insurance'));
ALTER TABLE sale_items ADD COLUMN insurance_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (insurance_amount >= 0);
ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS sale_items_price_source_check;
ALTER TABLE sale_items ADD CONSTRAINT sale_items_price_source_check
  CHECK (price_source IN ('standard', 'pack', 'wholesale', 'quantity', 'manual', 'insurance'));
ALTER TABLE sale_returns ADD COLUMN insurance_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (insurance_amount >= 0);
-- A return is settled by reducing the patient's balance, refunding them, and reducing the insurance claim.
ALTER TABLE sale_returns DROP CONSTRAINT sale_returns_check;
ALTER TABLE sale_returns ADD CONSTRAINT sale_returns_check CHECK (balance_reduction + refund_amount + insurance_amount = total_amount);
ALTER TABLE sale_return_items ADD COLUMN insurance_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

CREATE TABLE insurance_claims (
  id                 SERIAL PRIMARY KEY,
  claim_no           VARCHAR(30) NOT NULL UNIQUE,
  scheme_id          INTEGER NOT NULL REFERENCES insurance_schemes(id),
  sale_id            INTEGER NOT NULL UNIQUE REFERENCES sales(id),
  branch_id          INTEGER NOT NULL REFERENCES branches(id),
  customer_id        INTEGER NOT NULL REFERENCES customers(id),
  member_no          VARCHAR(60) NOT NULL,
  -- What the insurer owes; reduced by returns while the claim is still pending.
  amount             NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  amount_paid        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  written_off        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (written_off >= 0),
  billed_to_patient  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (billed_to_patient >= 0),
  status             VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'submitted', 'partially_paid', 'paid', 'rejected', 'closed', 'cancelled')),
  submission_ref     VARCHAR(80),
  submitted_at       TIMESTAMPTZ,
  submitted_by       INTEGER REFERENCES users(id),
  closed_at          TIMESTAMPTZ,
  close_reason       VARCHAR(300),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (amount_paid + written_off + billed_to_patient <= amount)
);
CREATE INDEX insurance_claims_status_idx ON insurance_claims (scheme_id, status, created_at);

CREATE TABLE insurance_claim_payments (
  id          SERIAL PRIMARY KEY,
  claim_id    INTEGER NOT NULL REFERENCES insurance_claims(id),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_on     DATE NOT NULL,
  method      VARCHAR(20) NOT NULL CHECK (method IN ('bank_transfer', 'cheque', 'mobile_money', 'cash')),
  reference   VARCHAR(80),
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX insurance_claim_payments_claim_idx ON insurance_claim_payments (claim_id);

-- Fiscal receipts issued on a separate TRA EFD machine are recorded against the sale.
ALTER TABLE sales
  ADD COLUMN efd_receipt_no VARCHAR(60),
  ADD COLUMN efd_recorded_by INTEGER REFERENCES users(id),
  ADD COLUMN efd_recorded_at TIMESTAMPTZ;
CREATE INDEX sales_efd_missing_idx ON sales (branch_id, created_at) WHERE efd_receipt_no IS NULL;
