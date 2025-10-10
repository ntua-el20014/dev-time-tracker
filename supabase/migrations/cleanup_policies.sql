-- Cleanup script to remove ALL existing policies before running fix_rls_recursion.sql
-- Run this FIRST, then run fix_rls_recursion.sql

-- Drop ALL user_profiles policies
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

-- Drop ALL organizations policies
DROP POLICY IF EXISTS "Users can view their own organization" ON organizations;
DROP POLICY IF EXISTS "Admins can create organizations" ON organizations;
DROP POLICY IF EXISTS "Admins can update their organization" ON organizations;

-- Drop ALL projects policies
DROP POLICY IF EXISTS "Users can view projects in their organization" ON projects;
DROP POLICY IF EXISTS "Users can view projects in their org" ON projects;
DROP POLICY IF EXISTS "Managers can create projects" ON projects;
DROP POLICY IF EXISTS "Admins and managers can create projects" ON projects;
DROP POLICY IF EXISTS "Project managers can update their projects" ON projects;
DROP POLICY IF EXISTS "Admins and managers can update projects in their org" ON projects;
DROP POLICY IF EXISTS "Admins can delete projects in their org" ON projects;
