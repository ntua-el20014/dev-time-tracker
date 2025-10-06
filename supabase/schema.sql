-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Utility function for updating timestamps
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Organizations table
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create a trigger to automatically update the updated_at column
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON organizations
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Application settings table (for global settings)
CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON app_settings
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Users table (extends Supabase auth.users)
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    local_id TEXT,
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    avatar TEXT,
    role TEXT DEFAULT 'employee' CHECK (role IN ('admin', 'manager', 'employee')),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON user_profiles
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Tags table
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    local_id TEXT,
    name TEXT NOT NULL,
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    color TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(name, user_id)
);

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON tags
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Projects table
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    local_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    is_active BOOLEAN DEFAULT true,
    manager_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON projects
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Project members table
CREATE TABLE project_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member' CHECK (role IN ('manager', 'member')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

-- Usage tracking table
CREATE TABLE usage_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    local_id TEXT,
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    app TEXT,
    title TEXT,
    language TEXT,
    timestamp TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON usage_tracking
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Usage summary table
CREATE TABLE usage_summary (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    local_id TEXT,
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    app TEXT,
    language TEXT,
    lang_ext TEXT,
    date DATE,
    icon TEXT,
    time_spent INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(app, language, date, user_id)
);

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON usage_summary
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Row Level Security (RLS) Policies

-- Organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own organization"
ON organizations FOR SELECT
USING (id IN (
    SELECT org_id FROM user_profiles WHERE id = auth.uid()
));

-- User Profiles
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view profiles in their organization"
ON user_profiles FOR SELECT
USING (org_id IN (
    SELECT org_id FROM user_profiles WHERE id = auth.uid()
));

CREATE POLICY "Users can update their own profile"
ON user_profiles FOR UPDATE
USING (id = auth.uid());

-- Projects
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view projects in their organization"
ON projects FOR SELECT
USING (org_id IN (
    SELECT org_id FROM user_profiles WHERE id = auth.uid()
));

CREATE POLICY "Managers can create projects"
ON projects FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM user_profiles 
        WHERE id = auth.uid() 
        AND role IN ('manager', 'admin')
    )
);

CREATE POLICY "Project managers can update their projects"
ON projects FOR UPDATE
USING (manager_id = auth.uid());

-- Usage Tracking
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view and insert their own usage data"
ON usage_tracking FOR ALL
USING (user_id = auth.uid());

-- Usage Summary
ALTER TABLE usage_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view and update their own usage summary"
ON usage_summary FOR ALL
USING (user_id = auth.uid());

-- Sessions table
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    local_id TEXT,
    timestamp TIMESTAMPTZ,
    start_time TIMESTAMPTZ,
    duration INTEGER,
    title TEXT,
    description TEXT,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    is_billable BOOLEAN DEFAULT false,
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON sessions
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Session tags junction table
CREATE TABLE session_tags (
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (session_id, tag_id)
);

-- Daily goals table
CREATE TABLE daily_goals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    local_id TEXT,
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    time INTEGER NOT NULL, -- in minutes
    description TEXT,
    is_completed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON daily_goals
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Scheduled sessions table
CREATE TABLE scheduled_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    local_id TEXT,
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    scheduled_datetime TIMESTAMPTZ NOT NULL,
    estimated_duration INTEGER, -- in minutes
    recurrence_type TEXT CHECK(recurrence_type IN ('none', 'weekly')) DEFAULT 'none',
    recurrence_data JSONB, -- JSON for recurrence settings
    status TEXT CHECK(status IN ('pending', 'notified', 'completed', 'missed', 'cancelled')) DEFAULT 'pending',
    last_notification_sent TIMESTAMPTZ,
    actual_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL, -- Links to sessions table when completed
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON scheduled_sessions
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Scheduled session tags junction table
CREATE TABLE scheduled_session_tags (
    scheduled_session_id UUID REFERENCES scheduled_sessions(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (scheduled_session_id, tag_id)
);

-- Additional RLS policies for new tables
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_sessions ENABLE ROW LEVEL SECURITY;

-- Sessions policies
CREATE POLICY "Users can view their own sessions"
ON sessions FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can manage their own sessions"
ON sessions FOR ALL
USING (user_id = auth.uid());

-- Tags policies
CREATE POLICY "Users can view their own tags"
ON tags FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can manage their own tags"
ON tags FOR ALL
USING (user_id = auth.uid());

-- Daily goals policies
CREATE POLICY "Users can view their own goals"
ON daily_goals FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can manage their own goals"
ON daily_goals FOR ALL
USING (user_id = auth.uid());

-- Scheduled sessions policies
CREATE POLICY "Users can view their own scheduled sessions"
ON scheduled_sessions FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can manage their own scheduled sessions"
ON scheduled_sessions FOR ALL
USING (user_id = auth.uid());

-- =========================
-- AUTO-CREATE USER PROFILE
-- =========================

-- Trigger to automatically create user profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, username, email, org_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.email,
    NULL
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================
-- ORGANIZATION HELPERS
-- =========================

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
  SET org_id = new_org_id
  WHERE id = user_id;
  
  RETURN new_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================
-- UPDATED RLS POLICIES
-- =========================

-- Allow users to insert their own profile
CREATE POLICY "Users can insert their own profile"
ON user_profiles FOR INSERT
WITH CHECK (id = auth.uid());

-- Allow users to view their own profile even without org
DROP POLICY IF EXISTS "Users can view profiles in their organization" ON user_profiles;
CREATE POLICY "Users can view their own or org profiles"
ON user_profiles FOR SELECT
USING (
  id = auth.uid() 
  OR org_id IN (SELECT org_id FROM user_profiles WHERE id = auth.uid())
);

-- Admins can manage organizations
CREATE POLICY "Admins can create organizations"
ON organizations FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM user_profiles 
        WHERE id = auth.uid() 
        AND role = 'admin'
    )
);

CREATE POLICY "Admins can update their organization"
ON organizations FOR UPDATE
USING (
    id IN (
        SELECT org_id FROM user_profiles 
        WHERE id = auth.uid() 
        AND role = 'admin'
    )
);

-- =========================
-- PERFORMANCE INDEXES
-- =========================

CREATE INDEX IF NOT EXISTS idx_user_profiles_org_id ON user_profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_local_id ON user_profiles(local_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username);
CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects(org_id);
CREATE INDEX IF NOT EXISTS idx_projects_manager_id ON projects(manager_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_id ON usage_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_timestamp ON usage_tracking(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_summary_user_date ON usage_summary(user_id, date);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_goals_user_date ON daily_goals(user_id, date);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_user_id ON scheduled_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_datetime ON scheduled_sessions(scheduled_datetime);
CREATE INDEX IF NOT EXISTS idx_scheduled_sessions_actual_session ON scheduled_sessions(actual_session_id);