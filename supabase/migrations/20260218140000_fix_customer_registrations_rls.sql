-- =====================================================
-- FIX CUSTOMER REGISTRATIONS RLS POLICY
-- Purpose: Allow admins to read user_profiles when querying customer_registrations
-- Issue: Query joins to user_profiles but RLS blocks access
-- Solution: Add policy for admins to read user_profiles for registration review
-- =====================================================

-- Add policy for admins to read all user_profiles (needed for registration review)
DROP POLICY IF EXISTS "admins_read_all_user_profiles" ON public.user_profiles;
CREATE POLICY "admins_read_all_user_profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Verify the is_admin function exists (should be from previous migration)
-- If not, create it
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  )
$$;

-- Add comment for clarity
COMMENT ON POLICY "admins_read_all_user_profiles" ON public.user_profiles IS 
'Allows admins to read all user profiles for registration review and management';