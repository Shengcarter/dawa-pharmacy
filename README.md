# Dawa — Pharmacy Management System

A complete pharmacy management system for a modern retail pharmacy: point of sale, batch-level inventory with
First-Expired-First-Out dispensing, expiry control, purchasing and receiving, suppliers, customers and patients,
prescriptions and dispensing history, returns, expenses, profit & loss from real batch costs, reports, alerts,
role-based access control and a full audit trail.

Built with TypeScript end to end: **React 19 + Vite + Tailwind CSS 4** on the front, **Node.js + Express 5** API,
**PostgreSQL 16** database. Currency is configurable (default **TZS**) and dates follow the pharmacy's time zone
(default `Africa/Dar_es_Salaam`).

---

## Contents

1. [Features](#features)
2. [Quick start (development)](#quick-start-development)
3. [Demo accounts and data](#demo-accounts-and-data)
4. [Production deployment](#production-deployment)
5. [Configuration](#configuration)
6. [Architecture](#architecture)
7. [Business rules](#business-rules)
8. [Roles and permissions](#roles-and-permissions)
9. [Security](#security)
10. [API overview](#api-overview)
11. [Testing](#testing)
12. [Backup and restore](#backup-and-restore)
13. [Known limitations](#known-limitations)

---

## Features

| Area | What it does |
| --- | --- |
| **Dashboard** | Today's sales and transactions (compared with the same time yesterday), gross profit, stock value, low stock, expiry risk, supplier and customer balances, sales chart (today / 7 days / 30 days / 3 months / 12 months), top sellers, restock and expiry lists, recent transactions. Each figure is shown only to roles allowed to see it. |
| **Point of sale** | Keyboard-wedge barcode scanning anywhere on the screen, search by name / generic / SKU / barcode, sell by unit or by whole pack at the pack price, automatic FEFO batch allocation or manual batch choice, line and cart discounts within the role's limit, customer lookup and quick registration, prescription loading, cash (with change), mobile money, card, bank transfer, store credit, sale on account and split payments, idempotent submission, receipts for 80 mm / 58 mm thermal and A4, shareable digital receipt link and WhatsApp share. |
| **Invoices & returns** | Invoice list and detail with batch-level lines, payments and returns; record payments on credit invoices; returns with condition (resellable / damaged / opened), refund by cash / mobile money / card / bank or store credit. |
| **Products** | Full product record (SKU, barcode, generic and brand name, type, category, manufacturer, supplier, dosage form, strength, unit, pack size, purchase / selling / pack / wholesale / minimum prices, VAT, reorder and maximum levels, prescription requirement, batch tracking, status, image, storage instructions), opening stock, internal EAN-13 barcode generation, shelf-label printing, CSV export, bulk status changes. |
| **Inventory** | Stock by batch with status (in stock / low / critical / out of stock / expired), expiry tracking in buckets (expired, 30, 60, 90 days, safe) with value at risk, batch management (correct expiry, quarantine), stock adjustments (found, lost, damaged, expired disposal, count correction), transfers between branches, and an append-only stock movement ledger. |
| **Purchasing** | Purchase orders (draft → pending approval → ordered → partially received → received, or cancelled) with reorder suggestions, receiving against an order or as a direct delivery — every line creates or tops up a batch with its expiry and cost — and supplier payments with balances and overdue tracking. |
| **Prescriptions** | Record prescriptions as written (prescriber, facility, registration number, medicines, dosage instructions, quantities, durations, refills), dispense them at the till, partial dispensing and refills, full dispensing history. The software never suggests or substitutes medicines. |
| **Customers / patients** | Contact details, customer type, optional date of birth / gender / insurance, credit limit, store credit, purchase history and balances. Minimal data by design. |
| **Expenses** | Categorised expenses with payment method, payee, employee, reference and receipt attachment (image / PDF). Expenses are voided, never deleted. |
| **Reports** | Sales, product performance, purchases, inventory valuation, profit & loss, expenses, expiry, VAT and staff performance — filterable by date, category, supplier and staff, exportable to CSV, printable / save as PDF. |
| **Alerts** | Low stock, out of stock, expiring and expired stock, purchase orders waiting for approval or overdue for delivery, overdue supplier payments, failed sales. Alerts resolve themselves when the condition clears. |
| **Branches** | Several branches in one system: each keeps its own stock, sales, purchases and expenses; staff work in their assigned branch; stock transfers keep batch number, expiry and cost; stock and expiry alerts are shown only to the branch concerned. Suppliers, customers, products and prices are shared. |
| **Administration** | Users with multiple roles, custom roles with a permission matrix, account lock-out and unlock, admin password reset, sign-in history, settings (pharmacy details and logo, currency, time zone, stock rules, tax and receipt options, alert options, session and retention, automatic backups), audit log with before/after values. |
| **Everywhere** | Global search (`Ctrl K`), responsive layouts for desktop, tablet and phone, light and dark themes, loading / empty / error states on every page. |

## Quick start (development)

Requirements: **Node.js 20+** (22 recommended) and **PostgreSQL 14+** (16 recommended).

```bash
# 1. Database
createuser -P dawa            # choose a password
createdb -O dawa dawa
createdb -O dawa dawa_test    # only needed to run the tests

# 2. Install
npm install

# 3. Configure the API
cp server/.env.example server/.env
#    set DATABASE_URL and JWT_ACCESS_SECRET in server/.env

# 4. Load the demo pharmacy (wipes the database first)
npm run seed -w server -- --reset

# 5. Run API (http://localhost:4000) and web app (http://localhost:5173)
npm run dev
```

The web dev server proxies `/api` and `/uploads` to the API.

For a fresh installation without demo data, run `npm run db:migrate` and then
`npm run create-admin -w server` to create the first Super Admin.

## Demo accounts and data

`npm run seed -w server -- --reset` creates **Upendo Pharmacy** (Sinza, Dar es Salaam) with about four months of
history generated through the real services: two purchasing cycles with batches and expiries, ~2,400 FEFO sales,
~170 prescriptions, returns, credit sales and payments, stock adjustments, monthly expenses, supplier payments
(some overdue) and open purchase orders. The data deliberately includes expired stock, near-expiry batches, low and
out-of-stock items so every alert and report has something to show.

All demo users share the password **`Upendo@2026`**:

| Role | Email |
| --- | --- |
| Super Admin | admin@upendopharmacy.co.tz |
| Owner / Manager | grace@upendopharmacy.co.tz |
| Pharmacist | halima@upendopharmacy.co.tz, baraka@upendopharmacy.co.tz |
| Cashier | rehema@upendopharmacy.co.tz |
| Inventory Officer | emmanuel@upendopharmacy.co.tz |
| Accountant | fatuma@upendopharmacy.co.tz |

> The seed refuses to run on a database that already has users unless `--reset` is given, and `--reset` is refused
> when `NODE_ENV=production`. Never use the demo password on a real installation.

## Production deployment

### Docker (recommended)

```bash
cp .env.example .env        # set DATABASE_PASSWORD, JWT_ACCESS_SECRET, APP_URL
docker compose up -d --build
docker compose exec -it app node dist/create-admin.js   # first Super Admin
```

Open `http://<server-ip>:4000` from any computer on the pharmacy network. The API serves the built web app,
applies migrations on start, and stores uploads and backups in the `storage` volume.

### Without Docker

```bash
npm ci
npm run build                       # server/dist and web/dist
cd server
NODE_ENV=production SERVE_WEB=true node --env-file=.env dist/server.js
```

Run it under a process manager (systemd, PM2) and put it behind HTTPS (Nginx / Caddy) when it is reachable
beyond the local network. Behind HTTPS set `COOKIE_SECURE=true` and `TRUST_PROXY=1`.

## Configuration

API settings are environment variables (validated at start-up; the process refuses to run with bad values):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Secret for access tokens, at least 32 random characters |
| `ACCESS_TOKEN_TTL_MINUTES` | Access token lifetime (default 15) |
| `APP_URL` | Public URL, used in password-reset emails |
| `COOKIE_SECURE` | `true` behind HTTPS; defaults to `true` in production |
| `TRUST_PROXY` | Number of reverse proxies in front of the API |
| `CORS_ORIGIN` | Comma-separated origins, only if the web app is served from another origin |
| `SERVE_WEB`, `WEB_DIST_DIR` | Serve the built web app from the API process |
| `STORAGE_DIR` | Uploads (`public/`, `private/`) and `backups/` |
| `SMTP_*` | Optional email for password-reset links; without it staff ask a manager to reset |
| `PG_DUMP_PATH` | `pg_dump` binary used for backups |
| `ALERTS_INTERVAL_MINUTES` | Alert recalculation interval (0 disables the in-process scheduler) |

Business settings (pharmacy details, currency, time zone, stock and tax rules, receipts, alerts, retention and
backups) are edited in **Settings** and stored in the database. Currency formatting is centralised in
`shared/src/currency.ts`; adding a currency is one entry in `CURRENCIES`.

## Architecture

```
dawa-pharmacy/
├─ shared/            Shared by API and web: permissions and roles, enums, Zod validation schemas,
│                     currency + money maths, sale-line pricing, dates, EAN-13, settings schema
├─ server/
│  ├─ src/config       environment validation
│  ├─ src/db           pool + transactions, SQL migrations, bootstrap, demo seed
│  ├─ src/lib          errors, audit, stock primitives (FEFO, movements), sequences, CSV, uploads, tokens
│  ├─ src/middleware   authentication, permission guards, rate limits, error handler, camelCase responses
│  ├─ src/modules/*    routes.ts (HTTP) → service.ts (business rules + SQL), one folder per domain
│  ├─ src/jobs         scheduler: alerts, automatic backups, audit retention
│  └─ tests            integration tests against a real PostgreSQL database
└─ web/
   ├─ src/components   design system (ui/), layout shell, charts, pickers, receipts, barcodes
   ├─ src/features/*   pages per domain
   └─ src/lib          API client (silent token refresh), auth, settings/formatters, forms, hooks
```

Principles:

* **The server is the source of truth.** Prices, discounts, tax, totals, costs and stock are always recomputed by the
  API; the client only previews them.
* **Every multi-step operation is one transaction** (sale, receipt, return, adjustment, payment) with row locks
  taken in a consistent order.
* **Stock lives in batches.** `product_batches` is the stock-on-hand ledger (there is deliberately no separate
  `inventory` table that could drift). Products without batch tracking keep their stock in one internal batch, so
  every code path is the same. Every change writes an `inventory_movements` row; that table is append-only,
  enforced by a database trigger.
* **Money** is `NUMERIC(14,2)` in the database and integer minor units in code. **Dates** are evaluated in the
  pharmacy's time zone.
* **Validation is shared**: the same Zod schemas validate forms in the browser and requests on the server, which
  never trusts the client.

## Business rules

* **FEFO** — sales draw from the sellable batch with the earliest expiry; a manually chosen batch is checked by the
  same rules.
* **Expired, quarantined and disposed stock is never sold.** Expired stock stays visible (and alerted) until it is
  disposed of with an *Expired — dispose* adjustment, which records the write-off.
* **No negative stock** — enforced in the services and by a `CHECK` constraint.
* **Receiving creates batches** — each line needs a batch number and (for tracked products) an expiry date in the
  future; receiving more of an existing batch number must match its expiry. Over-receiving a purchase order line is
  refused.
* **Prescription-only medicines** need a recorded, unexpired prescription that covers the quantity, and a user with
  the dispense permission (can be relaxed in Settings).
* **Discounts** above the role's limit, prices changes at the till and sales below a product's minimum price need the
  override permission.
* **Credit sales** need a customer with a credit limit that covers the new balance.
* **Returns** restock only resellable, unexpired units into their original batch; refunds first clear any unpaid
  balance on the invoice; the rest is refunded or held as store credit.
* **Profit** — Net revenue (sales excluding VAT, after discounts, less returns) − cost of goods sold at the cost of
  the batches actually sold (less restocked returns) = gross profit; − stock losses (damaged, expired, missing, net of
  stock found) − operating expenses = net profit. VAT is reported separately and is not revenue.

## Roles and permissions

Six built-in roles are created automatically; administrators can edit their permissions (except Super Admin) or
create custom roles. Permissions are enforced by the API on every route; the interface hides what a role cannot do.

| Role | Summary |
| --- | --- |
| Super Admin | Everything, including role management |
| Owner / Manager | Everything except editing roles |
| Pharmacist | Sales, discounts within limit, returns, prescriptions and dispensing, view and adjust stock, receive deliveries |
| Cashier | Point of sale, own sales, customers |
| Inventory Officer | Products, stock control, purchase orders, receiving, suppliers, inventory and purchase reports |
| Accountant | All sales, payments, suppliers and supplier payments, expenses, all reports including profit |

## Security

* Passwords hashed with **bcrypt** (cost 12); strength rules shared by client and server; never logged.
* **Short-lived JWT access tokens** kept in memory only, plus **rotating refresh tokens** in an `HttpOnly`,
  `SameSite=Strict` cookie, stored as SHA-256 hashes. Re-use of a rotated token revokes the whole session family.
  Each request re-checks that the session and user are still active, so logout, suspension and password changes take
  effect immediately.
* Account **lock-out** after 5 failed sign-ins (15 minutes), sign-in rate limiting, password-reset tokens that are
  single-use and expire after 30 minutes, generic responses that do not reveal whether an email exists.
* **CSRF**: cookie-authenticated endpoints require a custom header that browsers cannot send cross-site, on top of
  `SameSite=Strict`.
* **SQL injection**: parameterised queries everywhere; sort columns are whitelisted.
* **XSS**: React escaping, strict Content-Security-Policy (`script-src 'self'`), Helmet security headers.
* **CSV exports** neutralise spreadsheet formula injection.
* **Uploads**: type and size checks, random file names, receipts served only to authorised users.
* **Audit**: price changes, stock adjustments, sales, returns, receipts, payments, purchase-order decisions, user,
  role and settings changes are logged with old and new values, user, IP and device. The audit and stock ledgers
  cannot be edited from the application.
* Secrets come from environment variables only; nothing sensitive is shipped to the browser.

## API overview

All endpoints are under `/api`, return JSON in camelCase, and (apart from sign-in, password reset, public settings
and digital receipts) require `Authorization: Bearer <access token>`. Errors use
`{ "error": { "code", "message", "fields?" } }`; validation errors list the offending fields.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`; `GET /auth/me`, `/auth/activity`; `PUT /auth/profile`, `/auth/preferences` |
| Products | `GET/POST /products`, `GET/PUT /products/:id`, `GET /products/pos-search`, `POST /products/bulk-status`, `POST /products/:id/barcode`, `POST/DELETE /products/:id/image`, `/categories`, `/manufacturers` |
| Inventory | `GET /inventory/batches`, `/inventory/expiry-summary`, `GET/PUT /inventory/batches/:id`, `GET/POST /inventory/adjustments`, `GET /inventory/movements` |
| Purchasing | `GET/POST /purchasing/orders`, `GET/PUT /purchasing/orders/:id`, `POST /purchasing/orders/:id/transition`, `GET /purchasing/reorder-suggestions`, `GET/POST /purchasing/receipts`, `GET /purchasing/receipts/:id` |
| Suppliers | `GET/POST /suppliers`, `GET/PUT /suppliers/:id`, `GET /suppliers/options`, `POST /suppliers/payments` |
| Sales | `GET/POST /sales`, `GET /sales/:id`, `GET /sales/:id/receipt`, `POST /sales/:id/payments`, `GET /sales/by-invoice/:no`, `GET/POST /sales/returns`, `GET /sales/returns/:id`, `GET /public/receipts/:token` |
| Customers | `GET/POST /customers`, `GET/PUT /customers/:id`, `GET /customers/lookup` |
| Prescriptions | `GET/POST /prescriptions`, `GET/PUT /prescriptions/:id`, `POST /prescriptions/:id/cancel` |
| Expenses | `GET/POST /expenses`, `PUT /expenses/:id`, `POST /expenses/:id/void`, `GET/POST /expenses/:id/receipt`, `GET/POST /expenses/categories` |
| Reports | `GET /reports/{sales, product-sales, purchases, inventory, profit-loss, expenses, expiry, tax, staff}` — add `format=csv` to download |
| Branches & transfers | `GET/POST /branches`, `PUT /branches/:id`, `GET/POST /inventory/transfers` |
| Admin | `/users`, `/roles`, `/settings`, `/audit-logs`, `/backups`, `/notifications`, `/search`, `/dashboard` |

List endpoints accept `page`, `pageSize` (≤ 200), `search`, filters and whitelisted `sort` / `order`, and return
`{ data, page, pageSize, total }`.

## Testing

```bash
npm test          # API integration tests (needs the dawa_test database; see TEST_DATABASE_URL)
npm run typecheck # shared, server and web
npm run build
```

The test suite (Vitest + Supertest, real PostgreSQL) covers sign-in, lock-out, refresh-token rotation and re-use
detection, CSRF guard, logout and suspension taking effect immediately, password change and reset, role
enforcement, FEFO allocation across batches, refusal to sell expired or insufficient stock, sale movements and
batch-cost COGS, VAT, discount limits and minimum prices, prescription enforcement and refills, credit limits and
payments, idempotent sales, digital receipt privacy, purchase-order approval and partial/over receipt, expired
deliveries, adjustments and count corrections, the append-only stock ledger, duplicate SKU/barcode and EAN-13 check
digits, transfers between branches (batch identity, limits, branch isolation), returns with restocking rules and store credit, the profit & loss identity, expense voiding, CSV formula
neutralisation, dashboard visibility by role and human-readable price-change audit entries. GitHub Actions runs
type checks, tests and the build on every push.

## Backup and restore

*Settings → System & backups → Back up now* (or the automatic daily backup) writes a compressed PostgreSQL dump to
`STORAGE_DIR/backups`, keeping the configured number of copies. Copy backups off the server regularly. To restore:

```bash
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" dawa-YYYYMMDD-HHMMSS.dump
```

## Known limitations

* Staff work in one assigned branch at a time; a manager moves a person between branches from *Employees & users*.
  Reports and the dashboard show the signed-in user's branch (supplier balances are company-wide).
* A product sells in its base unit or as a whole pack at one optional pack price; there are no tiered,
  quantity-break or per-customer price lists.
* Password-reset emails need SMTP settings; without them a manager resets passwords from *Employees & users*.
* Electronic fiscal device (TRA EFD/VFD) integration is not included; receipts are not fiscal receipts.
