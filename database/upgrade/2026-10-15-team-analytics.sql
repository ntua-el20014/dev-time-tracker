-- Upgrade for databases built from an older schema.sql (2026-10-15).
-- Fresh databases: just run schema.sql, which already contains this.
-- Safe to run once in the Supabase SQL editor; it only replaces functions.

-- Team analytics: local days (p_time_zone) and billed time.
-- The signatures change, so drop the old versions first.
DROP FUNCTION IF EXISTS get_org_analytics_summary(UUID, DATE, DATE, BOOLEAN);
DROP FUNCTION IF EXISTS get_org_top_projects(UUID, DATE, DATE, UUID[], BOOLEAN, INT);
DROP FUNCTION IF EXISTS get_org_member_activity(UUID, DATE, DATE, UUID[], UUID[], BOOLEAN);

-- Seconds of a session that count as billed
CREATE OR REPLACE FUNCTION session_billed_seconds(
    p_duration INTEGER,
    p_supervising_seconds INTEGER,
    p_bill_supervising BOOLEAN
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT GREATEST(
        0,
        COALESCE(p_duration, 0)
        - CASE WHEN p_bill_supervising = false THEN COALESCE(p_supervising_seconds, 0) ELSE 0 END
    );
$$;

CREATE OR REPLACE FUNCTION get_org_analytics_summary(
    p_org_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_billable_only BOOLEAN DEFAULT false,
    p_time_zone TEXT DEFAULT 'UTC'
)
RETURNS TABLE (
    total_hours_tracked NUMERIC,
    total_sessions INTEGER,
    active_members INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT (is_user_admin_or_manager() AND get_current_user_org_id() = p_org_id) THEN
        RAISE EXCEPTION 'Only admins and managers can view organization analytics';
    END IF;

    RETURN QUERY
    SELECT
        COALESCE(SUM(
            CASE WHEN p_billable_only
                THEN session_billed_seconds(tts.duration, tts.supervising_seconds, cp.bill_supervising)
                ELSE tts.duration
            END
        )::NUMERIC / 3600, 0),
        COUNT(DISTINCT tts.id)::INTEGER,
        COUNT(DISTINCT tts.user_id)::INTEGER
    FROM time_tracking_sessions tts
    LEFT JOIN cloud_projects cp ON cp.id = tts.project_id
    WHERE tts.org_id = p_org_id
      AND (tts.start_time AT TIME ZONE COALESCE(NULLIF(p_time_zone, ''), 'UTC'))::DATE
          BETWEEN p_start_date AND p_end_date
      AND (NOT p_billable_only OR tts.is_billable);
END;
$$;

CREATE OR REPLACE FUNCTION get_org_top_projects(
    p_org_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_project_ids UUID[] DEFAULT NULL,
    p_billable_only BOOLEAN DEFAULT false,
    p_limit INT DEFAULT 10,
    p_time_zone TEXT DEFAULT 'UTC'
)
RETURNS TABLE (
    project_id UUID,
    project_name TEXT,
    total_hours NUMERIC,
    session_count INTEGER,
    active_members INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT (is_user_admin_or_manager() AND get_current_user_org_id() = p_org_id) THEN
        RAISE EXCEPTION 'Only admins and managers can view organization analytics';
    END IF;

    RETURN QUERY
    SELECT
        cp.id,
        cp.name,
        COALESCE(SUM(
            CASE WHEN p_billable_only
                THEN session_billed_seconds(tts.duration, tts.supervising_seconds, cp.bill_supervising)
                ELSE tts.duration
            END
        )::NUMERIC / 3600, 0) AS total_hours,
        COUNT(DISTINCT tts.id)::INTEGER,
        COUNT(DISTINCT tts.user_id)::INTEGER
    FROM cloud_projects cp
    JOIN time_tracking_sessions tts ON tts.project_id = cp.id
    WHERE cp.org_id = p_org_id
      AND (tts.start_time AT TIME ZONE COALESCE(NULLIF(p_time_zone, ''), 'UTC'))::DATE
          BETWEEN p_start_date AND p_end_date
      AND (p_project_ids IS NULL OR cp.id = ANY(p_project_ids))
      AND (NOT p_billable_only OR tts.is_billable)
    GROUP BY cp.id, cp.name
    ORDER BY total_hours DESC
    LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION get_org_member_activity(
    p_org_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_project_ids UUID[] DEFAULT NULL,
    p_member_ids UUID[] DEFAULT NULL,
    p_billable_only BOOLEAN DEFAULT false,
    p_time_zone TEXT DEFAULT 'UTC'
)
RETURNS TABLE (
    user_id UUID,
    username TEXT,
    total_hours NUMERIC,
    session_count INTEGER,
    active_projects INTEGER,
    top_language TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT (is_user_admin_or_manager() AND get_current_user_org_id() = p_org_id) THEN
        RAISE EXCEPTION 'Only admins and managers can view organization analytics';
    END IF;

    RETURN QUERY
    WITH member_sessions AS (
        SELECT
            tts.user_id,
            COUNT(DISTINCT tts.id)::INTEGER AS session_count,
            COALESCE(SUM(
                CASE WHEN p_billable_only
                    THEN session_billed_seconds(tts.duration, tts.supervising_seconds, cp.bill_supervising)
                    ELSE tts.duration
                END
            )::NUMERIC / 3600, 0) AS total_hours,
            COUNT(DISTINCT tts.project_id)::INTEGER AS active_projects
        FROM time_tracking_sessions tts
        LEFT JOIN cloud_projects cp ON cp.id = tts.project_id
        WHERE tts.org_id = p_org_id
          AND (tts.start_time AT TIME ZONE COALESCE(NULLIF(p_time_zone, ''), 'UTC'))::DATE
              BETWEEN p_start_date AND p_end_date
          AND (p_project_ids IS NULL OR tts.project_id = ANY(p_project_ids))
          AND (p_member_ids IS NULL OR tts.user_id = ANY(p_member_ids))
          AND (NOT p_billable_only OR tts.is_billable)
        GROUP BY tts.user_id
    ),
    member_languages AS (
        SELECT
            dus.user_id,
            dus.language,
            SUM(dus.time_spent_seconds) AS time_spent
        FROM daily_usage_summary dus
        WHERE dus.org_id = p_org_id
          AND dus.date BETWEEN p_start_date AND p_end_date
          AND (p_member_ids IS NULL OR dus.user_id = ANY(p_member_ids))
        GROUP BY dus.user_id, dus.language
    ),
    top_language_per_member AS (
        SELECT
            ml.user_id,
            ml.language,
            ROW_NUMBER() OVER (PARTITION BY ml.user_id ORDER BY ml.time_spent DESC) AS rn
        FROM member_languages ml
    )
    SELECT
        ms.user_id,
        up.username,
        ms.total_hours,
        ms.session_count,
        ms.active_projects,
        COALESCE(tl.language, 'None')
    FROM member_sessions ms
    JOIN user_profiles up ON up.id = ms.user_id
    LEFT JOIN top_language_per_member tl ON tl.user_id = ms.user_id AND tl.rn = 1
    ORDER BY ms.total_hours DESC;
END;
$$;
