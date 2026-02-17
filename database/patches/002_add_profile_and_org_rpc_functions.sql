-- =====================================================
-- PATCH 002: Add RPC functions for user profile and org lookup
-- =====================================================
-- These SECURITY DEFINER functions bypass RLS so the app
-- can fetch the current user's profile and organization.
-- =====================================================

-- Function to get organization by user_id (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_organization_by_user_id(p_user_id UUID)
RETURNS SETOF organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT o.*
    FROM organizations o
    INNER JOIN user_profiles up ON up.org_id = o.id
    WHERE up.id = p_user_id;
END;
$$;

-- Function to get user profile by id (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_user_profile_by_id(p_user_id UUID)
RETURNS SETOF user_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM user_profiles
    WHERE id = p_user_id;
END;
$$;
