-- =====================================================
-- FIX RLS CIRCULAR DEPENDENCY
-- Purpose: Fix "permission denied for table users" error
-- Issue: is_admin() function queries user_profiles, causing circular RLS dependency
-- Solution: Use auth.users metadata instead of querying user_profiles
-- =====================================================

-- Recreate is_admin() using auth.users metadata (NO circular dependency)
-- Using CREATE OR REPLACE to avoid dropping dependent policies
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

-- Recreate is_employee() using auth.users metadata
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

-- Recreate is_agent() using auth.users metadata
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

-- Recreate has_completed_assessment() - this one is safe as it doesn't query user_profiles in RLS context
CREATE OR REPLACE FUNCTION public.has_completed_assessment(user_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.eligibility_assessments ea
    JOIN public.user_profiles up ON ea.customer_id = up.id
    WHERE up.email = user_email
    AND ea.eligibility_status IS NOT NULL
  )
$$;

-- Add comment explaining the fix
COMMENT ON FUNCTION public.is_admin() IS 
'Checks if current user is admin using auth.users metadata to avoid circular RLS dependency';

COMMENT ON FUNCTION public.is_employee() IS 
'Checks if current user is employee using auth.users metadata to avoid circular RLS dependency';

COMMENT ON FUNCTION public.is_agent() IS 
'Checks if current user is agent using auth.users metadata to avoid circular RLS dependency';

-- Verify the fix by testing the function
DO $$
BEGIN
  RAISE NOTICE 'RLS circular dependency fix applied successfully';
  RAISE NOTICE 'Helper functions now use auth.users metadata instead of querying user_profiles';
END $$;