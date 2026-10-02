-- Dawa Pharmacy — initial schema
-- Money: NUMERIC(14,2). Quantities: INTEGER in the product's base unit.
-- Timestamps: timestamptz. "Today" is evaluated in the pharmacy time zone by the API.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Organisation, identity and access
-- ---------------------------------------------------------------------------
CREATE TABLE branches (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(20)  NOT NULL UNIQUE,
  name        VARCHAR(120) NOT NULL,
  address     VARCHAR(300),
  phone       VARCHAR(40),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(40)  NOT NULL UNIQUE,
  name        VARCHAR(60)  NOT NULL UNIQUE,
  description VARCHAR(200),
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(60) NOT NULL UNIQUE,
  module      VARCHAR(40) NOT NULL,
  description VARCHAR(200) NOT NULL
);

CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id                    SERIAL PRIMARY KEY,
  branch_id             INTEGER NOT NULL REFERENCES branches(id),
  full_name             VARCHAR(120) NOT NULL,
  email                 VARCHAR(160) NOT NULL,
  phone                 VARCHAR(40),
  job_title             VARCHAR(80),
  password_hash         VARCHAR(100) NOT NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_count    INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  password_changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  preferences           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role_id)
);

-- Refresh-token sessions. Only a SHA-256 hash of the token is stored.
CREATE TABLE auth_sessions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    CHAR(64) NOT NULL UNIQUE,
  family_id     UUID NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  revoked_reason VARCHAR(40),
  replaced_by   BIGINT REFERENCES auth_sessions(id),
  ip            VARCHAR(64),
  user_agent    VARCHAR(300),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX auth_sessions_family_idx ON auth_sessions (family_id);

CREATE TABLE password_resets (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE login_activity (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email       VARCHAR(160) NOT NULL,
  event       VARCHAR(30) NOT NULL CHECK (event IN ('login', 'login_failed', 'logout', 'locked', 'password_reset', 'password_changed', 'token_reuse')),
  ip          VARCHAR(64),
  user_agent  VARCHAR(300),
  detail      VARCHAR(200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX login_activity_user_idx ON login_activity (user_id, created_at DESC);
CREATE INDEX login_activity_created_idx ON login_activity (created_at DESC);

-- ---------------------------------------------------------------------------
-- Settings and document numbering
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  section     VARCHAR(40) PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE document_sequences (
  key         VARCHAR(40) PRIMARY KEY,
  last_value  BIGINT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description VARCHAR(300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_name_unique ON categories (lower(name));

CREATE TABLE manufacturers (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  country     VARCHAR(80),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX manufacturers_name_unique ON manufacturers (lower(name));

CREATE TABLE suppliers (
  id                  SERIAL PRIMARY KEY,
  code                VARCHAR(20) NOT NULL UNIQUE,
  name                VARCHAR(150) NOT NULL,
  contact_person      VARCHAR(120),
  phone               VARCHAR(40) NOT NULL,
  email               VARCHAR(160),
  address             VARCHAR(300),
  tin                 VARCHAR(30),
  vrn                 VARCHAR(30),
  payment_terms_days  INTEGER NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
  credit_limit        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes               VARCHAR(1000),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_name_unique ON suppliers (lower(name));
CREATE INDEX suppliers_name_trgm ON suppliers USING gin (name gin_trgm_ops);

CREATE TABLE products (
  id                     SERIAL PRIMARY KEY,
  sku                    VARCHAR(40) NOT NULL UNIQUE,
  barcode                VARCHAR(32) UNIQUE,
  name                   VARCHAR(150) NOT NULL,
  generic_name           VARCHAR(150),
  brand_name             VARCHAR(150),
  product_type           VARCHAR(30) NOT NULL CHECK (product_type IN (
                           'tablet','capsule','syrup','injection','cream','ointment','drops','powder','inhaler',
                           'medical_device','supplement','personal_care','other')),
  category_id            INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  manufacturer_id        INTEGER REFERENCES manufacturers(id) ON DELETE SET NULL,
  default_supplier_id    INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  dosage_form            VARCHAR(60),
  strength               VARCHAR(60),
  unit                   VARCHAR(30) NOT NULL,
  pack_size              INTEGER NOT NULL DEFAULT 1 CHECK (pack_size >= 1),
  purchase_price         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  selling_price          NUMERIC(14,2) NOT NULL CHECK (selling_price > 0),
  wholesale_price        NUMERIC(14,2) CHECK (wholesale_price >= 0),
  min_selling_price      NUMERIC(14,2) CHECK (min_selling_price >= 0),
  reorder_level          INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  max_stock_level        INTEGER CHECK (max_stock_level >= 0),
  requires_prescription  BOOLEAN NOT NULL DEFAULT FALSE,
  is_batch_tracked       BOOLEAN NOT NULL DEFAULT TRUE,
  tax_rate               NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
  status                 VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','discontinued')),
  image_path             VARCHAR(300),
  description            TEXT,
  storage_instructions   VARCHAR(500),
  created_by             INTEGER REFERENCES users(id),
  updated_by             INTEGER REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_selling_price IS NULL OR min_selling_price <= selling_price)
);
CREATE INDEX products_category_idx ON products (category_id);
CREATE INDEX products_supplier_idx ON products (default_supplier_id);
CREATE INDEX products_status_idx ON products (status);
CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX products_generic_trgm ON products USING gin (generic_name gin_trgm_ops);
CREATE INDEX products_brand_trgm ON products USING gin (brand_name gin_trgm_ops);

CREATE TABLE supplier_products (
  supplier_id   INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_sku  VARCHAR(60),
  last_cost     NUMERIC(14,2),
  last_supplied_at TIMESTAMPTZ,
  PRIMARY KEY (supplier_id, product_id)
);
CREATE INDEX supplier_products_product_idx ON supplier_products (product_id);

-- ---------------------------------------------------------------------------
-- Stock: batches are the stock-on-hand ledger
-- ---------------------------------------------------------------------------
CREATE TABLE product_batches (
  id                 SERIAL PRIMARY KEY,
  product_id         INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  branch_id          INTEGER NOT NULL REFERENCES branches(id),
  batch_number       VARCHAR(60) NOT NULL,
  manufacture_date   DATE,
  expiry_date        DATE,
  quantity_received  INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_on_hand   INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  unit_cost          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  selling_price      NUMERIC(14,2) CHECK (selling_price > 0),
  supplier_id        INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','quarantined','disposed')),
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, branch_id, batch_number),
  CHECK (manufacture_date IS NULL OR expiry_date IS NULL OR manufacture_date < expiry_date)
);
-- FEFO lookup: sellable batches of a product ordered by expiry.
CREATE INDEX product_batches_fefo_idx ON product_batches (product_id, branch_id, expiry_date NULLS LAST, id)
  WHERE quantity_on_hand > 0;
CREATE INDEX product_batches_expiry_idx ON product_batches (expiry_date) WHERE quantity_on_hand > 0;
CREATE INDEX product_batches_supplier_idx ON product_batches (supplier_id);
CREATE INDEX product_batches_number_trgm ON product_batches USING gin (batch_number gin_trgm_ops);

CREATE TABLE inventory_movements (
  id              BIGSERIAL PRIMARY KEY,
  branch_id       INTEGER NOT NULL REFERENCES branches(id),
  product_id      INTEGER NOT NULL REFERENCES products(id),
  batch_id        INTEGER NOT NULL REFERENCES product_batches(id),
  movement_type   VARCHAR(20) NOT NULL CHECK (movement_type IN (
                    'opening','purchase','sale','sale_return','adjustment_in','adjustment_out',
                    'damaged','expired','correction','transfer_in','transfer_out')),
  quantity        INTEGER NOT NULL CHECK (quantity <> 0),
  quantity_before INTEGER NOT NULL,
  quantity_after  INTEGER NOT NULL CHECK (quantity_after >= 0),
  unit_cost       NUMERIC(14,2) NOT NULL,
  reason          VARCHAR(300),
  reference_type  VARCHAR(30),
  reference_id    BIGINT,
  reference_no    VARCHAR(40),
  user_id         INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (quantity_after = quantity_before + quantity)
);
CREATE INDEX inventory_movements_product_idx ON inventory_movements (product_id, created_at DESC);
CREATE INDEX inventory_movements_batch_idx ON inventory_movements (batch_id, created_at DESC);
CREATE INDEX inventory_movements_created_idx ON inventory_movements (created_at DESC);
CREATE INDEX inventory_movements_type_idx ON inventory_movements (movement_type, created_at DESC);
CREATE INDEX inventory_movements_ref_idx ON inventory_movements (reference_type, reference_id);

CREATE TABLE stock_adjustments (
  id               SERIAL PRIMARY KEY,
  adjustment_no    VARCHAR(30) NOT NULL UNIQUE,
  branch_id        INTEGER NOT NULL REFERENCES branches(id),
  batch_id         INTEGER NOT NULL REFERENCES product_batches(id),
  product_id       INTEGER NOT NULL REFERENCES products(id),
  adjustment_type  VARCHAR(20) NOT NULL CHECK (adjustment_type IN ('adjustment_in','adjustment_out','damaged','expired','correction')),
  quantity_before  INTEGER NOT NULL,
  quantity_after   INTEGER NOT NULL CHECK (quantity_after >= 0),
  unit_cost        NUMERIC(14,2) NOT NULL,
  reason           VARCHAR(300) NOT NULL,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_adjustments_created_idx ON stock_adjustments (created_at DESC);

-- Product-level totals derived from batches (no duplicated stock column).
CREATE VIEW v_product_stock AS
SELECT
  p.id AS product_id,
  b.branch_id,
  COALESCE(SUM(b.quantity_on_hand), 0)::int AS on_hand,
  COALESCE(SUM(b.quantity_on_hand * b.unit_cost), 0)::numeric(14,2) AS stock_value,
  MIN(b.expiry_date) FILTER (WHERE b.quantity_on_hand > 0) AS nearest_expiry
FROM products p
LEFT JOIN product_batches b ON b.product_id = p.id
GROUP BY p.id, b.branch_id;

-- ---------------------------------------------------------------------------
-- Customers / patients
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  id                    SERIAL PRIMARY KEY,
  code                  VARCHAR(20) NOT NULL UNIQUE,
  full_name             VARCHAR(150) NOT NULL,
  phone                 VARCHAR(40),
  email                 VARCHAR(160),
  address               VARCHAR(300),
  date_of_birth         DATE,
  gender                VARCHAR(20) CHECK (gender IN ('female','male','other','unspecified')),
  customer_type         VARCHAR(20) NOT NULL DEFAULT 'regular' CHECK (customer_type IN ('walk_in','regular','insurance','corporate','wholesale')),
  insurance_provider    VARCHAR(120),
  insurance_member_no   VARCHAR(60),
  credit_limit          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  store_credit_balance  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (store_credit_balance >= 0),
  notes                 VARCHAR(1000),
  status                VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by            INTEGER REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_phone_unique ON customers (phone) WHERE phone IS NOT NULL;
CREATE INDEX customers_name_trgm ON customers USING gin (full_name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Prescriptions
-- ---------------------------------------------------------------------------
CREATE TABLE prescriptions (
  id                    SERIAL PRIMARY KEY,
  rx_number             VARCHAR(30) NOT NULL UNIQUE,
  branch_id             INTEGER NOT NULL REFERENCES branches(id),
  customer_id           INTEGER NOT NULL REFERENCES customers(id),
  prescriber_name       VARCHAR(150) NOT NULL,
  prescriber_facility   VARCHAR(150),
  prescriber_reg_no     VARCHAR(60),
  prescription_date     DATE NOT NULL,
  valid_until           DATE,
  diagnosis_note        VARCHAR(300),
  notes                 VARCHAR(1000),
  status                VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partially_dispensed','dispensed','cancelled')),
  recorded_by           INTEGER NOT NULL REFERENCES users(id),
  cancelled_reason      VARCHAR(300),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX prescriptions_customer_idx ON prescriptions (customer_id, prescription_date DESC);
CREATE INDEX prescriptions_status_idx ON prescriptions (status, created_at DESC);

CREATE TABLE prescription_items (
  id                    SERIAL PRIMARY KEY,
  prescription_id       INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  product_id            INTEGER NOT NULL REFERENCES products(id),
  dosage_instructions   VARCHAR(300) NOT NULL,
  quantity              INTEGER NOT NULL CHECK (quantity > 0),
  duration_days         INTEGER CHECK (duration_days >= 0),
  refills_allowed       INTEGER NOT NULL DEFAULT 0 CHECK (refills_allowed BETWEEN 0 AND 12),
  quantity_dispensed    INTEGER NOT NULL DEFAULT 0 CHECK (quantity_dispensed >= 0),
  CHECK (quantity_dispensed <= quantity * (refills_allowed + 1))
);
CREATE INDEX prescription_items_rx_idx ON prescription_items (prescription_id);

-- ---------------------------------------------------------------------------
-- Sales, payments, returns
-- ---------------------------------------------------------------------------
CREATE TABLE sales (
  id                SERIAL PRIMARY KEY,
  invoice_no        VARCHAR(30) NOT NULL UNIQUE,
  branch_id         INTEGER NOT NULL REFERENCES branches(id),
  customer_id       INTEGER REFERENCES customers(id),
  prescription_id   INTEGER REFERENCES prescriptions(id),
  cashier_id        INTEGER NOT NULL REFERENCES users(id),
  status            VARCHAR(30) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','partially_returned','returned')),
  payment_type      VARCHAR(20) NOT NULL CHECK (payment_type IN ('cash','card','mobile_money','bank_transfer','store_credit','credit','split')),
  payment_status    VARCHAR(20) NOT NULL CHECK (payment_status IN ('paid','partial','unpaid')),
  subtotal          NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
  discount_total    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total             NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  amount_paid       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  balance_due       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance_due >= 0),
  cost_total        NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_inclusive     BOOLEAN NOT NULL,
  cash_tendered     NUMERIC(14,2),
  change_given      NUMERIC(14,2),
  notes             VARCHAR(500),
  receipt_token     CHAR(32) NOT NULL UNIQUE,
  idempotency_key   VARCHAR(64) UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sales_created_idx ON sales (branch_id, created_at DESC);
CREATE INDEX sales_customer_idx ON sales (customer_id, created_at DESC);
CREATE INDEX sales_cashier_idx ON sales (cashier_id, created_at DESC);
CREATE INDEX sales_balance_idx ON sales (customer_id) WHERE balance_due > 0;
CREATE INDEX sales_invoice_trgm ON sales USING gin (invoice_no gin_trgm_ops);

-- One row per batch actually sold (a cart line can span several FEFO batches).
CREATE TABLE sale_items (
  id                  SERIAL PRIMARY KEY,
  sale_id             INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id          INTEGER NOT NULL REFERENCES products(id),
  batch_id            INTEGER NOT NULL REFERENCES product_batches(id),
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  unit_price          NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_rate            NUMERIC(5,2) NOT NULL DEFAULT 0,
  net_amount          NUMERIC(14,2) NOT NULL,
  tax_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total          NUMERIC(14,2) NOT NULL,
  unit_cost           NUMERIC(14,2) NOT NULL,
  quantity_returned   INTEGER NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0),
  prescription_item_id INTEGER REFERENCES prescription_items(id),
  CHECK (quantity_returned <= quantity)
);
CREATE INDEX sale_items_sale_idx ON sale_items (sale_id);
CREATE INDEX sale_items_product_idx ON sale_items (product_id);
CREATE INDEX sale_items_batch_idx ON sale_items (batch_id);

CREATE TABLE payments (
  id              SERIAL PRIMARY KEY,
  payment_no      VARCHAR(30) NOT NULL UNIQUE,
  sale_id         INTEGER NOT NULL REFERENCES sales(id),
  customer_id     INTEGER REFERENCES customers(id),
  method          VARCHAR(20) NOT NULL CHECK (method IN ('cash','card','mobile_money','bank_transfer','store_credit')),
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reference       VARCHAR(80),
  notes           VARCHAR(300),
  received_by     INTEGER NOT NULL REFERENCES users(id),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_sale_idx ON payments (sale_id);
CREATE INDEX payments_received_idx ON payments (received_at DESC);

CREATE TABLE sale_returns (
  id                SERIAL PRIMARY KEY,
  return_no         VARCHAR(30) NOT NULL UNIQUE,
  sale_id           INTEGER NOT NULL REFERENCES sales(id),
  branch_id         INTEGER NOT NULL REFERENCES branches(id),
  customer_id       INTEGER REFERENCES customers(id),
  reason            VARCHAR(30) NOT NULL,
  refund_method     VARCHAR(20) NOT NULL CHECK (refund_method IN ('cash','card','mobile_money','bank_transfer','store_credit')),
  total_amount      NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  net_amount        NUMERIC(14,2) NOT NULL,
  tax_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_reduction NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance_reduction >= 0),
  refund_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  cost_restocked    NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes             VARCHAR(500),
  processed_by      INTEGER NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (balance_reduction + refund_amount = total_amount)
);
CREATE INDEX sale_returns_sale_idx ON sale_returns (sale_id);
CREATE INDEX sale_returns_created_idx ON sale_returns (created_at DESC);

CREATE TABLE sale_return_items (
  id              SERIAL PRIMARY KEY,
  return_id       INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id    INTEGER NOT NULL REFERENCES sale_items(id),
  product_id      INTEGER NOT NULL REFERENCES products(id),
  batch_id        INTEGER NOT NULL REFERENCES product_batches(id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  net_amount      NUMERIC(14,2) NOT NULL,
  tax_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(14,2) NOT NULL,
  unit_cost       NUMERIC(14,2) NOT NULL,
  condition       VARCHAR(20) NOT NULL CHECK (condition IN ('resellable','damaged','opened')),
  restocked       BOOLEAN NOT NULL
);
CREATE INDEX sale_return_items_return_idx ON sale_return_items (return_id);

CREATE TABLE prescription_dispensings (
  id                    SERIAL PRIMARY KEY,
  prescription_id       INTEGER NOT NULL REFERENCES prescriptions(id),
  prescription_item_id  INTEGER NOT NULL REFERENCES prescription_items(id),
  sale_id               INTEGER NOT NULL REFERENCES sales(id),
  quantity              INTEGER NOT NULL CHECK (quantity > 0),
  dispensed_by          INTEGER NOT NULL REFERENCES users(id),
  dispensed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX prescription_dispensings_rx_idx ON prescription_dispensings (prescription_id, dispensed_at DESC);

-- ---------------------------------------------------------------------------
-- Purchasing
-- ---------------------------------------------------------------------------
CREATE TABLE purchase_orders (
  id              SERIAL PRIMARY KEY,
  po_number       VARCHAR(30) NOT NULL UNIQUE,
  branch_id       INTEGER NOT NULL REFERENCES branches(id),
  supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
  status          VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','ordered','partially_received','received','cancelled')),
  order_date      DATE NOT NULL,
  expected_date   DATE,
  subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_total  NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_total       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total           NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes           VARCHAR(1000),
  created_by      INTEGER NOT NULL REFERENCES users(id),
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  submitted_at    TIMESTAMPTZ,
  cancelled_reason VARCHAR(300),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX purchase_orders_supplier_idx ON purchase_orders (supplier_id, order_date DESC);
CREATE INDEX purchase_orders_status_idx ON purchase_orders (status, order_date DESC);
CREATE INDEX purchase_orders_number_trgm ON purchase_orders USING gin (po_number gin_trgm_ops);

CREATE TABLE purchase_order_items (
  id                  SERIAL PRIMARY KEY,
  purchase_order_id   INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id          INTEGER NOT NULL REFERENCES products(id),
  quantity_ordered    INTEGER NOT NULL CHECK (quantity_ordered > 0),
  quantity_received   INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  unit_cost           NUMERIC(14,2) NOT NULL CHECK (unit_cost >= 0),
  discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_rate            NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total          NUMERIC(14,2) NOT NULL,
  UNIQUE (purchase_order_id, product_id)
);

CREATE TABLE goods_receipts (
  id                  SERIAL PRIMARY KEY,
  grn_number          VARCHAR(30) NOT NULL UNIQUE,
  branch_id           INTEGER NOT NULL REFERENCES branches(id),
  purchase_order_id   INTEGER REFERENCES purchase_orders(id),
  supplier_id         INTEGER NOT NULL REFERENCES suppliers(id),
  supplier_invoice_no VARCHAR(60),
  received_date       DATE NOT NULL,
  due_date            DATE NOT NULL,
  total_cost          NUMERIC(14,2) NOT NULL CHECK (total_cost >= 0),
  notes               VARCHAR(1000),
  received_by         INTEGER NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX goods_receipts_supplier_idx ON goods_receipts (supplier_id, received_date DESC);
CREATE INDEX goods_receipts_po_idx ON goods_receipts (purchase_order_id);

CREATE TABLE goods_receipt_items (
  id                      SERIAL PRIMARY KEY,
  goods_receipt_id        INTEGER NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id  INTEGER REFERENCES purchase_order_items(id),
  product_id              INTEGER NOT NULL REFERENCES products(id),
  batch_id                INTEGER NOT NULL REFERENCES product_batches(id),
  quantity                INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost               NUMERIC(14,2) NOT NULL CHECK (unit_cost >= 0),
  selling_price           NUMERIC(14,2),
  line_total              NUMERIC(14,2) NOT NULL
);
CREATE INDEX goods_receipt_items_receipt_idx ON goods_receipt_items (goods_receipt_id);

CREATE TABLE supplier_payments (
  id                SERIAL PRIMARY KEY,
  payment_no        VARCHAR(30) NOT NULL UNIQUE,
  supplier_id       INTEGER NOT NULL REFERENCES suppliers(id),
  goods_receipt_id  INTEGER REFERENCES goods_receipts(id),
  amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method            VARCHAR(20) NOT NULL CHECK (method IN ('bank_transfer','mobile_money','cash','cheque')),
  reference         VARCHAR(80),
  paid_date         DATE NOT NULL,
  notes             VARCHAR(500),
  recorded_by       INTEGER NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX supplier_payments_supplier_idx ON supplier_payments (supplier_id, paid_date DESC);

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
CREATE TABLE expense_categories (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(60) NOT NULL,
  is_system   BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX expense_categories_name_unique ON expense_categories (lower(name));

CREATE TABLE expenses (
  id              SERIAL PRIMARY KEY,
  expense_no      VARCHAR(30) NOT NULL UNIQUE,
  branch_id       INTEGER NOT NULL REFERENCES branches(id),
  category_id     INTEGER NOT NULL REFERENCES expense_categories(id),
  description     VARCHAR(300) NOT NULL,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method  VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash','mobile_money','bank_transfer','card','cheque')),
  expense_date    DATE NOT NULL,
  paid_to         VARCHAR(150),
  employee_id     INTEGER REFERENCES users(id),
  reference       VARCHAR(80),
  notes           VARCHAR(1000),
  receipt_path    VARCHAR(300),
  created_by      INTEGER NOT NULL REFERENCES users(id),
  voided_at       TIMESTAMPTZ,
  voided_by       INTEGER REFERENCES users(id),
  void_reason     VARCHAR(300),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expenses_date_idx ON expenses (branch_id, expense_date DESC) WHERE voided_at IS NULL;
CREATE INDEX expenses_category_idx ON expenses (category_id);

-- ---------------------------------------------------------------------------
-- Notifications and audit
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id                  BIGSERIAL PRIMARY KEY,
  type                VARCHAR(30) NOT NULL,
  severity            VARCHAR(20) NOT NULL CHECK (severity IN ('info','success','warning','critical')),
  title               VARCHAR(160) NOT NULL,
  message             VARCHAR(500) NOT NULL,
  link                VARCHAR(200),
  -- Who should see it: users holding this permission (NULL = everyone), or one user.
  audience_permission VARCHAR(60),
  user_id             INTEGER REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key          VARCHAR(120) UNIQUE,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_open_idx ON notifications (created_at DESC) WHERE resolved_at IS NULL;

CREATE TABLE notification_reads (
  notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE TABLE audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name     VARCHAR(120),
  action        VARCHAR(40) NOT NULL,
  module        VARCHAR(40) NOT NULL,
  entity_type   VARCHAR(40),
  entity_id     VARCHAR(40),
  summary       VARCHAR(500) NOT NULL,
  old_values    JSONB,
  new_values    JSONB,
  ip            VARCHAR(64),
  user_agent    VARCHAR(300),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_user_idx ON audit_logs (user_id, created_at DESC);
CREATE INDEX audit_logs_module_idx ON audit_logs (module, created_at DESC);

-- Ledgers are append-only: history cannot be rewritten through the application.
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

CREATE TRIGGER inventory_movements_append_only BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
