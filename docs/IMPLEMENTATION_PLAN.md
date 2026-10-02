# Dawa Pharmacy — Implementation Plan

## 0. Findings from inspecting the repository

The repository already contains a complete, working salon ERP ("ZOLA STYLISH",
JavaScript + Express + MySQL + React JSX) at the repository root
(`backend/`, `frontend/`, `database/`). It is a different product.

**Decision:** the pharmacy system is built as a self-contained application in
`pharmacy/`, using the requested stack (TypeScript end-to-end, PostgreSQL). The
salon system is not modified. Nothing is shared at runtime, so either product
can be deployed, versioned or extracted into its own repository independently.

## 1. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) everywhere | One type system from database row to form field |
| Monorepo | npm workspaces: `shared`, `server`, `web` | Validation schemas, permissions, enums and money rules are written once |
| API | Node 22, Express 5 | Mature, small, well understood |
| Database | PostgreSQL 16, raw parameterised SQL via `pg` | Transactions, row locks for FEFO, `CHECK` constraints, `pg_trgm` search; no ORM magic in money/stock paths |
| Validation | Zod (shared by API and forms) | Same rules on both sides; the API never trusts the client |
| Auth | Short-lived JWT access token (memory) + rotating opaque refresh token in an `HttpOnly; SameSite=Strict` cookie, stored hashed | Revocable sessions, no token in `localStorage` |
| Web | React 19, Vite, Tailwind CSS 4, TanStack Query, React Router, React Hook Form, Recharts, Lucide | |
| Tests | Vitest + Supertest against a real PostgreSQL test database | Business rules are tested where they live |

## 2. Architecture

```
pharmacy/
  shared/   permissions, enums, currency + money maths, zod schemas, settings schema
  server/
    src/config        environment (validated at boot)
    src/db            pool, transaction helper, migrations, seed
    src/lib           errors, money, pagination, csv, barcodes, sequences, dates
    src/middleware    auth, permission guard, validation, rate limits, errors
    src/modules/<m>   routes.ts (HTTP) → service.ts (business rules + SQL)
    src/jobs          alert generation (low stock, expiry, overdue suppliers…)
  web/
    src/components/ui       design-system primitives
    src/components/layout   app shell, sidebar, top bar, search, notifications
    src/features/<m>        pages + query hooks per module
    src/lib                 API client, auth store, formatting
```

Rules: HTTP handlers only parse/authorise/respond; all business rules live in
services; every multi-step operation (sale, receipt, return, adjustment) runs in
one database transaction with row locks; the server computes every price, tax,
total and cost.

## 3. Database (PostgreSQL)

Identity & security: `branches, users, roles, permissions, role_permissions,
user_roles, auth_sessions, password_resets, login_activity`

Catalogue: `categories, manufacturers, products, suppliers, supplier_products`

Stock: `product_batches` (the stock-on-hand ledger, one row per batch per
branch), `inventory_movements` (append-only, enforced by trigger),
`stock_adjustments`

> A separate `inventory` table is intentionally **not** created: it would
> duplicate `product_batches.quantity_on_hand`. Product totals come from the
> `v_product_stock` view. Products without batch tracking hold stock in a single
> internal batch, so every stock path (FEFO, movements, valuation) is the same.

Sales: `customers, sales, sale_items` (one row per batch actually sold),
`payments, sale_returns, sale_return_items`

Purchasing: `purchase_orders, purchase_order_items, goods_receipts,
goods_receipt_items, supplier_payments`

Clinical: `prescriptions, prescription_items, prescription_dispensings`

Finance & admin: `expense_categories, expenses, notifications,
notification_reads, audit_logs` (append-only), `settings, document_sequences`

Money is `NUMERIC(14,2)`, calculated in integer minor units in code.
Quantities are integers in the product's base unit. Timestamps are
`timestamptz`; "today" is evaluated in the pharmacy's time zone
(default `Africa/Dar_es_Salaam`).

## 4. Key business rules

* **FEFO**: sale lines are allocated across batches ordered by earliest valid
  expiry (`FOR UPDATE` locks, consistent lock order to avoid deadlocks).
* **Expired / quarantined stock is never sellable.** Manual batch choice is
  validated against the same rule.
* **No negative stock**: enforced in services *and* by `CHECK (quantity_on_hand >= 0)`.
* **Receiving** always creates or tops up a batch (batch no., expiry) and a
  `purchase` movement; it never bumps a bare stock number.
* **Returns** restock only resellable, unexpired units; refunds first clear any
  unpaid balance on a credit sale.
* **Profit** uses batch cost captured at sale time: Net revenue − COGS = Gross
  profit; − inventory losses − operating expenses = Net profit.
* **Prescription-only** items require a linked prescription and the dispense
  permission (configurable).
* **Discounts** above the role limit or below minimum selling price require the
  override permission.
* **Audit**: price changes, stock adjustments, sales, returns, receipts,
  payments, user/role/settings changes are written with old/new values.

## 5. Roles

Super Admin · Owner/Manager · Pharmacist · Cashier · Inventory Officer ·
Accountant — mapped to ~45 fine-grained permissions, enforced by middleware on
every API route; the UI only hides what the API would refuse anyway.

## 6. Delivery stages

1. Workspace, shared package, migrations, auth & RBAC
2. Catalogue (products, categories, manufacturers, barcodes)
3. Inventory (batches, FEFO, expiry, adjustments, movements)
4. Purchasing (suppliers, POs, receiving, supplier payments)
5. POS, receipts, payments, returns
6. Customers, prescriptions & dispensing
7. Expenses, financial calculations, reports, CSV export
8. Dashboard, notifications, global search, audit log, settings, backups
9. Seed data generated through the real services (so every figure is consistent)
10. UI review, automated tests, end-to-end walkthrough, documentation
