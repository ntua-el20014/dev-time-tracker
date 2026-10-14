-- =====================================================
-- DEV TIME TRACKER — WIPE EVERYTHING (DESTRUCTIVE)
-- =====================================================
-- Deletes ALL app tables, functions and data in the public schema, the
-- signup trigger on auth.users, and ALL auth users. There is no undo.
--
-- Use it to start over on the same Supabase project (same URL and keys),
-- then run schema.sql.
--
-- It leaves alone: the public schema itself and its grants, extensions,
-- and Supabase's own schemas (auth, storage, ...) apart from deleting the
-- users.
-- =====================================================

BEGIN;

-- Signup trigger lives on auth.users, outside public
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

DO $$
DECLARE
    r RECORD;
BEGIN
    -- Views
    FOR r IN
        SELECT table_name FROM information_schema.views WHERE table_schema = 'public'
    LOOP
        EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.table_name);
    END LOOP;

    -- Tables (with their policies, triggers, indexes and sequences)
    FOR r IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
    END LOOP;

    -- Functions and procedures, except ones that belong to an extension
    FOR r IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = p.oid AND d.deptype = 'e'
          )
    LOOP
        EXECUTE format('DROP ROUTINE IF EXISTS %s CASCADE', r.signature);
    END LOOP;

    -- Custom types (enums, composites), except extension-owned ones
    FOR r IN
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typtype IN ('e', 'c', 'd')
          AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid)
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = t.oid AND d.deptype = 'e'
          )
    LOOP
        EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
    END LOOP;
END $$;

-- All accounts (identities, sessions and refresh tokens cascade)
DELETE FROM auth.users;

COMMIT;
