-- =====================================================
-- SPRINT 1: Organization System - Database Foundation
-- =====================================================
-- This migration adds:
-- 1. Organization join requests table
-- 2. Helper functions for role checks
-- 3. Updated RLS policies for role-based access
-- 4. Auto-create personal organization on signup
-- =====================================================

-- =====================================================
-- 1. CREATE ORG JOIN REQUESTS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS org_join_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, org_id) -- User can only have one pending request per org
);

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON org_join_requests
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_org_join_requests_org_id ON org_join_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_org_join_requests_user_id ON org_join_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_org_join_requests_status ON org_join_requests(status);

-- =====================================================
-- 2. HELPER FUNCTIONS
-- =====================================================

-- Function to check if user is admin or manager in their org
CREATE OR REPLACE FUNCTION is_user_admin_or_manager()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user is admin in their org
CREATE OR REPLACE FUNCTION is_user_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's org_id
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT org_id FROM user_profiles
    WHERE id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if two users are in the same org
CREATE OR REPLACE FUNCTION same_org(target_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles up1
    JOIN user_profiles up2 ON up1.org_id = up2.org_id
    WHERE up1.id = auth.uid()
    AND up2.id = target_user_id
    AND up1.org_id IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 3. UPDATE RLS POLICIES FOR ROLE-BASED ACCESS
-- =====================================================

-- ================
-- USER PROFILES
-- ================
-- Drop old policies
DROP POLICY IF EXISTS "Users can view their own or org profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can view profiles in their organization" ON user_profiles;

-- New role-based policy for viewing profiles
CREATE POLICY "Users can view profiles in their org (role-based)"
ON user_profiles FOR SELECT
USING (
  id = auth.uid() -- Can always see own profile
  OR (
    -- Admins and managers can see all profiles in their org
    org_id IN (SELECT org_id FROM user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  )
  OR (
    -- Employees can only see profiles in their org (basic info)
    org_id IN (SELECT org_id FROM user_profiles WHERE id = auth.uid())
  )
);

-- ================
-- SESSIONS
-- ================
-- Drop old policies
DROP POLICY IF EXISTS "Users can view their own sessions" ON sessions;
DROP POLICY IF EXISTS "Users can manage their own sessions" ON sessions;

-- New role-based policies for sessions
CREATE POLICY "Users can view sessions (role-based)"
ON sessions FOR SELECT
USING (
  user_id = auth.uid() -- Can always see own sessions
  OR (
    -- Admins and managers can see all sessions in their org
    user_id IN (
      SELECT id FROM user_profiles
      WHERE org_id = (SELECT org_id FROM user_profiles WHERE id = auth.uid())
    )
    AND is_user_admin_or_manager()
  )
);

CREATE POLICY "Users can insert their own sessions"
ON sessions FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own sessions"
ON sessions FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own sessions"
ON sessions FOR DELETE
USING (user_id = auth.uid());

-- ================
-- PROJECTS
-- ================
-- Drop old policies
DROP POLICY IF EXISTS "Users can view projects in their organization" ON projects;
DROP POLICY IF EXISTS "Managers can create projects" ON projects;
DROP POLICY IF EXISTS "Project managers can update their projects" ON projects;

-- New role-based policies for projects
CREATE POLICY "Users can view projects in their org"
ON projects FOR SELECT
USING (
  org_id IN (SELECT org_id FROM user_profiles WHERE id = auth.uid())
);

CREATE POLICY "Admins and managers can create projects"
ON projects FOR INSERT
WITH CHECK (
  org_id = (SELECT org_id FROM user_profiles WHERE id = auth.uid())
  AND is_user_admin_or_manager()
);

CREATE POLICY "Admins and managers can update projects in their org"
ON projects FOR UPDATE
USING (
  org_id = (SELECT org_id FROM user_profiles WHERE id = auth.uid())
  AND is_user_admin_or_manager()
);

CREATE POLICY "Admins can delete projects in their org"
ON projects FOR DELETE
USING (
  org_id = (SELECT org_id FROM user_profiles WHERE id = auth.uid())
  AND is_user_admin()
);

-- ================
-- USAGE TRACKING
-- ================
-- Drop old policy
DROP POLICY IF EXISTS "Users can view and insert their own usage data" ON usage_tracking;

-- New role-based policies
CREATE POLICY "Users can view usage data (role-based)"
ON usage_tracking FOR SELECT
USING (
  user_id = auth.uid() -- Can always see own data
  OR (
    -- Admins and managers can see all org data
    user_id IN (
      SELECT id FROM user_profiles
      WHERE org_id = (SELECT org_id FROM user_profiles WHERE id = auth.uid())
    )
    AND is_user_admin_or_manager()
  )
);

CREATE POLICY "Users can insert their own usage data"
ON usage_tracking FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own usage data"
ON usage_tracking FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own usage data"
ON usage_tracking FOR DELETE
USING (user_id = auth.uid());

-- ================
-- USAGE SUMMARY
-- ================
-- Drop old policy
DROP POLICY IF EXISTS "Users can view and update their own usage summary" ON usage_summary;

-- New role-based policies
CREATE POLICY "Users can view usage summary (role-based)"
ON usage_summary FOR SELECT
USING (
  user_id = auth.uid() -- Can always see own summary
  OR (
    -- Admins and managers can see all org summaries
    user_id IN (
      SELECT id FROM user_profiles
      WHERE org_id = (SELECT org_id FROM user_profiles WHERE id = auth.uid())
    )
    AND is_user_admin_or_manager()
  )
);

CREATE POLICY "Users can manage their own usage summary"
ON usage_summary FOR ALL
USING (user_id = auth.uid());

-- ================
-- ORG JOIN REQUESTS
-- ================
ALTER TABLE org_join_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their own requests
CREATE POLICY "Users can view their own join requests"
ON org_join_requests FOR SELECT
USING (user_id = auth.uid());

-- Admins can view requests for their org
CREATE POLICY "Admins can view join requests for their org"
ON org_join_requests FOR SELECT
USING (
  org_id = (SELECT org_id FROM user_profiles WHERE id = auth.uid())
  AND is_user_admin()
);

-- Users can create join requests
CREATE POLICY "Users can create join requests"
ON org_join_requests FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Users can cancel their own pending requests
CREATE POLICY "Users can delete their own pending requests"
ON org_join_requests FOR DELETE
USING (user_id = auth.uid() AND status = 'pending');

-- Admins can update requests for their org (approve/reject)
CREATE POLICY "Admins can update join requests for their org"
ON org_join_requests FOR UPDATE
USING (
  org_id = (SELECT org_id FROM user_profiles WHERE id = auth.uid())
  AND is_user_admin()
);

-- =====================================================
-- 4. UPDATE AUTO-CREATE USER PROFILE TRIGGER
-- =====================================================

-- Replace the existing handle_new_user function to auto-create personal org
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
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure the trigger exists (it should already exist from schema.sql)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- 5. HELPER FUNCTIONS FOR ORG MANAGEMENT
-- =====================================================

-- Function to approve a join request
CREATE OR REPLACE FUNCTION approve_join_request(request_id UUID)
RETURNS VOID AS $$
DECLARE
  req_user_id UUID;
  req_org_id UUID;
BEGIN
  -- Check if the current user is admin of the org
  IF NOT is_user_admin() THEN
    RAISE EXCEPTION 'Only admins can approve join requests';
  END IF;
  
  -- Get request details
  SELECT user_id, org_id INTO req_user_id, req_org_id
  FROM org_join_requests
  WHERE id = request_id AND status = 'pending';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Join request not found or already processed';
  END IF;
  
  -- Verify the request is for the admin's org
  IF req_org_id != (SELECT org_id FROM user_profiles WHERE id = auth.uid()) THEN
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
  -- Check if the current user is admin of the org
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
    AND org_id = (SELECT org_id FROM user_profiles WHERE id = auth.uid());
    
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Join request not found or cannot be rejected';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create a new team organization (in addition to personal org)
CREATE OR REPLACE FUNCTION create_team_organization(org_name TEXT)
RETURNS UUID AS $$
DECLARE
  new_org_id UUID;
BEGIN
  -- Create the organization
  INSERT INTO organizations (name)
  VALUES (org_name)
  RETURNING id INTO new_org_id;
  
  -- The user who creates it becomes admin
  -- Note: This does NOT change their current org_id
  -- They can switch to this org later
  
  RETURN new_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- Summary of changes:
-- ✅ org_join_requests table created
-- ✅ Helper functions for role checks added
-- ✅ RLS policies updated for role-based access
-- ✅ Auto-create personal org on signup updated
-- ✅ Functions for approving/rejecting requests added
-- =====================================================
