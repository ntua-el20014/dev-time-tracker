-- =====================================================
-- PATCH 006: Team Analytics (Organization-wide)
-- =====================================================
-- Adds RPC functions for org-wide analytics dashboard
-- Visible to admin/manager roles only
-- =====================================================

-- Get organization analytics summary (total hours, sessions, active members)
CREATE OR REPLACE FUNCTION get_org_analytics_summary(
    p_org_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_billable_only BOOLEAN DEFAULT false
)
RETURNS TABLE (
    total_hours_tracked NUMERIC,
    total_sessions INTEGER,
    active_members INTEGER
) AS $$
BEGIN
    -- Verify user is admin or manager in this org
    IF NOT (
        get_current_user_role() IN ('admin', 'manager')
        AND get_current_user_org_id() = p_org_id
    ) THEN
        RAISE EXCEPTION 'Only admins and managers can view organization analytics';
    END IF;
    
    RETURN QUERY
    SELECT
        COALESCE(SUM(tts.duration)::NUMERIC / 3600, 0) AS total_hours_tracked,
        COUNT(DISTINCT tts.id)::INTEGER AS total_sessions,
        COUNT(DISTINCT tts.user_id)::INTEGER AS active_members
    FROM time_tracking_sessions tts
    WHERE tts.org_id = p_org_id
    AND tts.start_time::DATE BETWEEN p_start_date AND p_end_date
    AND (NOT p_billable_only OR tts.is_billable);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get top projects by tracked duration
CREATE OR REPLACE FUNCTION get_org_top_projects(
    p_org_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_project_ids UUID[] DEFAULT NULL,
    p_billable_only BOOLEAN DEFAULT false,
    p_limit INT DEFAULT 10
)
RETURNS TABLE (
    project_id UUID,
    project_name TEXT,
    total_hours NUMERIC,
    session_count INTEGER,
    active_members INTEGER
) AS $$
BEGIN
    -- Verify user is admin or manager in this org
    IF NOT (
        get_current_user_role() IN ('admin', 'manager')
        AND get_current_user_org_id() = p_org_id
    ) THEN
        RAISE EXCEPTION 'Only admins and managers can view organization analytics';
    END IF;
    
    RETURN QUERY
    SELECT
        cp.id,
        cp.name,
        COALESCE(SUM(tts.duration)::NUMERIC / 3600, 0) AS total_hours,
        COUNT(DISTINCT tts.id)::INTEGER AS session_count,
        COUNT(DISTINCT tts.user_id)::INTEGER AS active_members
    FROM cloud_projects cp
    LEFT JOIN time_tracking_sessions tts ON tts.project_id = cp.id
    WHERE cp.org_id = p_org_id
    AND tts.start_time::DATE BETWEEN p_start_date AND p_end_date
    AND (p_project_ids IS NULL OR cp.id = ANY(p_project_ids))
    AND (NOT p_billable_only OR tts.is_billable IS NULL OR tts.is_billable)
    GROUP BY cp.id, cp.name
    ORDER BY total_hours DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get language breakdown for organization
CREATE OR REPLACE FUNCTION get_org_language_breakdown(
    p_org_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_project_ids UUID[] DEFAULT NULL,
    p_member_ids UUID[] DEFAULT NULL,
    p_billable_only BOOLEAN DEFAULT false
)
RETURNS TABLE (
    language TEXT,
    total_hours NUMERIC,
    percentage NUMERIC
) AS $$
DECLARE
    v_total_hours NUMERIC;
BEGIN
    -- Verify user is admin or manager in this org
    IF NOT (
        get_current_user_role() IN ('admin', 'manager')
        AND get_current_user_org_id() = p_org_id
    ) THEN
        RAISE EXCEPTION 'Only admins and managers can view organization analytics';
    END IF;
    
    -- Get grand total
    SELECT COALESCE(SUM(dus.time_spent_seconds)::NUMERIC / 3600, 0)
    INTO v_total_hours
    FROM daily_usage_summary dus
    WHERE dus.org_id = p_org_id
    AND dus.date BETWEEN p_start_date AND p_end_date
    AND (p_member_ids IS NULL OR dus.user_id = ANY(p_member_ids));
    
    -- Return language breakdown
    RETURN QUERY
    SELECT
        COALESCE(dus.language, 'Other') AS language,
        COALESCE(SUM(dus.time_spent_seconds)::NUMERIC / 3600, 0) AS total_hours,
        CASE
            WHEN v_total_hours > 0 THEN ROUND(
                (COALESCE(SUM(dus.time_spent_seconds)::NUMERIC / 3600, 0) / v_total_hours) * 100,
                1
            )
            ELSE 0
        END AS percentage
    FROM daily_usage_summary dus
    WHERE dus.org_id = p_org_id
    AND dus.date BETWEEN p_start_date AND p_end_date
    AND (p_member_ids IS NULL OR dus.user_id = ANY(p_member_ids))
    GROUP BY dus.language
    ORDER BY total_hours DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get team member activity (hours, sessions, projects, top language)
CREATE OR REPLACE FUNCTION get_org_member_activity(
    p_org_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_project_ids UUID[] DEFAULT NULL,
    p_member_ids UUID[] DEFAULT NULL,
    p_billable_only BOOLEAN DEFAULT false
)
RETURNS TABLE (
    user_id UUID,
    username TEXT,
    total_hours NUMERIC,
    session_count INTEGER,
    active_projects INTEGER,
    top_language TEXT
) AS $$
BEGIN
    -- Verify user is admin or manager in this org
    IF NOT (
        get_current_user_role() IN ('admin', 'manager')
        AND get_current_user_org_id() = p_org_id
    ) THEN
        RAISE EXCEPTION 'Only admins and managers can view organization analytics';
    END IF;
    
    RETURN QUERY
    WITH member_sessions AS (
        SELECT
            tts.user_id,
            COUNT(DISTINCT tts.id)::INTEGER AS session_count,
            COALESCE(SUM(tts.duration)::NUMERIC / 3600, 0) AS total_hours,
            COUNT(DISTINCT tts.project_id)::INTEGER AS active_projects
        FROM time_tracking_sessions tts
        WHERE tts.org_id = p_org_id
        AND tts.start_time::DATE BETWEEN p_start_date AND p_end_date
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
        COALESCE(tlpm.language, 'None') AS top_language
    FROM member_sessions ms
    JOIN user_profiles up ON up.id = ms.user_id
    LEFT JOIN top_language_per_member tlpm ON tlpm.user_id = ms.user_id AND tlpm.rn = 1
    ORDER BY ms.total_hours DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
