-- Fix the RLS policy for creating projects
-- The policy needs to verify that the org_id being inserted matches the user's org_id

-- Drop the old policy
DROP POLICY IF EXISTS "Managers can create projects" ON projects;

-- Create the corrected policy
CREATE POLICY "Managers can create projects"
ON projects FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM user_profiles 
        WHERE id = auth.uid() 
        AND role IN ('manager', 'admin')
        AND org_id = projects.org_id  -- Ensure the project's org_id matches user's org_id
    )
);
