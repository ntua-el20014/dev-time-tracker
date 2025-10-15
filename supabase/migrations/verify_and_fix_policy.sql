-- Verify and fix the projects INSERT policy
-- Run this to see current policy and then fix it

-- First, let's see what policies exist
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'projects' AND cmd = 'INSERT';

-- Now drop and recreate with the correct policy
DROP POLICY IF EXISTS "Managers can create projects" ON projects;
DROP POLICY IF EXISTS "Admins and managers can create projects" ON projects;

-- Create the correct policy
CREATE POLICY "Managers can create projects"
ON projects FOR INSERT
WITH CHECK (
  public.get_current_user_role() IN ('manager', 'admin')
  AND org_id = public.get_current_user_org_id()
);

-- Verify it was created
SELECT schemaname, tablename, policyname, cmd, with_check
FROM pg_policies
WHERE tablename = 'projects' AND cmd = 'INSERT';
