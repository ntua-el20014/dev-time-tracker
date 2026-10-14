-- =====================================================
-- PATCH 007: Data-integrity fixes (Phase A)
-- =====================================================
-- Run this in the Supabase SQL editor BEFORE running a client built from the
-- phase-a-fixes branch. Section 3 is required by that client: without it the
-- duration trigger would overwrite active duration with wall-clock time.
--
-- Safe to re-run.
--
--   1. daily_usage_summary: rows with language = NULL (browsers, terminals,
--      dev tools) never matched the upsert key, because UNIQUE treats NULLs as
--      distinct — every tracking tick inserted a new row. Merge the duplicates
--      and make the key treat NULLs as equal. Requires Postgres 15+.
--   2. usage_logs.org_id was never populated: set_usage_log_org_id() existed
--      but no trigger called it.
--   3. Session duration trigger now only derives duration when the app did
--      not supply one, so sessions can store end_time (wall clock, pauses
--      included) next to duration (active time, pauses excluded).
--   4. (optional, commented out) clear per-row icon blobs from usage_logs.
-- =====================================================

DO $$
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION
      'Patch 007 needs Postgres 15+ for UNIQUE NULLS NOT DISTINCT (found %).',
      current_setting('server_version');
  END IF;
END $$;

BEGIN;

-- -----------------------------------------------------
-- 1. daily_usage_summary: merge duplicates, fix unique key
-- -----------------------------------------------------

-- GROUP BY treats NULLs as equal, so each group is one logical summary row.
DROP TABLE IF EXISTS _patch007_dus_merge;
CREATE TEMP TABLE _patch007_dus_merge AS
SELECT
  user_id,
  date,
  app_name,
  language,
  (ARRAY_AGG(id ORDER BY created_at, id))[1] AS keep_id,
  SUM(COALESCE(time_spent_seconds, 0))::INTEGER AS total_seconds,
  (ARRAY_AGG(language_extension ORDER BY updated_at DESC)
     FILTER (WHERE language_extension IS NOT NULL))[1] AS language_extension,
  (ARRAY_AGG(icon_url ORDER BY updated_at DESC)
     FILTER (WHERE icon_url IS NOT NULL))[1] AS icon_url
FROM daily_usage_summary
GROUP BY user_id, date, app_name, language
HAVING COUNT(*) > 1;

UPDATE daily_usage_summary d
SET
  time_spent_seconds = m.total_seconds,
  language_extension = COALESCE(m.language_extension, d.language_extension),
  icon_url = COALESCE(m.icon_url, d.icon_url)
FROM _patch007_dus_merge m
WHERE d.id = m.keep_id;

DELETE FROM daily_usage_summary d
USING _patch007_dus_merge m
WHERE d.user_id = m.user_id
  AND d.date = m.date
  AND d.app_name = m.app_name
  AND d.language IS NOT DISTINCT FROM m.language
  AND d.id <> m.keep_id;

DROP TABLE _patch007_dus_merge;

-- Replace the original UNIQUE(user_id, date, app_name, language), whatever
-- name Postgres gave it, with a NULLS NOT DISTINCT version. The existing
-- ON CONFLICT (user_id, date, app_name, language) in
-- update_daily_usage_summary() infers this constraint unchanged.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.daily_usage_summary'::regclass
      AND con.contype = 'u'
      AND con.conname <> 'daily_usage_summary_unique_day_app_lang'
  LOOP
    EXECUTE format('ALTER TABLE daily_usage_summary DROP CONSTRAINT %I', c.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.daily_usage_summary'::regclass
      AND conname = 'daily_usage_summary_unique_day_app_lang'
  ) THEN
    ALTER TABLE daily_usage_summary
      ADD CONSTRAINT daily_usage_summary_unique_day_app_lang
      UNIQUE NULLS NOT DISTINCT (user_id, date, app_name, language);
  END IF;
END $$;

-- -----------------------------------------------------
-- 2. usage_logs.org_id trigger + backfill
-- -----------------------------------------------------

DROP TRIGGER IF EXISTS set_usage_log_org_id_trigger ON usage_logs;
CREATE TRIGGER set_usage_log_org_id_trigger
BEFORE INSERT ON usage_logs
FOR EACH ROW
EXECUTE FUNCTION set_usage_log_org_id();

-- Backfill from the summary row of the same user/day/app. Its org_id was set
-- at the time, which is more accurate than the user's *current* org (they may
-- have switched orgs since). Existing rows are dated by UTC day.
UPDATE usage_logs ul
SET org_id = dus.org_id
FROM daily_usage_summary dus
WHERE ul.org_id IS NULL
  AND dus.org_id IS NOT NULL
  AND dus.user_id = ul.user_id
  AND dus.app_name = ul.app_name
  AND dus.date = (ul.timestamp AT TIME ZONE 'UTC')::DATE;

-- -----------------------------------------------------
-- 3. Session duration trigger: don't overwrite app-supplied duration
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION calculate_session_duration()
RETURNS TRIGGER AS $$
BEGIN
    -- duration = active time (pauses excluded), supplied by the app.
    -- end_time = wall-clock end. Only derive duration when it is missing.
    IF NEW.duration IS NULL
       AND NEW.end_time IS NOT NULL
       AND NEW.start_time IS NOT NULL THEN
        NEW.duration := EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time))::INTEGER;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- -----------------------------------------------------
-- 4. OPTIONAL: reclaim space from per-row icon blobs
-- -----------------------------------------------------
-- The app no longer writes or reads usage_logs.icon_url (icons live on
-- daily_usage_summary). Uncomment to clear old blobs. Rewrites every row with
-- an icon, so it can take a while on a large table.
--
-- UPDATE usage_logs SET icon_url = NULL WHERE icon_url IS NOT NULL;

-- -----------------------------------------------------
-- NOT INCLUDED: re-dating historical data to local days
-- -----------------------------------------------------
-- Rows written before this patch are dated by UTC day. The client now writes
-- local days. Old summary rows for activity between local midnight and the UTC
-- offset (e.g. 00:00–03:00 in Greece) stay on the previous day. Rebuilding
-- them from usage_logs would mean assuming a fixed tracking interval per log,
-- so it is left as a manual decision.
