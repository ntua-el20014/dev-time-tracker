-- Add SECURITY DEFINER functions to lookup user data by ID
-- These functions bypass RLS and can be called from the main process

-- Function to get user profile by ID
CREATE OR REPLACE FUNCTION public.get_user_profile_by_id(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  username TEXT,
  email TEXT,
  avatar TEXT,
  role TEXT,
  org_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    up.id,
    up.username,
    up.email,
    up.avatar,
    up.role,
    up.org_id,
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  WHERE up.id = p_user_id;
END;
$$;

-- Function to get organization members by org ID
CREATE OR REPLACE FUNCTION public.get_organization_members_by_org_id(p_org_id UUID)
RETURNS TABLE (
  id UUID,
  username TEXT,
  email TEXT,
  avatar TEXT,
  role TEXT,
  org_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    up.id,
    up.username,
    up.email,
    up.avatar,
    up.role,
    up.org_id,
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  WHERE up.org_id = p_org_id
  ORDER BY up.role ASC, up.username ASC;
END;
$$;

-- Function to get organization by user ID
CREATE OR REPLACE FUNCTION public.get_organization_by_user_id(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id,
    o.name,
    o.created_at,
    o.updated_at
  FROM public.organizations o
  INNER JOIN public.user_profiles up ON up.org_id = o.id
  WHERE up.id = p_user_id;
END;
$$;
