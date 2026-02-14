-- =====================================================
-- DEV TIME TRACKER - FUNCTIONS & TRIGGERS
-- =====================================================
-- This file contains all database functions, triggers,
-- and stored procedures for the Dev Time Tracker app
-- =====================================================

-- =====================================================
-- UTILITY FUNCTIONS
-- =====================================================

-- Function to automatically update updated_at timestamps
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- AUTHENTICATION & USER MANAGEMENT
-- =====================================================

-- Trigger to automatically create user profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_org_id UUID;
    username TEXT;
BEGIN
    -- Get username from metadata or email
    username := COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1));
    
    -- Create a personal organization for the new user
    INSERT INTO public.organizations (name)
    VALUES (username || '''s Organization')
    RETURNING id INTO new_org_id;
    
    -- Create user profile with the new org and set as admin
    INSERT INTO public.user_profiles (id, username, email, org_id, role)
    VALUES (
        NEW.id,
        username,
        NEW.email,
        new_org_id,
        'admin' -- User is admin of their personal org
    );
    
    -- Create default user preferences
    INSERT INTO public.user_preferences (user_id)
    VALUES (NEW.id);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- ROLE & PERMISSION HELPERS
-- =====================================================
-- CRITICAL: These functions use SECURITY DEFINER to bypass RLS
-- This prevents infinite recursion when RLS policies query user_profiles

-- Function to get user's org_id (bypasses RLS)
CREATE OR REPLACE FUNCTION get_current_user_org_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id UUID;
BEGIN
    -- Direct query with NO RLS check (SECURITY DEFINER bypasses RLS)
    SELECT org_id INTO v_org_id
    FROM public.user_profiles
    WHERE id = auth.uid();
    
    RETURN v_org_id;
END;
$$;

-- Function to get user's role (bypasses RLS)
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT;
BEGIN
    -- Direct query with NO RLS check (SECURITY DEFINER bypasses RLS)
    SELECT role INTO v_role
    FROM public.user_profiles
    WHERE id = auth.uid();
    
    RETURN v_role;
END;
$$;

-- Convenience function to check if user is admin or manager
CREATE OR REPLACE FUNCTION is_user_admin_or_manager()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN get_current_user_role() IN ('admin', 'manager');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Convenience function to check if user is admin
CREATE OR REPLACE FUNCTION is_user_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN get_current_user_role() = 'admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if two users are in the same org
CREATE OR REPLACE FUNCTION same_org(target_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    current_org UUID;
    target_org UUID;
BEGIN
    current_org := get_current_user_org_id();
    SELECT org_id INTO target_org FROM user_profiles WHERE id = target_user_id;
    
    RETURN current_org IS NOT NULL 
        AND target_org IS NOT NULL 
        AND current_org = target_org;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ORGANIZATION MANAGEMENT
-- =====================================================

-- Function to create a personal organization for a user
CREATE OR REPLACE FUNCTION public.create_personal_organization(user_id UUID, org_name TEXT)
RETURNS UUID AS $$
DECLARE
    new_org_id UUID;
BEGIN
    INSERT INTO organizations (name)
    VALUES (org_name)
    RETURNING id INTO new_org_id;
    
    UPDATE user_profiles
    SET org_id = new_org_id,
        role = 'admin'
    WHERE id = user_id;
    
    RETURN new_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create a new team organization
CREATE OR REPLACE FUNCTION create_team_organization(org_name TEXT)
RETURNS UUID AS $$
DECLARE
    new_org_id UUID;
BEGIN
    -- Verify user is admin or manager
    IF NOT is_user_admin_or_manager() THEN
        RAISE EXCEPTION 'Only admins and managers can create organizations';
    END IF;
    
    -- Create the organization
    INSERT INTO organizations (name)
    VALUES (org_name)
    RETURNING id INTO new_org_id;
    
    RETURN new_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to approve a join request
CREATE OR REPLACE FUNCTION approve_join_request(request_id UUID)
RETURNS VOID AS $$
DECLARE
    req_user_id UUID;
    req_org_id UUID;
    current_org UUID;
BEGIN
    -- Check if the current user is admin
    IF NOT is_user_admin() THEN
        RAISE EXCEPTION 'Only admins can approve join requests';
    END IF;
    
    -- Get current user's org
    current_org := get_current_user_org_id();
    
    -- Get request details
    SELECT user_id, org_id INTO req_user_id, req_org_id
    FROM org_join_requests
    WHERE id = request_id AND status = 'pending';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Join request not found or already processed';
    END IF;
    
    -- Verify the request is for the admin's org
    IF req_org_id != current_org THEN
        RAISE EXCEPTION 'Cannot approve request for different organization';
    END IF;
    
    -- Update the user's org_id (with employee role by default)
    UPDATE user_profiles
    SET org_id = req_org_id,
        role = 'employee'
    WHERE id = req_user_id;
    
    -- Update the request status
    UPDATE org_join_requests
    SET status = 'approved',
        reviewed_at = NOW(),
        reviewed_by = auth.uid()
    WHERE id = request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to reject a join request
CREATE OR REPLACE FUNCTION reject_join_request(request_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Check if the current user is admin
    IF NOT is_user_admin() THEN
        RAISE EXCEPTION 'Only admins can reject join requests';
    END IF;
    
    -- Update the request status
    UPDATE org_join_requests
    SET status = 'rejected',
        reviewed_at = NOW(),
        reviewed_by = auth.uid()
    WHERE id = request_id
    AND status = 'pending'
    AND org_id = get_current_user_org_id();
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Join request not found or cannot be rejected';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- PROJECT MANAGEMENT
-- =====================================================

-- Function to create a project (handles both personal and org projects)
CREATE OR REPLACE FUNCTION create_project(
    project_name TEXT,
    project_description TEXT DEFAULT NULL,
    project_color TEXT DEFAULT '#3b82f6',
    project_scope TEXT DEFAULT 'organization',
    target_org_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    new_project_id UUID;
    user_org_id UUID;
BEGIN
    -- Get user's org_id
    user_org_id := get_current_user_org_id();
    
    -- Validate scope
    IF project_scope NOT IN ('personal', 'organization') THEN
        RAISE EXCEPTION 'Invalid project scope. Must be "personal" or "organization"';
    END IF;
    
    -- Validate organization projects
    IF project_scope = 'organization' THEN
        IF NOT is_user_admin_or_manager() THEN
            RAISE EXCEPTION 'Only admins and managers can create organization projects';
        END IF;
        
        IF target_org_id IS NULL THEN
            target_org_id := user_org_id;
        END IF;
    ELSE
        -- Personal projects don't need org_id
        target_org_id := NULL;
    END IF;
    
    -- Create the project
    INSERT INTO cloud_projects (name, description, color, scope, manager_id, org_id)
    VALUES (project_name, project_description, project_color, project_scope, auth.uid(), target_org_id)
    RETURNING id INTO new_project_id;
    
    -- Add creator as manager in project_members
    INSERT INTO project_members (project_id, user_id, role)
    VALUES (new_project_id, auth.uid(), 'manager');
    
    RETURN new_project_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TIME TRACKING HELPERS
-- =====================================================

-- Function to calculate session duration when end_time is set
CREATE OR REPLACE FUNCTION calculate_session_duration()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.end_time IS NOT NULL AND NEW.start_time IS NOT NULL THEN
        NEW.duration := EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time))::INTEGER;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;



-- Function to auto-populate org_id from user when creating sessions
CREATE OR REPLACE FUNCTION set_session_org_id()
RETURNS TRIGGER AS $$
DECLARE
    user_org UUID;
BEGIN
    IF NEW.org_id IS NULL THEN
        SELECT org_id INTO user_org FROM user_profiles WHERE id = NEW.user_id;
        NEW.org_id := user_org;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- Function to auto-populate org_id for usage logs
CREATE OR REPLACE FUNCTION set_usage_log_org_id()
RETURNS TRIGGER AS $$
DECLARE
    user_org UUID;
BEGIN
    IF NEW.org_id IS NULL THEN
        SELECT org_id INTO user_org FROM user_profiles WHERE id = NEW.user_id;
        NEW.org_id := user_org;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- USAGE SUMMARY AGGREGATION
-- =====================================================

-- Function to update daily usage summary (called when usage logs are created)
CREATE OR REPLACE FUNCTION update_daily_usage_summary(
    p_user_id UUID,
    p_date DATE,
    p_app_name TEXT,
    p_language TEXT,
    p_language_extension TEXT,
    p_icon_url TEXT,
    p_time_spent_seconds INTEGER
)
RETURNS VOID AS $$
DECLARE
    v_org_id UUID;
BEGIN
    -- Get user's org_id
    v_org_id := (SELECT org_id FROM user_profiles WHERE id = p_user_id);
    
    -- Insert or update summary
    INSERT INTO daily_usage_summary (
        user_id,
        org_id,
        date,
        app_name,
        language,
        language_extension,
        icon_url,
        time_spent_seconds
    )
    VALUES (
        p_user_id,
        v_org_id,
        p_date,
        p_app_name,
        p_language,
        p_language_extension,
        p_icon_url,
        p_time_spent_seconds
    )
    ON CONFLICT (user_id, date, app_name, language)
    DO UPDATE SET
        time_spent_seconds = daily_usage_summary.time_spent_seconds + EXCLUDED.time_spent_seconds,
        language_extension = COALESCE(EXCLUDED.language_extension, daily_usage_summary.language_extension),
        icon_url = COALESCE(EXCLUDED.icon_url, daily_usage_summary.icon_url),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- SCHEDULED SESSIONS HELPERS
-- =====================================================

-- Function to get upcoming session notifications
CREATE OR REPLACE FUNCTION get_upcoming_session_notifications(
    p_user_id UUID,
    p_lookahead_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
    id UUID,
    title TEXT,
    scheduled_datetime TIMESTAMPTZ,
    estimated_duration_minutes INTEGER,
    type TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sws.id,
        sws.title,
        sws.scheduled_datetime,
        sws.estimated_duration_minutes,
        CASE 
            WHEN sws.scheduled_datetime - INTERVAL '1 day' <= NOW() 
            AND sws.scheduled_datetime - INTERVAL '1 day' > NOW() - INTERVAL '1 hour'
            THEN 'day_before'
            WHEN sws.scheduled_datetime::DATE = CURRENT_DATE 
            AND sws.scheduled_datetime > NOW()
            THEN 'same_day'
            WHEN sws.scheduled_datetime <= NOW() + INTERVAL '15 minutes'
            AND sws.scheduled_datetime > NOW()
            THEN 'time_to_start'
            ELSE 'normal'
        END AS type
    FROM scheduled_work_sessions sws
    WHERE sws.user_id = p_user_id
    AND sws.status IN ('pending', 'notified')
    AND sws.scheduled_datetime BETWEEN NOW() AND (NOW() + (p_lookahead_hours || ' hours')::INTERVAL)
    ORDER BY sws.scheduled_datetime ASC;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- STATISTICS & ANALYTICS
-- =====================================================

-- Function to get user's total time spent for a date range
CREATE OR REPLACE FUNCTION get_user_total_time(
    p_user_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS INTEGER AS $$
DECLARE
    total_seconds INTEGER;
BEGIN
    SELECT COALESCE(SUM(time_spent_seconds), 0)
    INTO total_seconds
    FROM daily_usage_summary
    WHERE user_id = p_user_id
    AND date BETWEEN p_start_date AND p_end_date;
    
    RETURN total_seconds;
END;
$$ LANGUAGE plpgsql;

-- Function to get organization's total time spent for a date range
CREATE OR REPLACE FUNCTION get_org_total_time(
    p_org_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS INTEGER AS $$
DECLARE
    total_seconds INTEGER;
BEGIN
    SELECT COALESCE(SUM(time_spent_seconds), 0)
    INTO total_seconds
    FROM daily_usage_summary
    WHERE org_id = p_org_id
    AND date BETWEEN p_start_date AND p_end_date;
    
    RETURN total_seconds;
END;
$$ LANGUAGE plpgsql;

-- Function to get project statistics
CREATE OR REPLACE FUNCTION get_project_stats(p_project_id UUID)
RETURNS TABLE (
    total_sessions INTEGER,
    total_time_seconds INTEGER,
    total_members INTEGER,
    last_activity TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(DISTINCT tts.id)::INTEGER AS total_sessions,
        COALESCE(SUM(tts.duration), 0)::INTEGER AS total_time_seconds,
        COUNT(DISTINCT pm.user_id)::INTEGER AS total_members,
        MAX(tts.start_time) AS last_activity
    FROM cloud_projects cp
    LEFT JOIN time_tracking_sessions tts ON tts.project_id = cp.id
    LEFT JOIN project_members pm ON pm.project_id = cp.id
    WHERE cp.id = p_project_id
    GROUP BY cp.id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- FUNCTIONS COMPLETE
-- =====================================================
-- All database functions, triggers, and helpers are now defined
-- Apply this after running schema.sql
-- =====================================================