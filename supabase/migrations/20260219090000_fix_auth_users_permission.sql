-- =====================================================
-- FIX AUTH.USERS PERMISSION AND ROLE-CHECKING FUNCTIONS
-- Purpose: Fix "permission denied for table users" error
-- Issue: SECURITY DEFINER functions can't access auth.users without explicit grant
-- Solution: Grant SELECT on auth.users and update all role functions consistently
-- =====================================================

-- Grant SELECT permission on auth.users to authenticated users
-- This allows SECURITY DEFINER functions to read user metadata
GRANT SELECT ON auth.users TO authenticated;

-- Update is_admin() to use auth.users metadata (NO circular dependency)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users au
    WHERE au.id = auth.uid()
    AND (
      au.raw_user_meta_data->>'role' IN ('admin', 'super_admin')
      OR au.raw_app_meta_data->>'role' IN ('admin', 'super_admin')
    )
  )
$$;

-- Update is_employee() to use auth.users metadata (NO circular dependency)
CREATE OR REPLACE FUNCTION public.is_employee()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users au
    WHERE au.id = auth.uid()
    AND (
      au.raw_user_meta_data->>'role' = 'employee'
      OR au.raw_app_meta_data->>'role' = 'employee'
    )
  )
$$;

-- Update is_agent() to use auth.users metadata (NO circular dependency)
CREATE OR REPLACE FUNCTION public.is_agent()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users au
    WHERE au.id = auth.uid()
    AND (
      au.raw_user_meta_data->>'role' = 'agent'
      OR au.raw_app_meta_data->>'role' = 'agent'
    )
  )
$$;

-- Add comments explaining the fix
COMMENT ON FUNCTION public.is_admin() IS
'Checks if current user is admin or super_admin using auth.users metadata to avoid circular RLS dependency. CRITICAL: Do not query user_profiles table in this function.';

COMMENT ON FUNCTION public.is_employee() IS
'Checks if current user is employee using auth.users metadata to avoid circular RLS dependency. CRITICAL: Do not query user_profiles table in this function.';

COMMENT ON FUNCTION public.is_agent() IS
'Checks if current user is agent using auth.users metadata to avoid circular RLS dependency. CRITICAL: Do not query user_profiles table in this function.';

-- Verify critical policies still exist
DO $$
BEGIN
  -- Ensure admins can read all user profiles
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'user_profiles' 
    AND policyname = 'admins_manage_all_profiles'
  ) THEN
    CREATE POLICY "admins_manage_all_profiles"
    ON public.user_profiles
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());
  END IF;

  -- Ensure employees can view all user profiles
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'user_profiles' 
    AND policyname = 'employees_view_all_profiles'
  ) THEN
    CREATE POLICY "employees_view_all_profiles"
    ON public.user_profiles
    FOR SELECT
    TO authenticated
    USING (public.is_employee());
  END IF;

  -- Ensure admins can read all customer registrations
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'customer_registrations' 
    AND policyname = 'admins_full_access_customer_registrations'
  ) THEN
    CREATE POLICY "admins_full_access_customer_registrations"
    ON public.customer_registrations
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());
  END IF;
END $$;

-- Add explanatory comments
COMMENT ON POLICY "admins_manage_all_profiles" ON public.user_profiles IS 
'Allows admins and super_admins to manage all user profiles. Uses is_admin() which checks auth.users metadata to avoid circular dependency.';

COMMENT ON POLICY "employees_view_all_profiles" ON public.user_profiles IS 
'Allows employees to view all user profiles. Uses is_employee() which checks auth.users metadata to avoid circular dependency.';