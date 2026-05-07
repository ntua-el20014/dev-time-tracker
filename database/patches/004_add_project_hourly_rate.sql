-- 004: Add optional hourly rate to projects for billing support

ALTER TABLE cloud_projects
ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2)
CHECK (hourly_rate IS NULL OR hourly_rate >= 0);

-- Recreate create_project function to persist hourly_rate
-- Drop old signature to avoid overloaded/default-arg ambiguity
DROP FUNCTION IF EXISTS create_project(TEXT, TEXT, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION create_project(
	project_name TEXT,
	project_description TEXT DEFAULT NULL,
	project_color TEXT DEFAULT '#3b82f6',
	project_hourly_rate NUMERIC DEFAULT NULL,
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
	INSERT INTO cloud_projects (name, description, color, hourly_rate, scope, manager_id, org_id)
	VALUES (project_name, project_description, project_color, project_hourly_rate, project_scope, auth.uid(), target_org_id)
	RETURNING id INTO new_project_id;

	-- Add creator as manager in project_members
	INSERT INTO project_members (project_id, user_id, role)
	VALUES (new_project_id, auth.uid(), 'manager');

	RETURN new_project_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
