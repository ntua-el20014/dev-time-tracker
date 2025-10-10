-- Check and fix user organization
-- This script will:
-- 1. Show all users and their org_id
-- 2. Create a personal organization for any user without one

-- Step 1: Check current state
SELECT 
  id,
  username,
  email,
  org_id,
  role
FROM user_profiles;

-- Step 2: Fix users without an organization
-- Run this if you see any users with NULL org_id
DO $$
DECLARE
  user_record RECORD;
  new_org_id UUID;
BEGIN
  FOR user_record IN 
    SELECT id, username, email 
    FROM user_profiles 
    WHERE org_id IS NULL
  LOOP
    -- Create a personal organization
    INSERT INTO organizations (name)
    VALUES (user_record.username || '''s Organization')
    RETURNING id INTO new_org_id;
    
    -- Update the user profile
    UPDATE user_profiles
    SET org_id = new_org_id,
        role = 'admin'
    WHERE id = user_record.id;
    
    RAISE NOTICE 'Created organization % for user %', new_org_id, user_record.username;
  END LOOP;
END $$;

-- Step 3: Verify all users now have an organization
SELECT 
  id,
  username,
  email,
  org_id,
  role
FROM user_profiles;
