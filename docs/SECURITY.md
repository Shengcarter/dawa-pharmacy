# Security

This document describes how Dawa protects patient, financial and stock data, how to run it securely,
and what to do when something goes wrong. Read it before going live.

## Controls in the application

| Area | What is in place |
| --- | --- |
| Passwords | bcrypt (cost 12) via `bcryptjs`; never stored or logged in plain text. At least 10 characters with upper case, lower case and a number; at most 72 bytes (bcrypt's limit, so nothing is silently ignored). Unknown emails take as long as wrong passwords (no account discovery by timing). |
| Sign-in | 5 wrong passwords lock the account for 15 minutes; every sign-in, failure, lock-out, 2FA event and session end is recorded in *Sign-in activity*. |
| Two-factor authentication | TOTP (RFC 6238, `otplib`) with any authenticator app; secrets encrypted at rest with AES-256-GCM (`DATA_ENCRYPTION_KEY`); a used code cannot be replayed; 10 single-use recovery codes stored as SHA-256 hashes; the second step is a short-lived (5 min), single-use, 5-attempt challenge. *Settings → System → Require two-factor authentication for administrators* makes it mandatory for anyone who can manage users, roles, settings or backups: until they enrol, the API refuses everything except enrolment. Administrators can reset a lost device (audited, signs the user out). |
| Sessions | 15-minute access tokens kept in memory only (never in `localStorage`); refresh token in an `HttpOnly`, `SameSite=Strict`, `Secure` (behind HTTPS) cookie scoped to `/api/auth`, stored as a SHA-256 hash and rotated on every use. Re-use of a rotated token revokes the whole sign-in. Absolute session length (*Stay signed in for*) is counted from sign-in and never extended by activity; *Sign out after inactivity* ends idle sessions in the browser and on the server. Logout ends every tab of that sign-in immediately; suspension, password changes/resets and 2FA resets end sessions at once. Optional per-user *Access ends* date for temporary staff. A forced password change is enforced by the API, not only the screen. |
| Authorization | Every API route checks permissions on the server (`requirePermission`), loaded fresh from the database on every request, so role changes apply immediately. Records are scoped to the user's branch; cashiers see only their own sales; cost and clinical fields are removed for roles that may not see them. Staff can only manage accounts, and grant roles, whose access is within their own (a manager cannot reset a Super Admin's password). |
| Input | Every request body and query is parsed with Zod schemas shared with the web app; unknown fields are dropped. All SQL uses parameterised queries (`pg`); identifiers are never built from user input. CSV exports neutralise spreadsheet formulas. |
| CSRF / XSS | Cookie-authenticated endpoints need a custom `X-Dawa-Client` header (browsers cannot add it cross-site) on top of `SameSite=Strict`. React escapes all output; the Content-Security-Policy allows scripts from the app's own origin only and forbids framing. |
| Headers | `helmet`: Content-Security-Policy, `Strict-Transport-Security` (when served over HTTPS), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy`, `X-Frame-Options`; plus `Permissions-Policy` switching off camera, microphone, location, payment and USB. `X-Powered-By` is removed. |
| Rate limits | All API calls (600/min per IP); sign-in (20 per 15 min per IP); 2FA codes (15 per 15 min per IP, plus 5 per challenge); password-reset requests (5 per hour per IP); sensitive actions — password and 2FA changes, user, role, branch and settings changes, backups and data exports — 30 per 15 min per user. |
| Uploads | Only JPG, PNG, WebP (images) and PDF (expense receipts), with size limits. The file's first bytes must match its type (an HTML or SVG file renamed `.png` is refused); PDFs containing JavaScript, launch actions, embedded files or forms are refused. With `CLAMAV_HOST` set, every upload is scanned by ClamAV and refused if infected or if the scanner cannot be reached (fail closed). Stored under random names outside the web root; served with a sandboxing CSP; private receipts only to authorised users, PDFs as downloads. |
| Errors | One error handler: users get a short message and an error code; stack traces, SQL, connection strings and tokens go only to the server log. The log redacts `Authorization`, cookies, passwords and tokens. |
| Audit log | Every business-critical and security-relevant change (sales, returns, stock, prices, purchasing, payments, insurance claims, users and roles, settings, backups, 2FA, data exports) records who, when, from where, and old/new values. The table is append-only at the database level: no one — not even the schema owner — can edit an entry, and entries younger than one year cannot be deleted. |
| Stock integrity | Stock lives only in batches and changes only through the stock service, inside transactions with row locks; a database `CHECK` forbids negative stock; the movement ledger is append-only (trigger and, in production, revoked privileges). |
| Secrets | Only from environment variables, validated at start-up. In production the server refuses to start with example values, without `DATA_ENCRYPTION_KEY`, or with an example database password. Nothing secret is sent to the browser: the web app has no API keys or environment secrets. |

## Running securely (production)

### HTTPS

`docker-compose.yml` puts [Caddy](https://caddyserver.com) in front of the app; the app and the database are
not reachable from the network directly. Set `SITE_ADDRESS` in `.env`:

* **A domain** pointing at the server (e.g. `pharmacy.example.co.tz`): Caddy obtains and renews a Let's Encrypt
  certificate automatically. Ports 80 and 443 must be reachable from the internet for the first certificate.
* **An in-shop server on the LAN** (e.g. `192.168.1.10`): Caddy issues a certificate from its own local authority.
  Install its root certificate once on each till and office computer so browsers trust it:
  ```bash
  docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./dawa-root.crt
  ```
  then import `dawa-root.crt` as a trusted root (Windows: double-click → Install → *Trusted Root Certification
  Authorities*; macOS: Keychain Access → System → Always Trust). Never share the CA's private key.

HTTP is redirected to HTTPS; the app sets `Secure` cookies and HSTS behind it (`COOKIE_SECURE=true`,
`TRUST_PROXY=1` are set by the compose file).

### Database accounts (least privilege)

The compose file creates three PostgreSQL roles on first start (`docker/db-init/01-roles.sh`):

| Role | Used for | Rights |
| --- | --- | --- |
| `postgres` | Database initialisation only | Superuser; its password is not given to the app |
| `dawa_owner` | Migrations at start-up and backups (`MIGRATIONS_DATABASE_URL`) | Owns the schema |
| `dawa_app` | Everything the application does (`DATABASE_URL`) | Read/write data only: cannot create, alter or drop tables, cannot edit the stock ledger, cannot edit the audit log |

The database port is not published. On a non-Docker install, create the same two roles and set both URLs; with
only `DATABASE_URL` set, the app runs migrations with that one role (fine for development, not recommended for
production). The container runs the app as the unprivileged `node` user.

### Secrets

* Generate every password and key with `openssl rand -base64 32` (48 for `JWT_ACCESS_SECRET`) and keep them only
  in the server's `.env` (mode `600`) or your secrets manager. `.env` is git-ignored; never commit it, paste it
  into chat or email it.
* Keep a copy of `BACKUP_ENCRYPTION_KEY` **off the server** (e.g. printed and locked in the safe, or in the owner's
  password manager). Without it, encrypted backups cannot be restored.
* Rotating: `JWT_ACCESS_SECRET` — change and restart (everyone signs in again). Database passwords —
  `ALTER ROLE dawa_app PASSWORD '…'` then update `.env` and restart. `DATA_ENCRYPTION_KEY` — staff must set up 2FA
  again after a change (old secrets cannot be decrypted); reset it for each user from *Employees & users*.
  `BACKUP_ENCRYPTION_KEY` — new backups use the new key; keep the old key for as long as you keep old backups.

### If a secret leaks

Deleting a secret from the code or a file is **not enough**: it stays in Git history, logs, backups and other
people's copies. Treat it as compromised:

1. **Revoke or rotate it immediately** (see *Rotating* above; for SMTP or other providers, revoke the key in
   their dashboard and create a new one).
2. Update the server's `.env` and restart; check *Settings → System* and the audit log for anything done with it.
3. If it was committed to GitHub, also remove it from history (`git filter-repo`) and force-push, and consider
   every clone compromised — but rotation in step 1 is what actually protects you.
4. If patient or financial data may have been accessed, follow your data-protection obligations (e.g. the
   Tanzania Personal Data Protection Act) and inform the people responsible.

CI runs [gitleaks](https://github.com/gitleaks/gitleaks) over the whole history on every push and fails if a
secret is found. `.gitleaksignore` may only list reviewed false positives (never a real secret).

### Backups and restore

* *Settings → System*: turn on **Automatic daily backup**; *Back up now* makes one immediately. Backups are full
  `pg_dump` archives, encrypted with `BACKUP_ENCRYPTION_KEY` (AES-256-GCM; tampering or a wrong key is detected),
  readable only by the service account, and copied to `BACKUP_COPY_DIR` — a **different disk, NAS share or
  synced folder** (the compose file mounts `BACKUP_COPY_HOST_DIR`). A failed backup or copy raises a critical alert.
  The settings page warns while backups are unencrypted or kept only on the server.
* Additionally take a copy off the premises regularly (e.g. weekly to an encrypted USB drive kept elsewhere, or
  sync `BACKUP_COPY_HOST_DIR` to cloud storage with `rclone`). Encrypted backups are safe to store on third-party
  storage; the key must not be stored with them.
* **Restore** (test this every few months on a spare machine):
  ```bash
  # 1. Decrypt (needs only the key)
  BACKUP_ENCRYPTION_KEY='<key>' docker compose run --rm app node dist/backup-decrypt.js /data/backups/dawa-YYYYMMDD-HHMMSS.dump.enc /data/restore.dump
  # 2. Stop the app, restore into the database as the schema owner, start again
  docker compose stop app
  docker compose exec -T db pg_restore --clean --if-exists --no-owner -U dawa_owner -d dawa < restore.dump
  docker compose start app      # migrations and permission grants run again at start-up
  # 3. Delete the decrypted file
  ```
  Unencrypted backups (`.dump`) skip step 1. Without Docker: `node dist/backup-decrypt.js …` and
  `pg_restore --clean --if-exists --no-owner -d "$MIGRATIONS_DATABASE_URL" restore.dump`.

### Malware scanning

Start ClamAV with `docker compose --profile scan up -d` and set `CLAMAV_HOST=clamav` in `.env` (it needs about
1.5 GB of RAM and updates its signatures itself). Without it, uploads are still type-checked and sandboxed; the
server logs a warning at start-up.

### Dependencies

* CI runs `npm audit --audit-level=high` on every push and weekly, and fails on known high or critical
  vulnerabilities. Dependabot opens weekly pull requests for npm packages, GitHub Actions and Docker images, and
  immediate ones for security advisories.
* Process: review the advisory → merge the Dependabot PR (or `npm update <pkg>` / `npm audit fix`) → CI must pass
  (tests, typecheck, build) → deploy with `docker compose up -d --build`. Critical issues in a package the app
  uses at runtime: patch within days, not weeks. Never use `npm audit fix --force` without reviewing the changes.
* Rebuild the image monthly even without code changes, to pick up base-image security fixes.

## Production readiness checklist

Do not treat an installation as production-ready until every item has been checked on that installation:

- [ ] `.env` has unique generated secrets; the server starts in production mode without refusing.
- [ ] HTTPS works from every till (no browser warning); HTTP redirects to HTTPS.
- [ ] Super Admin and managers have 2FA on, and *Require two-factor authentication for administrators* is on.
- [ ] Demo data is not loaded; the first admin was created with `create-admin`; demo passwords are not in use.
- [ ] Each staff member has their own account with the least-privileged role that fits their job.
- [ ] Automatic daily backup is on; `BACKUP_ENCRYPTION_KEY` and `BACKUP_COPY_DIR` are set; the backup key is stored off the server; a **test restore** has been done.
- [ ] Database port is not reachable from the network; the app uses `dawa_app`, not the superuser.
- [ ] ClamAV is running if staff will upload files from email or the internet.
- [ ] CI (tests, dependency audit, secret scan) is green for the deployed commit.
- [ ] The automated test suite (`npm test`) passes: it covers authentication, 2FA, sessions, authorization, input validation, uploads, backups, headers, error handling, audit and stock rules.

## Reporting a vulnerability

Email the system owner privately with steps to reproduce; do not open a public issue.
