-- =====================================================
-- FIX CIRCULAR RLS DEPENDENCY (FINAL FIX)
-- Purpose: Fix "permission denied for table users" error
-- Issue: is_admin() function queries user_profiles, causing circular RLS dependency
-- Root Cause: Migration 20260219070000 reverted the fix from 20260218150000
-- Solution: Use auth.users metadata instead of querying user_profiles
-- =====================================================

-- Recreate is_admin() using auth.users metadata (NO circular dependency)
-- This avoids querying user_profiles which has RLS policies that depend on is_admin()
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

-- Add comment explaining the fix
COMMENT ON FUNCTION public.is_admin() IS
'Checks if current user is admin or super_admin using auth.users metadata to avoid circular RLS dependency. CRITICAL: Do not query user_profiles table in this function as it creates circular dependency.';

-- Verify the policy still exists (it should, we only changed the function)
-- This policy allows admins to read all user profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'user_profiles' 
    AND policyname = 'admins_read_all_user_profiles'
  ) THEN
    CREATE POLICY "admins_read_all_user_profiles"
    ON public.user_profiles
    FOR SELECT
    TO authenticated
    USING (public.is_admin());
  END IF;
END $$;

-- Add explanatory comment
COMMENT ON POLICY "admins_read_all_user_profiles" ON public.user_profiles IS 
'Allows admins and super_admins to read all user profiles. Uses is_admin() which checks auth.users metadata to avoid circular dependency.';