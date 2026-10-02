-- Two-factor authentication (TOTP). Secrets are encrypted by the application (AES-256-GCM).
ALTER TABLE users
  ADD COLUMN mfa_secret_enc        TEXT,
  ADD COLUMN mfa_pending_secret_enc TEXT,
  ADD COLUMN mfa_enabled_at        TIMESTAMPTZ,
  ADD COLUMN mfa_last_step         BIGINT,
  -- SHA-256 hashes of single-use recovery codes.
  ADD COLUMN mfa_recovery_hashes   TEXT[] NOT NULL DEFAULT '{}',
  -- Optional last day of access, e.g. for temporary or locum staff.
  ADD COLUMN access_expires_on     DATE;

-- Second step of a sign-in for users with 2FA: short-lived, single-use, attempt-limited.
CREATE TABLE mfa_challenges (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mfa_challenges_user_idx ON mfa_challenges (user_id, created_at DESC);

ALTER TABLE login_activity DROP CONSTRAINT IF EXISTS login_activity_event_check;
ALTER TABLE login_activity ADD CONSTRAINT login_activity_event_check CHECK (event IN (
  'login', 'login_failed', 'logout', 'locked', 'password_reset', 'password_changed', 'token_reuse',
  'mfa_failed', 'mfa_enabled', 'mfa_disabled', 'mfa_recovery_used', 'session_expired', 'access_expired'));

-- The audit log is append-only: rows can never be edited, and only rows past the
-- minimum retention (one year) can be deleted, by the retention job.
CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.created_at > now() - interval '365 days' THEN
    RAISE EXCEPTION 'audit log entries younger than one year cannot be deleted';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER audit_logs_guard BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_guard();
