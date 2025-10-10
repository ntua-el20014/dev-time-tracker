-- =====================================================
-- TEST SCRIPT FOR ORGANIZATION SYSTEM MIGRATION
-- =====================================================
-- This script tests all the new functionality added in Sprint 1
-- Run this AFTER applying 001_organization_system.sql
-- =====================================================

-- =====================================================
-- 1. TEST HELPER FUNCTIONS
-- =====================================================

-- Test: Check if helper functions exist
SELECT 'Testing helper functions...' as test_phase;

-- Should return function definitions
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN (
  'is_user_admin',
  'is_user_admin_or_manager',
  'get_user_org_id',
  'same_org',
  'approve_join_request',
  'reject_join_request',
  'create_team_organization'
);

-- =====================================================
-- 2. TEST ORG JOIN REQUESTS TABLE
-- =====================================================

SELECT 'Testing org_join_requests table...' as test_phase;

-- Should return table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'org_join_requests'
ORDER BY ordinal_position;

-- =====================================================
-- 3. TEST RLS POLICIES
-- =====================================================

SELECT 'Testing RLS policies...' as test_phase;

-- Check sessions policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'sessions';

-- Check projects policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'projects';

-- Check user_profiles policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'user_profiles';

-- Check org_join_requests policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'org_join_requests';

-- =====================================================
-- 4. TEST AUTO-CREATE ORG ON SIGNUP
-- =====================================================

SELECT 'Testing auto-create organization trigger...' as test_phase;

-- Check if trigger exists
SELECT trigger_name, event_manipulation, event_object_table, action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
AND trigger_name = 'on_auth_user_created';

-- =====================================================
-- 5. VERIFY EXISTING DATA INTEGRITY
-- =====================================================

SELECT 'Verifying existing data...' as test_phase;

-- Count organizations
SELECT 'Total organizations:' as metric, COUNT(*) as count FROM organizations;

-- Count users
SELECT 'Total users:' as metric, COUNT(*) as count FROM user_profiles;

-- Count users with orgs
SELECT 'Users with orgs:' as metric, COUNT(*) as count 
FROM user_profiles WHERE org_id IS NOT NULL;

-- Count users by role
SELECT 'Users by role:' as metric, role, COUNT(*) as count 
FROM user_profiles 
GROUP BY role;

-- =====================================================
-- 6. SIMULATE ORG WORKFLOW (Read-Only Tests)
-- =====================================================

SELECT 'Testing organization queries...' as test_phase;

-- Get all organizations
SELECT id, name, created_at 
FROM organizations 
ORDER BY created_at DESC 
LIMIT 5;

-- Get organization with member count
SELECT 
  o.id,
  o.name,
  COUNT(up.id) as member_count,
  COUNT(CASE WHEN up.role = 'admin' THEN 1 END) as admin_count,
  COUNT(CASE WHEN up.role = 'manager' THEN 1 END) as manager_count,
  COUNT(CASE WHEN up.role = 'employee' THEN 1 END) as employee_count
FROM organizations o
LEFT JOIN user_profiles up ON up.org_id = o.id
GROUP BY o.id, o.name
ORDER BY member_count DESC
LIMIT 10;

-- =====================================================
-- 7. CHECK INDEXES
-- =====================================================

SELECT 'Checking indexes...' as test_phase;

SELECT 
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('org_join_requests', 'user_profiles', 'sessions', 'projects')
ORDER BY tablename, indexname;

-- =====================================================
-- TEST COMPLETE
-- =====================================================

SELECT '✅ All tests complete!' as status;
SELECT 'Review the output above to verify:' as next_steps;
SELECT '1. All helper functions exist' as step;
SELECT '2. org_join_requests table is created' as step;
SELECT '3. RLS policies are updated' as step;
SELECT '4. Trigger is in place' as step;
SELECT '5. Existing data is intact' as step;
