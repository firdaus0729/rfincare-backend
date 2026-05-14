-- =====================================================
-- FIX DUPLICATE DEMO USERS - IDEMPOTENT SOLUTION
-- Purpose: Properly handle existing demo users and recreate them
-- Issue: Previous migration didn't handle existing records properly
-- Solution: Use ON CONFLICT clauses and proper cleanup
-- =====================================================

-- 1. FORCE CLEANUP OF EXISTING DEMO USERS
-- =====================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- First, delete from user_profiles (child table)
  DELETE FROM public.user_profiles 
  WHERE email IN (
    'admin@rfincare.com',
    'employee@rfincare.com', 
    'agent@rfincare.com',
    'customer@rfincare.com'
  );
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % records from user_profiles', v_count;
  
  -- Then delete from auth.users (parent table)
  DELETE FROM auth.users 
  WHERE email IN (
    'admin@rfincare.com',
    'employee@rfincare.com',
    'agent@rfincare.com', 
    'customer@rfincare.com'
  );
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % records from auth.users', v_count;
  
  RAISE NOTICE 'Cleanup completed successfully';
END $$;

-- 2. CREATE DEMO USERS WITH PROPER IDEMPOTENCY
-- =====================================================

DO $$
DECLARE
  admin_uuid UUID;
  employee_uuid UUID;
  agent_uuid UUID;
  customer_uuid UUID;
  encrypted_pass TEXT;
BEGIN
  -- Generate new UUIDs for demo users
  admin_uuid := gen_random_uuid();
  employee_uuid := gen_random_uuid();
  agent_uuid := gen_random_uuid();
  customer_uuid := gen_random_uuid();
  
  RAISE NOTICE 'Creating demo users with UUIDs: Admin=%, Employee=%, Agent=%, Customer=%', 
    admin_uuid, employee_uuid, agent_uuid, customer_uuid;
  
  -- ============================================
  -- ADMIN USER
  -- ============================================
  encrypted_pass := crypt('Admin@2026', gen_salt('bf'));
  
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    recovery_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    admin_uuid,
    'authenticated',
    'authenticated',
    'admin@rfincare.com',
    encrypted_pass,
    NOW(),
    NOW(),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Admin User","role":"super_admin"}',
    NOW(),
    NOW(),
    '',
    '',
    '',
    ''
  )
  ON CONFLICT (id) DO NOTHING;
  
  INSERT INTO public.user_profiles (
    id,
    email,
    full_name,
    role,
    is_active,
    account_status,
    failed_login_attempts,
    created_at,
    updated_at
  ) VALUES (
    admin_uuid,
    'admin@rfincare.com',
    'Admin User',
    'super_admin',
    true,
    'active',
    0,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  
  RAISE NOTICE 'Admin user created: %', admin_uuid;
  
  -- ============================================
  -- EMPLOYEE USER
  -- ============================================
  encrypted_pass := crypt('Employee@2026', gen_salt('bf'));
  
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    recovery_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    employee_uuid,
    'authenticated',
    'authenticated',
    'employee@rfincare.com',
    encrypted_pass,
    NOW(),
    NOW(),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Employee User","role":"employee"}',
    NOW(),
    NOW(),
    '',
    '',
    '',
    ''
  )
  ON CONFLICT (id) DO NOTHING;
  
  INSERT INTO public.user_profiles (
    id,
    email,
    full_name,
    role,
    is_active,
    account_status,
    failed_login_attempts,
    created_at,
    updated_at
  ) VALUES (
    employee_uuid,
    'employee@rfincare.com',
    'Employee User',
    'employee',
    true,
    'active',
    0,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  
  RAISE NOTICE 'Employee user created: %', employee_uuid;
  
  -- ============================================
  -- AGENT USER
  -- ============================================
  encrypted_pass := crypt('Agent@2026', gen_salt('bf'));
  
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    recovery_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    agent_uuid,
    'authenticated',
    'authenticated',
    'agent@rfincare.com',
    encrypted_pass,
    NOW(),
    NOW(),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Agent User","role":"agent"}',
    NOW(),
    NOW(),
    '',
    '',
    '',
    ''
  )
  ON CONFLICT (id) DO NOTHING;
  
  INSERT INTO public.user_profiles (
    id,
    email,
    full_name,
    role,
    is_active,
    account_status,
    failed_login_attempts,
    created_at,
    updated_at
  ) VALUES (
    agent_uuid,
    'agent@rfincare.com',
    'Agent User',
    'agent',
    true,
    'active',
    0,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  
  RAISE NOTICE 'Agent user created: %', agent_uuid;
  
  -- ============================================
  -- CUSTOMER USER
  -- ============================================
  encrypted_pass := crypt('Customer@2026', gen_salt('bf'));
  
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    recovery_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    customer_uuid,
    'authenticated',
    'authenticated',
    'customer@rfincare.com',
    encrypted_pass,
    NOW(),
    NOW(),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Customer User","role":"customer"}',
    NOW(),
    NOW(),
    '',
    '',
    '',
    ''
  )
  ON CONFLICT (id) DO NOTHING;
  
  INSERT INTO public.user_profiles (
    id,
    email,
    full_name,
    role,
    is_active,
    account_status,
    failed_login_attempts,
    created_at,
    updated_at
  ) VALUES (
    customer_uuid,
    'customer@rfincare.com',
    'Customer User',
    'customer',
    true,
    'active',
    0,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  
  RAISE NOTICE 'Customer user created: %', customer_uuid;
  
  RAISE NOTICE 'All demo users created successfully';
END $$;

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$
DECLARE
  v_auth_count INTEGER;
  v_profile_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_auth_count
  FROM auth.users
  WHERE email IN (
    'admin@rfincare.com',
    'employee@rfincare.com',
    'agent@rfincare.com',
    'customer@rfincare.com'
  );
  
  SELECT COUNT(*) INTO v_profile_count
  FROM public.user_profiles
  WHERE email IN (
    'admin@rfincare.com',
    'employee@rfincare.com',
    'agent@rfincare.com',
    'customer@rfincare.com'
  );
  
  RAISE NOTICE 'Verification: % users in auth.users, % users in user_profiles', 
    v_auth_count, v_profile_count;
  
  IF v_auth_count = 4 AND v_profile_count = 4 THEN
    RAISE NOTICE 'SUCCESS: All demo users created correctly';
  ELSE
    RAISE WARNING 'ISSUE: Expected 4 users in each table, found % in auth.users and % in user_profiles', 
      v_auth_count, v_profile_count;
  END IF;
END $$;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- Demo Credentials:
-- Admin: admin@rfincare.com / Admin@2026
-- Employee: employee@rfincare.com / Employee@2026  
-- Agent: agent@rfincare.com / Agent@2026
-- Customer: customer@rfincare.com / Customer@2026
-- =====================================================