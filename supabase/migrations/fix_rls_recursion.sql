-- Fix for infinite recursion in user_profiles RLS policy
-- FINAL FIX: Use SECURITY DEFINER functions that completely bypass RLS

-- Step 1: Create SECURITY DEFINER functions that bypass ALL policies
CREATE OR REPLACE FUNCTION public.get_current_user_org_id()
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

CREATE OR REPLACE FUNCTION public.get_current_user_role()
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

-- Step 2: DISABLE RLS temporarily
ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;

-- Step 3: Drop ALL existing policies (including ones from 001_organization_system.sql)
DROP POLICY IF EXISTS "Users can view their own or org profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can view profiles in their organization" ON user_profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can view profiles in their org via join" ON user_profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can view org profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can view profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can view profiles in their org (role-based)" ON user_profiles;

-- Step 4: Re-enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Step 5: Create NEW policies using the security definer function
CREATE POLICY "Users can insert their own profile"
ON user_profiles FOR INSERT
WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update their own profile"
ON user_profiles FOR UPDATE
USING (id = auth.uid());

CREATE POLICY "Users can view profiles"
ON user_profiles FOR SELECT
USING (
  id = auth.uid() 
  OR org_id = public.get_current_user_org_id()  -- Uses function that bypasses RLS!
);

-- Step 6: Fix organizations policies using the function
DROP POLICY IF EXISTS "Users can view their own organization" ON organizations;
CREATE POLICY "Users can view their own organization"
ON organizations FOR SELECT
USING (id = public.get_current_user_org_id());

DROP POLICY IF EXISTS "Admins can create organizations" ON organizations;
CREATE POLICY "Admins can create organizations"
ON organizations FOR INSERT
WITH CHECK (
  public.get_current_user_role() = 'admin'
);

DROP POLICY IF EXISTS "Admins can update their organization" ON organizations;
CREATE POLICY "Admins can update their organization"
ON organizations FOR UPDATE
USING (
  id = public.get_current_user_org_id()
  AND public.get_current_user_role() = 'admin'
);

-- Step 7: Fix projects policies using the function
DROP POLICY IF EXISTS "Users can view projects in their organization" ON projects;
CREATE POLICY "Users can view projects in their organization"
ON projects FOR SELECT
USING (org_id = public.get_current_user_org_id());

DROP POLICY IF EXISTS "Managers can create projects" ON projects;
CREATE POLICY "Managers can create projects"
ON projects FOR INSERT
WITH CHECK (
  public.get_current_user_role() IN ('manager', 'admin')
  AND org_id = public.get_current_user_org_id()  -- Ensure org_id matches user's org
);

DROP POLICY IF EXISTS "Project managers can update their projects" ON projects;
CREATE POLICY "Project managers can update their projects"
ON projects FOR UPDATE
USING (manager_id = auth.uid());
