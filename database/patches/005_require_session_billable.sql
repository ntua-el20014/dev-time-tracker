-- 005: Require billable status on all sessions

UPDATE time_tracking_sessions
SET is_billable = false
WHERE is_billable IS NULL;

ALTER TABLE time_tracking_sessions
ALTER COLUMN is_billable SET DEFAULT false,
ALTER COLUMN is_billable SET NOT NULL;
