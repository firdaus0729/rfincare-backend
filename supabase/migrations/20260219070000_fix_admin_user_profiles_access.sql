-- =====================================================
-- FIX ADMIN ACCESS TO USER_PROFILES
-- Purpose: Allow admins and super_admins to read user_profiles for registration review
-- Issue: is_admin() function only checks for 'admin' role, missing 'super_admin'
-- Solution: Update is_admin() to check for both admin and super_admin roles
-- =====================================================

-- Update is_admin function to include super_admin role
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin')
  )
$$;

-- Recreate the policy to ensure it uses the updated function
DROP POLICY IF EXISTS "admins_read_all_user_profiles" ON public.user_profiles;
CREATE POLICY "admins_read_all_user_profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Add comment for clarity
COMMENT ON FUNCTION public.is_admin() IS 
'Returns true if the current user has admin or super_admin role';

COMMENT ON POLICY "admins_read_all_user_profiles" ON public.user_profiles IS 
'Allows admins and super_admins to read all user profiles for registration review and management';