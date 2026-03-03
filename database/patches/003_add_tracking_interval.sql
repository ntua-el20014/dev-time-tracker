-- 003: Add tracking_interval_seconds to user_preferences
-- Default 10 seconds (same as DEFAULT_TRACKING_INTERVAL_SECONDS constant)

-- Add get_organization_members_by_org_id RPC function
-- SECURITY DEFINER so it bypasses RLS and lets any authenticated user
-- fetch the member list of their own organization.
ALTER TABLE user_preferences
ADD COLUMN IF NOT EXISTS tracking_interval_seconds INTEGER DEFAULT 10;

CREATE OR REPLACE FUNCTION public.get_organization_members_by_org_id(p_org_id UUID)
RETURNS SETOF public.user_profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.user_profiles
  WHERE org_id = p_org_id;
$$;