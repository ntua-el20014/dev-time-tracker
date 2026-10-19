-- 0002 schema_version: let the app ask which migration its database is at.
--
-- On sign-in the app compares this with the migrations it was built for
-- and warns when the database is behind (a missing function then fails
-- only where it's used, which is hard to tell apart from a bug).
-- Make the same change in schema.sql, where it belongs in that file's
-- order (npm run test:db checks that baseline.sql + migrations = schema.sql).

BEGIN;

-- Refuses to run twice or before migration 1
SELECT apply_migration(2, 'schema_version');

-- The highest migration applied; schema_migrations itself stays unreadable
-- through the API. Signed-in users only.
CREATE OR REPLACE FUNCTION get_schema_version()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(MAX(version), 0) FROM schema_migrations;
$$;

REVOKE EXECUTE ON FUNCTION get_schema_version() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_schema_version() TO authenticated;

COMMIT;
