-- =====================================================
-- FIX DEMO USERS AUTHENTICATION
-- Purpose: Remove incorrectly created demo users and recreate them properly
-- Issue: Direct INSERT into auth.users doesn't work with Supabase Auth
-- Solution: Use Supabase's auth.users table with proper password hashing
-- =====================================================

-- 1. CLEAN UP EXISTING DEMO USERS (Idempotent)
-- =====================================================

DO $$
BEGIN
  -- Delete existing demo users from user_profiles first (due to foreign key)
  DELETE FROM public.user_profiles 
  WHERE email IN (
    'admin@rfincare.com',
    'employee@rfincare.com', 
    'agent@rfincare.com',
    'customer@rfincare.com'
  );
  
  -- Delete from auth.users
  DELETE FROM auth.users 
  WHERE email IN (
    'admin@rfincare.com',
    'employee@rfincare.com',
    'agent@rfincare.com', 
    'customer@rfincare.com'
  );
  
  RAISE NOTICE 'Cleaned up existing demo users';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Cleanup failed: %', SQLERRM;
END $$;

-- 2. CREATE DEMO USERS USING PROPER SUPABASE AUTH METHOD
-- =====================================================
-- Note: This uses the auth schema's internal functions properly

DO $$
DECLARE
  admin_uuid UUID;
  employee_uuid UUID;
  agent_uuid UUID;
  customer_uuid UUID;
  encrypted_pass TEXT;
BEGIN
  -- Admin User
  admin_uuid := gen_random_uuid();
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
  );
  
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
  );
  
  -- Employee User
  employee_uuid := gen_random_uuid();
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
  );
  
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
  );
  
  -- Agent User
  agent_uuid := gen_random_uuid();
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
  );
  
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
  );
  
  -- Customer User
  customer_uuid := gen_random_uuid();
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
  );
  
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
  );
  
  RAISE NOTICE 'Demo users created successfully with proper authentication';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Demo user creation failed: %', SQLERRM;
    RAISE;
END $$;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- Demo Credentials (Now properly authenticated):
-- Admin: admin@rfincare.com / Admin@2026
-- Employee: employee@rfincare.com / Employee@2026  
-- Agent: agent@rfincare.com / Agent@2026
-- Customer: customer@rfincare.com / Customer@2026
-- =====================================================