-- =====================================================
-- DEV TIME TRACKER - COMPLETE DATABASE SCHEMA
-- =====================================================
-- Architecture: 100% Cloud (Supabase/PostgreSQL)
-- This replaces the local SQLite database entirely
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- CORE TABLES
-- =====================================================

-- Organizations table
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User profiles (extends Supabase auth.users)
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    avatar TEXT,
    role TEXT DEFAULT 'employee' CHECK (role IN ('admin', 'manager', 'employee')),
    org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Organization join requests
CREATE TABLE org_join_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, org_id)
);

-- =====================================================
-- PROJECT MANAGEMENT
-- =====================================================

-- Projects table (unified: personal + organization projects)
CREATE TABLE cloud_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#3b82f6',
    scope TEXT NOT NULL DEFAULT 'organization' CHECK (scope IN ('personal', 'organization')),
    is_active BOOLEAN DEFAULT true,
    manager_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Project members table
CREATE TABLE project_members (
   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member' CHECK (role IN ('manager', 'member')),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

-- =====================================================
-- TIME TRACKING
-- =====================================================

-- Work sessions table
CREATE TABLE time_tracking_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    project_id UUID REFERENCES cloud_projects(id) ON DELETE SET NULL,
    title TEXT,
    description TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration INTEGER, -- in seconds
    is_billable BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usage logs (detailed application/editor tracking)
CREATE TABLE usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    session_id UUID REFERENCES time_tracking_sessions(id) ON DELETE SET NULL,
    app_name TEXT NOT NULL,
    window_title TEXT,
    language TEXT,
    language_extension TEXT,
    icon_url TEXT,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily usage summary (aggregated data for performance)
CREATE TABLE daily_usage_summary (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    app_name TEXT NOT NULL,
    language TEXT,
    language_extension TEXT,
    icon_url TEXT,
    time_spent_seconds INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date, app_name, language)
);

-- =====================================================
-- TAGS & ORGANIZATION
-- =====================================================

-- User tags
CREATE TABLE user_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#3b82f6',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

-- Session tags (many-to-many)
CREATE TABLE session_tags (
    session_id UUID NOT NULL REFERENCES time_tracking_sessions(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES user_tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (session_id, tag_id)
);

-- =====================================================
-- GOALS & PLANNING
-- =====================================================

-- Daily work goals
CREATE TABLE daily_work_goals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    target_minutes INTEGER NOT NULL,
    description TEXT,
    is_completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- Scheduled work sessions
CREATE TABLE scheduled_work_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    project_id UUID REFERENCES cloud_projects(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    scheduled_datetime TIMESTAMPTZ NOT NULL,
    estimated_duration_minutes INTEGER,
    recurrence_type TEXT DEFAULT 'none' CHECK (recurrence_type IN ('none', 'weekly')),
    recurrence_data JSONB,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'notified', 'completed', 'missed', 'cancelled')),
    actual_session_id UUID REFERENCES time_tracking_sessions(id) ON DELETE SET NULL,
    last_notification_sent TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scheduled session tags (many-to-many)
CREATE TABLE scheduled_session_tags (
    scheduled_session_id UUID NOT NULL REFERENCES scheduled_work_sessions(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES user_tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (scheduled_session_id, tag_id)
);

-- =====================================================
-- USER PREFERENCES
-- =====================================================

-- User application preferences and settings
CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    theme TEXT DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
    accent_color TEXT DEFAULT '#3b82f6',
    editor_colors JSONB DEFAULT '{}', -- { "VS Code": "#007acc", "IntelliJ": "#ff6b6b", ... }
    notification_settings JSONB DEFAULT '{"daily_goals": true, "scheduled_sessions": true}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_usage_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_work_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_session_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- ============================
-- ORGANIZATIONS POLICIES
-- ============================

CREATE POLICY "Users can view their own organization"
ON organizations FOR SELECT
USING (id = get_current_user_org_id());

CREATE POLICY "Users can view organizations they requested to join"
ON organizations FOR SELECT
USING (id IN (SELECT org_id FROM org_join_requests WHERE user_id = auth.uid()));

CREATE POLICY "Admins can update their organization"
ON organizations FOR UPDATE
USING (
    id = get_current_user_org_id()
    AND get_current_user_role() = 'admin'
);

-- ============================
-- USER PROFILES POLICIES
-- ============================

CREATE POLICY "Users can view their own profile"
ON user_profiles FOR SELECT
USING (id = auth.uid());

CREATE POLICY "Users can view profiles in their organization"
ON user_profiles FOR SELECT
USING (org_id = get_current_user_org_id() AND org_id IS NOT NULL);

CREATE POLICY "Users can insert their own profile"
ON user_profiles FOR INSERT
WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update their own profile"
ON user_profiles FOR UPDATE
USING (id = auth.uid());

CREATE POLICY "Admins can update user roles in their org"
ON user_profiles FOR UPDATE
USING (
    org_id = get_current_user_org_id()
    AND get_current_user_role() = 'admin'
);

-- ============================
-- ORG JOIN REQUESTS POLICIES
-- ============================

CREATE POLICY "Users can view their own join requests"
ON org_join_requests FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Admins can view requests for their org"
ON org_join_requests FOR SELECT
USING (
    org_id = get_current_user_org_id()
    AND get_current_user_role() = 'admin'
);

CREATE POLICY "Users can create join requests"
ON org_join_requests FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can cancel their pending requests"
ON org_join_requests FOR DELETE
USING (user_id = auth.uid() AND status = 'pending');

CREATE POLICY "Admins can update requests for their org"
ON org_join_requests FOR UPDATE
USING (
    org_id = get_current_user_org_id()
    AND get_current_user_role() = 'admin'
);

-- ============================
-- PROJECTS POLICIES
-- ============================

CREATE POLICY "Users can view their own personal projects"
ON cloud_projects FOR SELECT
USING (scope = 'personal' AND manager_id = auth.uid());

CREATE POLICY "Users can view org projects they're in"
ON cloud_projects FOR SELECT
USING (
    scope = 'organization' 
    AND org_id = get_current_user_org_id()
);

CREATE POLICY "Users can create personal projects"
ON cloud_projects FOR INSERT
WITH CHECK (scope = 'personal' AND manager_id = auth.uid());

CREATE POLICY "Admins/managers can create org projects"
ON cloud_projects FOR INSERT
WITH CHECK (
    scope = 'organization'
    AND org_id = get_current_user_org_id()
    AND get_current_user_role() IN ('admin', 'manager')
);

CREATE POLICY "Project managers can update their projects"
ON cloud_projects FOR UPDATE
USING (manager_id = auth.uid());

CREATE POLICY "Admins can update org projects"
ON cloud_projects FOR UPDATE
USING (
    scope = 'organization'
    AND org_id = get_current_user_org_id()
    AND get_current_user_role() = 'admin'
);

CREATE POLICY "Project managers can delete their projects"
ON cloud_projects FOR DELETE
USING (manager_id = auth.uid());

-- ============================
-- PROJECT MEMBERS POLICIES
-- ============================

CREATE POLICY "Users can view members of their projects"
ON project_members FOR SELECT
USING (
    project_id IN (
        SELECT id FROM cloud_projects 
        WHERE manager_id = auth.uid() 
        OR (scope = 'organization' AND org_id = get_current_user_org_id())
    )
);

CREATE POLICY "Project managers can manage members"
ON project_members FOR ALL
USING (
    project_id IN (SELECT id FROM cloud_projects WHERE manager_id = auth.uid())
);

-- ============================
-- TIME TRACKING SESSIONS POLICIES
-- ============================

CREATE POLICY "Users can view their own sessions"
ON time_tracking_sessions FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Admins/managers can view org sessions"
ON time_tracking_sessions FOR SELECT
USING (
    org_id = get_current_user_org_id()
    AND get_current_user_role() IN ('admin', 'manager')
);

CREATE POLICY "Users can insert their own sessions"
ON time_tracking_sessions FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own sessions"
ON time_tracking_sessions FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own sessions"
ON time_tracking_sessions FOR DELETE
USING (user_id = auth.uid());

-- ============================
-- USAGE LOGS POLICIES
-- ============================

CREATE POLICY "Users can view their own usage logs"
ON usage_logs FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Admins/managers can view org usage logs"
ON usage_logs FOR SELECT
USING (
    org_id = get_current_user_org_id()
    AND get_current_user_role() IN ('admin', 'manager')
);

CREATE POLICY "Users can insert their own usage logs"
ON usage_logs FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own usage logs"
ON usage_logs FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own usage logs"
ON usage_logs FOR DELETE
USING (user_id = auth.uid());

-- ============================
-- DAILY USAGE SUMMARY POLICIES
-- ============================

CREATE POLICY "Users can view their own usage summary"
ON daily_usage_summary FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Admins/managers can view org usage summary"
ON daily_usage_summary FOR SELECT
USING (
    org_id = get_current_user_org_id()
    AND get_current_user_role() IN ('admin', 'manager')
);

CREATE POLICY "Users can manage their own usage summary"
ON daily_usage_summary FOR ALL
USING (user_id = auth.uid());

-- ============================
-- TAGS POLICIES
-- ============================

CREATE POLICY "Users can manage their own tags"
ON user_tags FOR ALL
USING (user_id = auth.uid());

CREATE POLICY "Users can manage their session tags"
ON session_tags FOR ALL
USING (
    session_id IN (SELECT id FROM time_tracking_sessions WHERE user_id = auth.uid())
);

-- ============================
-- GOALS POLICIES
-- ============================

CREATE POLICY "Users can manage their own goals"
ON daily_work_goals FOR ALL
USING (user_id = auth.uid());

CREATE POLICY "Admins can view team goals"
ON daily_work_goals FOR SELECT
USING (
    user_id IN (
        SELECT id FROM user_profiles 
        WHERE org_id = get_current_user_org_id()
    )
    AND get_current_user_role() = 'admin'
);

-- ============================
-- SCHEDULED SESSIONS POLICIES
-- ============================

CREATE POLICY "Users can manage their own scheduled sessions"
ON scheduled_work_sessions FOR ALL
USING (user_id = auth.uid());

CREATE POLICY "Users can manage their scheduled session tags"
ON scheduled_session_tags FOR ALL
USING (
    scheduled_session_id IN (SELECT id FROM scheduled_work_sessions WHERE user_id = auth.uid())
);

-- ============================
-- USER PREFERENCES POLICIES
-- ============================

CREATE POLICY "Users can manage their own preferences"
ON user_preferences FOR ALL
USING (user_id = auth.uid());

-- =====================================================
-- PERFORMANCE INDEXES
-- =====================================================

-- User profiles
CREATE INDEX idx_user_profiles_org_id ON user_profiles(org_id);
CREATE INDEX idx_user_profiles_username ON user_profiles(username);
CREATE INDEX idx_user_profiles_email ON user_profiles(email);

-- Org join requests
CREATE INDEX idx_org_join_requests_org_id ON org_join_requests(org_id);
CREATE INDEX idx_org_join_requests_user_id ON org_join_requests(user_id);
CREATE INDEX idx_org_join_requests_status ON org_join_requests(status);

-- Projects
CREATE INDEX idx_cloud_projects_org_id ON cloud_projects(org_id);
CREATE INDEX idx_cloud_projects_manager_id ON cloud_projects(manager_id);
CREATE INDEX idx_cloud_projects_scope ON cloud_projects(scope);
CREATE INDEX idx_cloud_projects_active ON cloud_projects(is_active);
CREATE INDEX idx_project_members_project_id ON project_members(project_id);
CREATE INDEX idx_project_members_user_id ON project_members(user_id);

-- Time tracking
CREATE INDEX idx_sessions_user_id ON time_tracking_sessions(user_id);
CREATE INDEX idx_sessions_org_id ON time_tracking_sessions(org_id);
CREATE INDEX idx_sessions_project_id ON time_tracking_sessions(project_id);
CREATE INDEX idx_sessions_start_time ON time_tracking_sessions(start_time);

-- Usage logs
CREATE INDEX idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX idx_usage_logs_org_id ON usage_logs(org_id);
CREATE INDEX idx_usage_logs_session_id ON usage_logs(session_id);
CREATE INDEX idx_usage_logs_timestamp ON usage_logs(timestamp);

-- Daily usage summary
CREATE INDEX idx_daily_summary_user_date ON daily_usage_summary(user_id, date);
CREATE INDEX idx_daily_summary_org_date ON daily_usage_summary(org_id, date);
CREATE INDEX idx_daily_summary_app ON daily_usage_summary(app_name);

-- Tags
CREATE INDEX idx_user_tags_user_id ON user_tags(user_id);
CREATE INDEX idx_session_tags_session_id ON session_tags(session_id);
CREATE INDEX idx_session_tags_tag_id ON session_tags(tag_id);

-- Goals
CREATE INDEX idx_daily_goals_user_date ON daily_work_goals(user_id, date);
CREATE INDEX idx_daily_goals_completed ON daily_work_goals(is_completed);

-- Scheduled sessions
CREATE INDEX idx_scheduled_sessions_user_id ON scheduled_work_sessions(user_id);
CREATE INDEX idx_scheduled_sessions_datetime ON scheduled_work_sessions(scheduled_datetime);
CREATE INDEX idx_scheduled_sessions_status ON scheduled_work_sessions(status);
CREATE INDEX idx_scheduled_sessions_actual ON scheduled_work_sessions(actual_session_id);

-- User preferences
CREATE INDEX idx_user_preferences_user_id ON user_preferences(user_id);

-- =====================================================
-- SCHEMA COMPLETE
-- =====================================================
-- Next step: Apply functions_and_triggers.sql
-- =====================================================

-- Apply timestamp triggers to all tables with updated_at
CREATE TRIGGER set_timestamp_organizations
BEFORE UPDATE ON organizations
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_user_profiles
BEFORE UPDATE ON user_profiles
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_org_join_requests
BEFORE UPDATE ON org_join_requests
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_cloud_projects
BEFORE UPDATE ON cloud_projects
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_time_tracking_sessions
BEFORE UPDATE ON time_tracking_sessions
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_daily_usage_summary
BEFORE UPDATE ON daily_usage_summary
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_user_tags
BEFORE UPDATE ON user_tags
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_daily_work_goals
BEFORE UPDATE ON daily_work_goals
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_scheduled_work_sessions
BEFORE UPDATE ON scheduled_work_sessions
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_user_preferences
BEFORE UPDATE ON user_preferences
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Create trigger for new user creation
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- Trigger to auto-calculate duration
CREATE TRIGGER calculate_session_duration_trigger
BEFORE INSERT OR UPDATE ON time_tracking_sessions
FOR EACH ROW
EXECUTE FUNCTION calculate_session_duration();

-- Trigger to auto-set org_id
CREATE TRIGGER set_session_org_id_trigger
BEFORE INSERT ON time_tracking_sessions
FOR EACH ROW
EXECUTE FUNCTION set_session_org_id();