-- 0001 schema_migrations: record which migrations a database has had.
--
-- Run in the SQL editor on a database built from baseline.sql (or from
-- schema.sql before this migration existed). Every later migration starts
-- with SELECT apply_migration(N, '<name>'), which refuses to run one twice
-- or out of order.

BEGIN;

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No policies: only the SQL editor (the table owner) reads or writes it
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

-- Record a migration as applied, inside the migration's own transaction.
-- Refuses one that is already applied or skips a number, so a migration
-- pasted twice or out of order changes nothing. Not callable through the API.
CREATE OR REPLACE FUNCTION apply_migration(p_version INTEGER, p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_last INTEGER;
BEGIN
    SELECT COALESCE(MAX(version), 0) INTO v_last FROM schema_migrations;
    IF p_version <= v_last THEN
        RAISE EXCEPTION 'Migration % (%) is already applied: this database is at %', p_version, p_name, v_last;
    END IF;
    IF p_version <> v_last + 1 THEN
        RAISE EXCEPTION 'Migration % (%) needs migration % first: this database is at %', p_version, p_name, v_last + 1, v_last;
    END IF;
    INSERT INTO schema_migrations (version, name) VALUES (p_version, p_name);
END;
$$;

REVOKE EXECUTE ON FUNCTION apply_migration(INTEGER, TEXT) FROM PUBLIC, anon, authenticated;

SELECT apply_migration(1, 'schema_migrations');

COMMIT;
