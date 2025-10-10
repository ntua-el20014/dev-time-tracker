-- Create missing user profiles and organizations for ALL users
-- This script finds all users in auth.users who don't have a user_profile
-- and creates their profile + personal organization

-- Step 1: Check which users are missing profiles
SELECT 
  u.id,
  u.email,
  u.created_at,
  CASE WHEN up.id IS NULL THEN 'Missing Profile' ELSE 'Has Profile' END as status
FROM auth.users u
LEFT JOIN user_profiles up ON up.id = u.id
ORDER BY u.created_at DESC;

-- Step 2: Create profiles and organizations for ALL users without profiles
DO $$
DECLARE
  user_record RECORD;
  v_username TEXT;
  v_org_id UUID;
  v_count INTEGER := 0;
BEGIN
  -- Loop through all users without profiles
  FOR user_record IN 
    SELECT u.id, u.email, u.raw_user_meta_data
    FROM auth.users u
    LEFT JOIN user_profiles up ON up.id = u.id
    WHERE up.id IS NULL
  LOOP
    -- Extract username from metadata or email
    v_username := COALESCE(
      user_record.raw_user_meta_data->>'username',
      user_record.raw_user_meta_data->>'user_name',
      user_record.raw_user_meta_data->>'name',
      split_part(user_record.email, '@', 1)
    );
    
    -- Create personal organization
    INSERT INTO organizations (name)
    VALUES (v_username || '''s Organization')
    RETURNING id INTO v_org_id;
    
    -- Create user profile
    INSERT INTO user_profiles (id, username, email, org_id, role)
    VALUES (
      user_record.id,
      v_username,
      user_record.email,
      v_org_id,
      'admin'  -- User is admin of their personal organization
    );
    
    v_count := v_count + 1;
    RAISE NOTICE 'Created profile for: % (%) - Org ID: %', v_username, user_record.email, v_org_id;
  END LOOP;
  
  RAISE NOTICE 'Total profiles created: %', v_count;
END $$;

-- Step 3: Verify all users now have profiles
SELECT 
  u.id,
  u.email,
  up.username,
  up.org_id,
  up.role,
  o.name as org_name,
  CASE WHEN up.id IS NULL THEN 'ERROR: Still Missing' ELSE 'OK' END as status
FROM auth.users u
LEFT JOIN user_profiles up ON up.id = u.id
LEFT JOIN organizations o ON o.id = up.org_id
ORDER BY u.created_at DESC;
