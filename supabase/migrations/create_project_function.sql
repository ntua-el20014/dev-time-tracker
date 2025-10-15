-- Create a function to create projects that uses the caller's auth context
-- This function is called via RPC from the authenticated frontend

CREATE OR REPLACE FUNCTION create_cloud_project(
  p_name TEXT,
  p_description TEXT,
  p_color TEXT,
  p_org_id UUID,
  p_manager_id UUID,
  p_local_id TEXT DEFAULT NULL
)
RETURNS projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_role TEXT;
  v_user_org_id UUID;
  v_project projects;
BEGIN
  -- Get the caller's role and org_id
  SELECT role, org_id INTO v_user_role, v_user_org_id
  FROM user_profiles
  WHERE id = auth.uid();

  -- Check if user has permission
  IF v_user_role NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'Insufficient permissions to create projects';
  END IF;

  -- Check if org_id matches user's org
  IF v_user_org_id != p_org_id THEN
    RAISE EXCEPTION 'Cannot create project in a different organization';
  END IF;

  -- Create the project
  INSERT INTO projects (name, description, color, org_id, manager_id, local_id)
  VALUES (p_name, p_description, p_color, p_org_id, p_manager_id, p_local_id)
  RETURNING * INTO v_project;

  RETURN v_project;
END;
$$;
