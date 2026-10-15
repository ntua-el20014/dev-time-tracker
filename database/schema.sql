-- =====================================================
-- DEV TIME TRACKER — COMPLETE DATABASE SETUP
-- =====================================================
-- One file, run once, on an empty Supabase project (or after reset.sql).
-- Order: tables → functions → triggers → row level security → indexes.
--
-- Requires Postgres 15+ (UNIQUE NULLS NOT DISTINCT). All Supabase projects
-- created since 2023 qualify.
--
-- Conventions
-- - org_id on sessions / usage rows is set by the server from the user's
--   profile; clients can't choose it.
-- - Membership and roles change only through the rules in
--   guard_user_profile_change() and the SECURITY DEFINER functions below.
-- - Every SECURITY DEFINER function pins search_path and checks the caller.
-- =====================================================


-- =====================================================
-- 1. TABLES
-- =====================================================

CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- One profile per auth user, created by handle_new_user() on signup
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    avatar TEXT,
    role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'manager', 'employee')),
    org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE org_join_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE TABLE org_invite_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    max_uses INTEGER DEFAULT NULL,        -- NULL = unlimited
    use_count INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ DEFAULT NULL,  -- NULL = never expires
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Projects: personal (org_id NULL) or organization-scoped
CREATE TABLE cloud_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#3b82f6',
    hourly_rate NUMERIC(10,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
    -- Bill time spent supervising an AI agent (part of session duration)
    bill_supervising BOOLEAN NOT NULL DEFAULT true,
    scope TEXT NOT NULL DEFAULT 'organization' CHECK (scope IN ('personal', 'organization')),
    is_active BOOLEAN DEFAULT true,
    archived BOOLEAN DEFAULT false,
    manager_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member' CHECK (role IN ('manager', 'member')),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

-- Recorded sessions. duration = active seconds (pauses excluded), written by
-- the app; end_time = wall-clock end. supervising_seconds is the part of
-- duration spent without input while an AI agent was working, and
-- supervising_spans its [start, end] ISO pairs (for the timeline).
CREATE TABLE time_tracking_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    project_id UUID REFERENCES cloud_projects(id) ON DELETE SET NULL,
    title TEXT,
    description TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration INTEGER,
    is_billable BOOLEAN NOT NULL DEFAULT false,
    supervising_seconds INTEGER NOT NULL DEFAULT 0 CHECK (supervising_seconds >= 0),
    supervising_spans JSONB NOT NULL DEFAULT '[]'
        CHECK (jsonb_typeof(supervising_spans) = 'array'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- One row per tracking sample (foreground app while recording)
CREATE TABLE usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    session_id UUID REFERENCES time_tracking_sessions(id) ON DELETE SET NULL,
    app_name TEXT NOT NULL,
    window_title TEXT,
    language TEXT,
    language_extension TEXT,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usage time per user, local calendar day, app and language. Upserted by
-- update_daily_usage_summary(); icon_url holds the app icon once per row.
CREATE TABLE daily_usage_summary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    -- language is NULL for browsers/dev tools; the upsert must still match
    CONSTRAINT daily_usage_summary_unique_day_app_lang
        UNIQUE NULLS NOT DISTINCT (user_id, date, app_name, language)
);

-- Which git repository belongs to which project, per user. repo_key is the
-- normalized origin remote ("github.com/owner/repo"), or "path:<root>" for a
-- repo without one. Detected locally from the focused editor/terminal.
CREATE TABLE project_repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
    repo_key TEXT NOT NULL CHECK (length(repo_key) BETWEEN 1 AND 512),
    repo_name TEXT NOT NULL CHECK (length(repo_name) BETWEEN 1 AND 200),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, repo_key)
);

-- One row per AI coding agent session (Claude Code, Codex), read from the
-- agent's local transcript. Metadata only: never prompt/response content or
-- file paths. project_id comes from the user's repo links.
CREATE TABLE agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    source TEXT NOT NULL CHECK (source IN ('claude-code', 'codex')),
    external_id TEXT NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
    repo_key TEXT CHECK (length(repo_key) <= 512),
    repo_name TEXT CHECK (length(repo_name) <= 200),
    project_id UUID REFERENCES cloud_projects(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    -- Time between transcript entries, gaps over 5 minutes left out
    active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
    prompts INTEGER NOT NULL DEFAULT 0 CHECK (prompts >= 0),
    tool_calls INTEGER NOT NULL DEFAULT 0 CHECK (tool_calls >= 0),
    files_changed INTEGER NOT NULL DEFAULT 0 CHECK (files_changed >= 0),
    lines_added INTEGER,
    lines_removed INTEGER,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_tokens BIGINT NOT NULL DEFAULT 0,
    cache_write_tokens BIGINT NOT NULL DEFAULT 0,
    -- { "<model>": { "input": n, "output": n, "cacheRead": n, "cacheWrite": n } }
    models JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(models) = 'object'),
    -- File edits per language: { "TypeScript": 12 }
    languages JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(languages) = 'object'),
    -- As reported by the agent (Claude Code); NULL when unknown
    cost_usd NUMERIC(12,4) CHECK (cost_usd IS NULL OR cost_usd >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (ended_at >= started_at),
    UNIQUE(user_id, source, external_id)
);

CREATE TABLE user_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#3b82f6',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

CREATE TABLE session_tags (
    session_id UUID NOT NULL REFERENCES time_tracking_sessions(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES user_tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (session_id, tag_id)
);

CREATE TABLE daily_work_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE TABLE scheduled_work_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE TABLE scheduled_session_tags (
    scheduled_session_id UUID NOT NULL REFERENCES scheduled_work_sessions(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES user_tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (scheduled_session_id, tag_id)
);

CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    theme TEXT DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
    accent_color JSONB DEFAULT '{"light": "#007acc", "dark": "#f0db4f"}',
    editor_colors JSONB DEFAULT '{}',   -- { "VS Code": "#007acc", ... }
    notification_settings JSONB DEFAULT '{"daily_goals": true, "scheduled_sessions": true}',
    idle_timeout_seconds INTEGER DEFAULT 300,
    tracking_interval_seconds INTEGER DEFAULT 10,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- =====================================================
-- 2. FUNCTIONS
-- =====================================================

-- ── Generic triggers ────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- org_id on activity rows always comes from the user's profile at insert
-- time and never changes afterwards, so clients can't attribute data to
-- another organization.
CREATE OR REPLACE FUNCTION set_org_id_from_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        NEW.org_id := OLD.org_id;
    ELSE
        NEW.org_id := (SELECT org_id FROM user_profiles WHERE id = NEW.user_id);
    END IF;
    RETURN NEW;
END;
$$;

-- duration is active time written by the app; only derive it from end_time
-- when it is missing.
CREATE OR REPLACE FUNCTION calculate_session_duration()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.duration IS NULL
       AND NEW.end_time IS NOT NULL
       AND NEW.start_time IS NOT NULL THEN
        NEW.duration := EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time))::INTEGER;
    END IF;
    RETURN NEW;
END;
$$;

-- ── Role & permission helpers ───────────────────────
-- SECURITY DEFINER so RLS policies can call them without recursing into
-- user_profiles' own policies.

CREATE OR REPLACE FUNCTION get_current_user_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT org_id FROM user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_user_admin_or_manager()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(get_current_user_role() IN ('admin', 'manager'), false);
$$;

CREATE OR REPLACE FUNCTION is_user_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(get_current_user_role() = 'admin', false);
$$;

-- True if target_user_id is the caller or in the caller's organization
CREATE OR REPLACE FUNCTION is_self_or_same_org(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT target_user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM user_profiles
            WHERE id = target_user_id
              AND org_id IS NOT NULL
              AND org_id = get_current_user_org_id()
        );
$$;

-- ── Users & profiles ────────────────────────────────

-- On signup: create a personal organization, the profile (admin of that
-- org) and default preferences. Usernames are unique, so a taken one gets a
-- short suffix instead of failing the signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_org_id UUID;
    base_name TEXT;
    candidate TEXT;
BEGIN
    base_name := COALESCE(
        NULLIF(trim(NEW.raw_user_meta_data->>'username'), ''),
        split_part(NEW.email, '@', 1),
        'user'
    );
    candidate := base_name;
    WHILE EXISTS (SELECT 1 FROM user_profiles WHERE username = candidate) LOOP
        candidate := base_name || '_' || substr(md5(random()::text), 1, 4);
    END LOOP;

    INSERT INTO organizations (name)
    VALUES (candidate || '''s Organization')
    RETURNING id INTO new_org_id;

    INSERT INTO user_profiles (id, username, email, org_id, role)
    VALUES (NEW.id, candidate, NEW.email, new_org_id, 'admin');

    INSERT INTO user_preferences (user_id)
    VALUES (NEW.id);

    RETURN NEW;
END;
$$;

-- Rules for profile updates made through the API (role "authenticated").
-- SECURITY DEFINER functions run as their owner and are exempt; they enforce
-- their own checks.
--   Self:   may edit username/avatar/email and may leave the organization
--           (org_id → NULL, role → employee). Never joins an org or changes
--           role directly — use an invite code or join request.
--   Others: only admins of the same org reach here (RLS). They may change a
--           non-admin member's role, nothing else (removal is
--           remove_org_member()).
CREATE OR REPLACE FUNCTION guard_user_profile_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF current_user NOT IN ('authenticated', 'anon') THEN
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Profile id cannot change';
    END IF;

    IF NEW.id = auth.uid() THEN
        IF NEW.org_id IS DISTINCT FROM OLD.org_id AND NEW.org_id IS NOT NULL THEN
            RAISE EXCEPTION 'Join organizations with an invite code or a join request';
        END IF;
        IF NEW.role IS DISTINCT FROM OLD.role
           AND NOT (NEW.org_id IS NULL AND NEW.role = 'employee') THEN
            RAISE EXCEPTION 'You cannot change your own role';
        END IF;
    ELSE
        IF OLD.role = 'admin' THEN
            RAISE EXCEPTION 'Admins cannot modify other admins';
        END IF;
        IF NEW.org_id IS DISTINCT FROM OLD.org_id AND NEW.org_id IS NOT NULL THEN
            RAISE EXCEPTION 'Members can be removed from the organization, not moved';
        END IF;
        IF NEW.username IS DISTINCT FROM OLD.username
           OR NEW.email IS DISTINCT FROM OLD.email
           OR NEW.avatar IS DISTINCT FROM OLD.avatar THEN
            RAISE EXCEPTION 'Admins can only change a member''s role or membership';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Profile lookup that bypasses RLS — only for yourself or your org's members
CREATE OR REPLACE FUNCTION public.get_user_profile_by_id(p_user_id UUID)
RETURNS SETOF user_profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT * FROM user_profiles
    WHERE id = p_user_id
      AND is_self_or_same_org(p_user_id);
$$;

-- A user's organization — only for yourself or your org's members
CREATE OR REPLACE FUNCTION public.get_organization_by_user_id(p_user_id UUID)
RETURNS SETOF organizations
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT o.*
    FROM organizations o
    JOIN user_profiles up ON up.org_id = o.id
    WHERE up.id = p_user_id
      AND is_self_or_same_org(p_user_id);
$$;

-- Members of an organization — only your own
CREATE OR REPLACE FUNCTION public.get_organization_members_by_org_id(p_org_id UUID)
RETURNS SETOF user_profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT * FROM user_profiles
    WHERE org_id = p_org_id
      AND p_org_id = get_current_user_org_id();
$$;

-- ── Organizations ───────────────────────────────────

-- Create a personal organization for the caller and make them its admin.
-- user_id is kept for API compatibility and must be the caller.
CREATE OR REPLACE FUNCTION public.create_personal_organization(user_id UUID, org_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_org_id UUID;
BEGIN
    IF user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'You can only create an organization for yourself';
    END IF;

    INSERT INTO organizations (name)
    VALUES (org_name)
    RETURNING id INTO new_org_id;

    UPDATE user_profiles
    SET org_id = new_org_id,
        role = 'admin'
    WHERE id = auth.uid();

    RETURN new_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION create_team_organization(org_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_org_id UUID;
BEGIN
    IF NOT is_user_admin_or_manager() THEN
        RAISE EXCEPTION 'Only admins and managers can create organizations';
    END IF;

    INSERT INTO organizations (name)
    VALUES (org_name)
    RETURNING id INTO new_org_id;

    RETURN new_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION approve_join_request(request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    req_user_id UUID;
    req_org_id UUID;
BEGIN
    IF NOT is_user_admin() THEN
        RAISE EXCEPTION 'Only admins can approve join requests';
    END IF;

    SELECT r.user_id, r.org_id INTO req_user_id, req_org_id
    FROM org_join_requests r
    WHERE r.id = request_id AND r.status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Join request not found or already processed';
    END IF;

    IF req_org_id IS DISTINCT FROM get_current_user_org_id() THEN
        RAISE EXCEPTION 'Cannot approve request for a different organization';
    END IF;

    UPDATE user_profiles
    SET org_id = req_org_id,
        role = 'employee'
    WHERE id = req_user_id;

    UPDATE org_join_requests
    SET status = 'approved',
        reviewed_at = NOW(),
        reviewed_by = auth.uid()
    WHERE id = request_id;
END;
$$;

CREATE OR REPLACE FUNCTION reject_join_request(request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT is_user_admin() THEN
        RAISE EXCEPTION 'Only admins can reject join requests';
    END IF;

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
$$;

-- Remove a member from the caller's organization (admins only, never
-- another admin). A function rather than a direct UPDATE: once org_id is
-- NULL the admin can no longer see the row, which RLS rejects.
CREATE OR REPLACE FUNCTION remove_org_member(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT;
    v_org_id UUID;
BEGIN
    IF NOT is_user_admin() THEN
        RAISE EXCEPTION 'Only admins can remove members';
    END IF;
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'Use "leave organization" to remove yourself';
    END IF;

    SELECT role, org_id INTO v_role, v_org_id
    FROM user_profiles WHERE id = p_user_id;

    IF NOT FOUND OR v_org_id IS DISTINCT FROM get_current_user_org_id() THEN
        RAISE EXCEPTION 'User is not a member of your organization';
    END IF;
    IF v_role = 'admin' THEN
        RAISE EXCEPTION 'Admins cannot remove other admins';
    END IF;

    UPDATE user_profiles
    SET org_id = NULL,
        role = 'employee'
    WHERE id = p_user_id;
END;
$$;

-- ── Invite codes ────────────────────────────────────

-- Random code XXXX-XXXX-XXXX from unambiguous characters (no I/O/0/1)
CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    code TEXT := '';
    i INTEGER;
BEGIN
    FOR i IN 1..12 LOOP
        code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
        IF i IN (4, 8) THEN
            code := code || '-';
        END IF;
    END LOOP;
    RETURN code;
END;
$$;

CREATE OR REPLACE FUNCTION create_invite_code(
    p_max_uses INTEGER DEFAULT NULL,
    p_expires_in_days INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    code TEXT,
    org_id UUID,
    max_uses INTEGER,
    expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT;
    v_org_id UUID;
    v_expires_at TIMESTAMPTZ;
    v_id UUID;
BEGIN
    IF NOT is_user_admin_or_manager() THEN
        RAISE EXCEPTION 'Only admins and managers can create invite codes';
    END IF;

    v_org_id := get_current_user_org_id();
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'You must be in an organization to create invite codes';
    END IF;

    IF p_expires_in_days IS NOT NULL THEN
        v_expires_at := NOW() + (p_expires_in_days || ' days')::INTERVAL;
    END IF;

    -- Retry on the (unlikely) collision with an existing code
    LOOP
        v_code := generate_invite_code();
        BEGIN
            INSERT INTO org_invite_codes (org_id, code, created_by, max_uses, expires_at)
            VALUES (v_org_id, v_code, auth.uid(), p_max_uses, v_expires_at)
            RETURNING org_invite_codes.id INTO v_id;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            CONTINUE;
        END;
    END LOOP;

    RETURN QUERY SELECT v_id, v_code, v_org_id, p_max_uses, v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION join_organization_with_code(p_code TEXT)
RETURNS TABLE (
    org_id UUID,
    org_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite RECORD;
    v_user_id UUID;
    v_current_org UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT ic.* INTO v_invite
    FROM org_invite_codes ic
    WHERE ic.code = upper(trim(p_code))
      AND ic.is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or inactive invite code';
    END IF;

    IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < NOW() THEN
        RAISE EXCEPTION 'This invite code has expired';
    END IF;

    IF v_invite.max_uses IS NOT NULL AND v_invite.use_count >= v_invite.max_uses THEN
        RAISE EXCEPTION 'This invite code has reached its maximum number of uses';
    END IF;

    SELECT up.org_id INTO v_current_org
    FROM user_profiles up
    WHERE up.id = v_user_id;

    IF v_current_org = v_invite.org_id THEN
        RAISE EXCEPTION 'You are already a member of this organization';
    END IF;

    UPDATE user_profiles
    SET org_id = v_invite.org_id,
        role = 'employee'
    WHERE id = v_user_id;

    UPDATE org_invite_codes
    SET use_count = use_count + 1
    WHERE id = v_invite.id;

    RETURN QUERY
    SELECT o.id, o.name
    FROM organizations o
    WHERE o.id = v_invite.org_id;
END;
$$;

CREATE OR REPLACE FUNCTION revoke_invite_code(p_code_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT is_user_admin_or_manager() THEN
        RAISE EXCEPTION 'Only admins and managers can revoke invite codes';
    END IF;

    UPDATE org_invite_codes
    SET is_active = false
    WHERE id = p_code_id
      AND org_id = get_current_user_org_id();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invite code not found or you do not have permission';
    END IF;
END;
$$;

-- ── Projects ────────────────────────────────────────

CREATE OR REPLACE FUNCTION archive_project(p_project_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Project manager, or admin/manager of the project's organization
    IF NOT EXISTS (
        SELECT 1 FROM cloud_projects
        WHERE id = p_project_id
          AND (
              manager_id = auth.uid()
              OR (org_id = get_current_user_org_id() AND is_user_admin_or_manager())
          )
    ) THEN
        RAISE EXCEPTION 'Project not found or you cannot archive it';
    END IF;

    UPDATE cloud_projects
    SET archived = true,
        is_active = false
    WHERE id = p_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION restore_project(p_project_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM cloud_projects
        WHERE id = p_project_id
          AND (
              manager_id = auth.uid()
              OR (org_id = get_current_user_org_id() AND is_user_admin_or_manager())
          )
    ) THEN
        RAISE EXCEPTION 'Project not found or you cannot restore it';
    END IF;

    UPDATE cloud_projects
    SET archived = false,
        is_active = true
    WHERE id = p_project_id;
END;
$$;

-- Runs as the caller, so RLS limits it to projects they can see
CREATE OR REPLACE FUNCTION get_project_stats(p_project_id UUID)
RETURNS TABLE (
    total_sessions INTEGER,
    total_time_seconds INTEGER,
    total_members INTEGER,
    last_activity TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(DISTINCT tts.id)::INTEGER,
        COALESCE(SUM(tts.duration), 0)::INTEGER,
        COUNT(DISTINCT pm.user_id)::INTEGER,
        MAX(tts.start_time)
    FROM cloud_projects cp
    LEFT JOIN time_tracking_sessions tts ON tts.project_id = cp.id
    LEFT JOIN project_members pm ON pm.project_id = cp.id
    WHERE cp.id = p_project_id
    GROUP BY cp.id;
END;
$$;

-- ── Usage summary ───────────────────────────────────

-- Add time to one (user, day, app, language) row. Runs as the caller, so RLS
-- restricts it to the caller's own rows. org_id is filled by trigger.
CREATE OR REPLACE FUNCTION update_daily_usage_summary(
    p_user_id UUID,
    p_date DATE,
    p_app_name TEXT,
    p_language TEXT,
    p_language_extension TEXT,
    p_icon_url TEXT,
    p_time_spent_seconds INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO daily_usage_summary (
        user_id, date, app_name, language, language_extension, icon_url, time_spent_seconds
    )
    VALUES (
        p_user_id, p_date, p_app_name, p_language, p_language_extension, p_icon_url, p_time_spent_seconds
    )
    ON CONFLICT (user_id, date, app_name, language)
    DO UPDATE SET
        time_spent_seconds = daily_usage_summary.time_spent_seconds + EXCLUDED.time_spent_seconds,
        language_extension = COALESCE(EXCLUDED.language_extension, daily_usage_summary.language_extension),
        icon_url = COALESCE(EXCLUDED.icon_url, daily_usage_summary.icon_url);
END;
$$;

-- ── Team analytics (admins/managers of the org) ─────

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
        COALESCE(SUM(tts.duration)::NUMERIC / 3600, 0),
        COUNT(DISTINCT tts.id)::INTEGER,
        COUNT(DISTINCT tts.user_id)::INTEGER
    FROM time_tracking_sessions tts
    WHERE tts.org_id = p_org_id
      AND tts.start_time::DATE BETWEEN p_start_date AND p_end_date
      AND (NOT p_billable_only OR tts.is_billable);
END;
$$;

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
        COALESCE(SUM(tts.duration)::NUMERIC / 3600, 0) AS total_hours,
        COUNT(DISTINCT tts.id)::INTEGER,
        COUNT(DISTINCT tts.user_id)::INTEGER
    FROM cloud_projects cp
    JOIN time_tracking_sessions tts ON tts.project_id = cp.id
    WHERE cp.org_id = p_org_id
      AND tts.start_time::DATE BETWEEN p_start_date AND p_end_date
      AND (p_project_ids IS NULL OR cp.id = ANY(p_project_ids))
      AND (NOT p_billable_only OR tts.is_billable)
    GROUP BY cp.id, cp.name
    ORDER BY total_hours DESC
    LIMIT p_limit;
END;
$$;

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
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_hours NUMERIC;
BEGIN
    IF NOT (is_user_admin_or_manager() AND get_current_user_org_id() = p_org_id) THEN
        RAISE EXCEPTION 'Only admins and managers can view organization analytics';
    END IF;

    SELECT COALESCE(SUM(dus.time_spent_seconds)::NUMERIC / 3600, 0)
    INTO v_total_hours
    FROM daily_usage_summary dus
    WHERE dus.org_id = p_org_id
      AND dus.date BETWEEN p_start_date AND p_end_date
      AND (p_member_ids IS NULL OR dus.user_id = ANY(p_member_ids));

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
$$;

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
        COALESCE(tl.language, 'None')
    FROM member_sessions ms
    JOIN user_profiles up ON up.id = ms.user_id
    LEFT JOIN top_language_per_member tl ON tl.user_id = ms.user_id AND tl.rn = 1
    ORDER BY ms.total_hours DESC;
END;
$$;


-- =====================================================
-- 3. TRIGGERS
-- =====================================================

-- New auth user → profile, personal org, preferences
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER guard_user_profile_change
BEFORE UPDATE ON user_profiles
FOR EACH ROW EXECUTE FUNCTION guard_user_profile_change();

-- Server-controlled org attribution
CREATE TRIGGER set_org_id_time_tracking_sessions
BEFORE INSERT OR UPDATE ON time_tracking_sessions
FOR EACH ROW EXECUTE FUNCTION set_org_id_from_user();

CREATE TRIGGER set_org_id_usage_logs
BEFORE INSERT OR UPDATE ON usage_logs
FOR EACH ROW EXECUTE FUNCTION set_org_id_from_user();

CREATE TRIGGER set_org_id_daily_usage_summary
BEFORE INSERT OR UPDATE ON daily_usage_summary
FOR EACH ROW EXECUTE FUNCTION set_org_id_from_user();

CREATE TRIGGER set_org_id_agent_sessions
BEFORE INSERT OR UPDATE ON agent_sessions
FOR EACH ROW EXECUTE FUNCTION set_org_id_from_user();

CREATE TRIGGER calculate_session_duration
BEFORE INSERT OR UPDATE ON time_tracking_sessions
FOR EACH ROW EXECUTE FUNCTION calculate_session_duration();

-- updated_at
CREATE TRIGGER set_timestamp_organizations BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_user_profiles BEFORE UPDATE ON user_profiles
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_org_join_requests BEFORE UPDATE ON org_join_requests
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_org_invite_codes BEFORE UPDATE ON org_invite_codes
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_cloud_projects BEFORE UPDATE ON cloud_projects
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_time_tracking_sessions BEFORE UPDATE ON time_tracking_sessions
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_daily_usage_summary BEFORE UPDATE ON daily_usage_summary
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_project_repositories BEFORE UPDATE ON project_repositories
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_agent_sessions BEFORE UPDATE ON agent_sessions
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_user_tags BEFORE UPDATE ON user_tags
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_daily_work_goals BEFORE UPDATE ON daily_work_goals
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_scheduled_work_sessions BEFORE UPDATE ON scheduled_work_sessions
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_user_preferences BEFORE UPDATE ON user_preferences
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();


-- =====================================================
-- 4. ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_usage_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_work_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_session_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- ── Organizations ── (created only by SECURITY DEFINER functions)

CREATE POLICY "Users can view their own organization"
ON organizations FOR SELECT
USING (id = get_current_user_org_id());

CREATE POLICY "Users can view organizations they requested to join"
ON organizations FOR SELECT
USING (id IN (SELECT org_id FROM org_join_requests WHERE user_id = auth.uid()));

CREATE POLICY "Admins can update their organization"
ON organizations FOR UPDATE
USING (id = get_current_user_org_id() AND is_user_admin());

-- ── User profiles ── (created only by handle_new_user; updates also pass
--    through guard_user_profile_change)

CREATE POLICY "Users can view their own profile"
ON user_profiles FOR SELECT
USING (id = auth.uid());

CREATE POLICY "Users can view profiles in their organization"
ON user_profiles FOR SELECT
USING (org_id IS NOT NULL AND org_id = get_current_user_org_id());

CREATE POLICY "Users can update their own profile"
ON user_profiles FOR UPDATE
USING (id = auth.uid());

-- Role changes. Removing a member goes through remove_org_member().
CREATE POLICY "Admins can update members of their org"
ON user_profiles FOR UPDATE
USING (org_id = get_current_user_org_id() AND is_user_admin())
WITH CHECK (org_id = get_current_user_org_id());

-- ── Join requests ──

CREATE POLICY "Users can view their own join requests"
ON org_join_requests FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Admins can view requests for their org"
ON org_join_requests FOR SELECT
USING (org_id = get_current_user_org_id() AND is_user_admin());

CREATE POLICY "Users can create join requests"
ON org_join_requests FOR INSERT
WITH CHECK (user_id = auth.uid() AND status = 'pending');

CREATE POLICY "Users can cancel their pending requests"
ON org_join_requests FOR DELETE
USING (user_id = auth.uid() AND status = 'pending');

-- ── Invite codes ── (created/used through the functions above)

CREATE POLICY "Admins/managers can view invite codes for their org"
ON org_invite_codes FOR SELECT
USING (org_id = get_current_user_org_id() AND is_user_admin_or_manager());

CREATE POLICY "Admins/managers can update invite codes for their org"
ON org_invite_codes FOR UPDATE
USING (org_id = get_current_user_org_id() AND is_user_admin_or_manager())
WITH CHECK (org_id = get_current_user_org_id());

CREATE POLICY "Admins/managers can delete invite codes for their org"
ON org_invite_codes FOR DELETE
USING (org_id = get_current_user_org_id() AND is_user_admin_or_manager());

-- ── Projects ──

CREATE POLICY "Users can view their own personal projects"
ON cloud_projects FOR SELECT
USING (scope = 'personal' AND manager_id = auth.uid());

CREATE POLICY "Users can view their org's projects"
ON cloud_projects FOR SELECT
USING (scope = 'organization' AND org_id = get_current_user_org_id());

CREATE POLICY "Users can create personal projects"
ON cloud_projects FOR INSERT
WITH CHECK (scope = 'personal' AND org_id IS NULL AND manager_id = auth.uid());

CREATE POLICY "Admins/managers can create org projects"
ON cloud_projects FOR INSERT
WITH CHECK (
    scope = 'organization'
    AND org_id = get_current_user_org_id()
    AND is_user_admin_or_manager()
);

-- Managers may hand the project to someone else, but not move it to
-- another organization
CREATE POLICY "Project managers can update their projects"
ON cloud_projects FOR UPDATE
USING (manager_id = auth.uid())
WITH CHECK (
    (scope = 'personal' AND org_id IS NULL)
    OR (scope = 'organization' AND org_id = get_current_user_org_id())
);

CREATE POLICY "Admins can update org projects"
ON cloud_projects FOR UPDATE
USING (scope = 'organization' AND org_id = get_current_user_org_id() AND is_user_admin())
WITH CHECK (scope = 'organization' AND org_id = get_current_user_org_id());

CREATE POLICY "Project managers can delete their projects"
ON cloud_projects FOR DELETE
USING (manager_id = auth.uid());

-- ── Project members ──

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
USING (project_id IN (SELECT id FROM cloud_projects WHERE manager_id = auth.uid()));

-- ── Repository links ── (own rows; only to projects the caller can see —
--    the subquery runs under cloud_projects' own policies)

CREATE POLICY "Users can manage their own repository links"
ON project_repositories FOR ALL
USING (user_id = auth.uid())
WITH CHECK (
    user_id = auth.uid()
    AND project_id IN (SELECT id FROM cloud_projects)
);

-- ── Agent sessions ── (own rows; a project only if the caller can see it)

CREATE POLICY "Users can manage their own agent sessions"
ON agent_sessions FOR ALL
USING (user_id = auth.uid())
WITH CHECK (
    user_id = auth.uid()
    AND (project_id IS NULL OR project_id IN (SELECT id FROM cloud_projects))
);

CREATE POLICY "Admins/managers can view org agent sessions"
ON agent_sessions FOR SELECT
USING (org_id = get_current_user_org_id() AND is_user_admin_or_manager());

-- ── Sessions ──

CREATE POLICY "Users can view their own sessions"
ON time_tracking_sessions FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Admins/managers can view org sessions"
ON time_tracking_sessions FOR SELECT
USING (org_id = get_current_user_org_id() AND is_user_admin_or_manager());

CREATE POLICY "Users can insert their own sessions"
ON time_tracking_sessions FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own sessions"
ON time_tracking_sessions FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own sessions"
ON time_tracking_sessions FOR DELETE
USING (user_id = auth.uid());

-- ── Usage logs ──

CREATE POLICY "Users can view their own usage logs"
ON usage_logs FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Admins/managers can view org usage logs"
ON usage_logs FOR SELECT
USING (org_id = get_current_user_org_id() AND is_user_admin_or_manager());

CREATE POLICY "Users can insert their own usage logs"
ON usage_logs FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own usage logs"
ON usage_logs FOR DELETE
USING (user_id = auth.uid());

-- ── Daily usage summary ──

CREATE POLICY "Users can manage their own usage summary"
ON daily_usage_summary FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins/managers can view org usage summary"
ON daily_usage_summary FOR SELECT
USING (org_id = get_current_user_org_id() AND is_user_admin_or_manager());

-- ── Tags ──

CREATE POLICY "Users can manage their own tags"
ON user_tags FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can manage their session tags"
ON session_tags FOR ALL
USING (
    session_id IN (SELECT id FROM time_tracking_sessions WHERE user_id = auth.uid())
    AND tag_id IN (SELECT id FROM user_tags WHERE user_id = auth.uid())
);

-- ── Goals ──

CREATE POLICY "Users can manage their own goals"
ON daily_work_goals FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view team goals"
ON daily_work_goals FOR SELECT
USING (
    is_user_admin()
    AND user_id IN (SELECT id FROM user_profiles WHERE org_id = get_current_user_org_id())
);

-- ── Scheduled sessions ──

CREATE POLICY "Users can manage their own scheduled sessions"
ON scheduled_work_sessions FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can manage their scheduled session tags"
ON scheduled_session_tags FOR ALL
USING (
    scheduled_session_id IN (SELECT id FROM scheduled_work_sessions WHERE user_id = auth.uid())
    AND tag_id IN (SELECT id FROM user_tags WHERE user_id = auth.uid())
);

-- ── Preferences ──

CREATE POLICY "Users can manage their own preferences"
ON user_preferences FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());


-- =====================================================
-- 5. INDEXES
-- =====================================================
-- (UNIQUE constraints and primary keys already have their own indexes.)

CREATE INDEX idx_user_profiles_org_id ON user_profiles(org_id);

CREATE INDEX idx_org_join_requests_org_id ON org_join_requests(org_id);
CREATE INDEX idx_org_join_requests_status ON org_join_requests(status);

CREATE INDEX idx_org_invite_codes_org_id ON org_invite_codes(org_id);

CREATE INDEX idx_cloud_projects_org_id ON cloud_projects(org_id);
CREATE INDEX idx_cloud_projects_manager_id ON cloud_projects(manager_id);
CREATE INDEX idx_project_members_user_id ON project_members(user_id);
CREATE INDEX idx_project_repositories_project_id ON project_repositories(project_id);
CREATE INDEX idx_agent_sessions_user_started ON agent_sessions(user_id, started_at DESC);
CREATE INDEX idx_agent_sessions_project ON agent_sessions(project_id);
CREATE INDEX idx_agent_sessions_org_started ON agent_sessions(org_id, started_at);

CREATE INDEX idx_sessions_user_start ON time_tracking_sessions(user_id, start_time DESC);
CREATE INDEX idx_sessions_org_start ON time_tracking_sessions(org_id, start_time);
CREATE INDEX idx_sessions_project_id ON time_tracking_sessions(project_id);

CREATE INDEX idx_usage_logs_user_timestamp ON usage_logs(user_id, timestamp DESC);
CREATE INDEX idx_usage_logs_org_id ON usage_logs(org_id);

CREATE INDEX idx_daily_summary_org_date ON daily_usage_summary(org_id, date);

CREATE INDEX idx_session_tags_tag_id ON session_tags(tag_id);

CREATE INDEX idx_scheduled_sessions_user_datetime ON scheduled_work_sessions(user_id, scheduled_datetime);
CREATE INDEX idx_scheduled_sessions_actual ON scheduled_work_sessions(actual_session_id);

-- =====================================================
-- DONE
-- =====================================================
