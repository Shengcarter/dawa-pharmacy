-- Branch-specific alerts (stock, expiry, purchase orders) are shown only to staff of that branch.
ALTER TABLE notifications ADD COLUMN branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE;
CREATE INDEX notifications_branch_idx ON notifications (branch_id) WHERE resolved_at IS NULL;
