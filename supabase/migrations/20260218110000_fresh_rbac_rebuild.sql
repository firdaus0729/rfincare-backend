-- =====================================================
-- FRESH SUPABASE RBAC REBUILD MIGRATION
-- Purpose: Complete rebuild of authentication with role-based access
-- =====================================================

-- 1. CLEAN UP EXISTING POLICIES (Idempotent)
-- =====================================================
DROP POLICY IF EXISTS "users_manage_own_user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "admin_full_access_user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "users_manage_own_loan_applications" ON public.loan_applications;
DROP POLICY IF EXISTS "admin_full_access_loan_applications" ON public.loan_applications;
DROP POLICY IF EXISTS "employee_access_loan_applications" ON public.loan_applications;
DROP POLICY IF EXISTS "agent_access_loan_applications" ON public.loan_applications;
DROP POLICY IF EXISTS "users_manage_own_customer_documents" ON public.customer_documents;
DROP POLICY IF EXISTS "admin_full_access_customer_documents" ON public.customer_documents;
DROP POLICY IF EXISTS "employee_access_customer_documents" ON public.customer_documents;

-- 2. ENSURE RLS IS ENABLED
-- =====================================================
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eligibility_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_registrations ENABLE ROW LEVEL SECURITY;

-- 3. HELPER FUNCTIONS (Created BEFORE policies)
-- =====================================================

-- Function to check if user is admin or super_admin
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
    AND is_active = true
  )
$$;

-- Function to check if user is employee
CREATE OR REPLACE FUNCTION public.is_employee()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'employee'
    AND is_active = true
  )
$$;

-- Function to check if user is agent
CREATE OR REPLACE FUNCTION public.is_agent()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'agent'
    AND is_active = true
  )
$$;

-- Function to check if user has completed assessment (for customer registration)
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

-- 4. RLS POLICIES FOR user_profiles
-- =====================================================

-- Users can view and update their own profile
DROP POLICY IF EXISTS "users_manage_own_profile" ON public.user_profiles;
CREATE POLICY "users_manage_own_profile"
ON public.user_profiles
FOR ALL
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Admins can view and manage all profiles
DROP POLICY IF EXISTS "admins_manage_all_profiles" ON public.user_profiles;
CREATE POLICY "admins_manage_all_profiles"
ON public.user_profiles
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Employees can view all profiles (read-only for verification)
DROP POLICY IF EXISTS "employees_view_all_profiles" ON public.user_profiles;
CREATE POLICY "employees_view_all_profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (public.is_employee());

-- 5. RLS POLICIES FOR loan_applications
-- =====================================================

-- Customers can manage their own applications
DROP POLICY IF EXISTS "customers_manage_own_applications" ON public.loan_applications;
CREATE POLICY "customers_manage_own_applications"
ON public.loan_applications
FOR ALL
TO authenticated
USING (customer_id = auth.uid())
WITH CHECK (customer_id = auth.uid());

-- Agents can view applications they're assigned to
DROP POLICY IF EXISTS "agents_view_assigned_applications" ON public.loan_applications;
CREATE POLICY "agents_view_assigned_applications"
ON public.loan_applications
FOR SELECT
TO authenticated
USING (agent_id = auth.uid() AND public.is_agent());

-- Employees can view and update applications assigned to them
DROP POLICY IF EXISTS "employees_manage_assigned_applications" ON public.loan_applications;
CREATE POLICY "employees_manage_assigned_applications"
ON public.loan_applications
FOR ALL
TO authenticated
USING (
  (assigned_employee_id = auth.uid() OR assigned_employee_id IS NULL)
  AND public.is_employee()
)
WITH CHECK (
  (assigned_employee_id = auth.uid() OR assigned_employee_id IS NULL)
  AND public.is_employee()
);

-- Admins have full access to all applications
DROP POLICY IF EXISTS "admins_full_access_applications" ON public.loan_applications;
CREATE POLICY "admins_full_access_applications"
ON public.loan_applications
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 6. RLS POLICIES FOR customer_documents
-- =====================================================

-- Customers can manage their own documents
DROP POLICY IF EXISTS "customers_manage_own_documents" ON public.customer_documents;
CREATE POLICY "customers_manage_own_documents"
ON public.customer_documents
FOR ALL
TO authenticated
USING (customer_id = auth.uid())
WITH CHECK (customer_id = auth.uid());

-- Employees can view and verify documents
DROP POLICY IF EXISTS "employees_manage_documents" ON public.customer_documents;
CREATE POLICY "employees_manage_documents"
ON public.customer_documents
FOR ALL
TO authenticated
USING (public.is_employee())
WITH CHECK (public.is_employee());

-- Admins have full access to all documents
DROP POLICY IF EXISTS "admins_full_access_documents" ON public.customer_documents;
CREATE POLICY "admins_full_access_documents"
ON public.customer_documents
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 7. RLS POLICIES FOR agents
-- =====================================================

-- Agents can view their own profile
DROP POLICY IF EXISTS "agents_view_own_profile" ON public.agents;
CREATE POLICY "agents_view_own_profile"
ON public.agents
FOR SELECT
TO authenticated
USING (id = auth.uid());

-- Admins can manage all agent profiles
DROP POLICY IF EXISTS "admins_manage_agents" ON public.agents;
CREATE POLICY "admins_manage_agents"
ON public.agents
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 8. RLS POLICIES FOR employee_onboarding
-- =====================================================

-- Employees can view their own onboarding
DROP POLICY IF EXISTS "employees_view_own_onboarding" ON public.employee_onboarding;
CREATE POLICY "employees_view_own_onboarding"
ON public.employee_onboarding
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Admins can manage all employee onboarding
DROP POLICY IF EXISTS "admins_manage_employee_onboarding" ON public.employee_onboarding;
CREATE POLICY "admins_manage_employee_onboarding"
ON public.employee_onboarding
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 9. RLS POLICIES FOR agent_onboarding
-- =====================================================

-- Agents can view their own onboarding
DROP POLICY IF EXISTS "agents_view_own_onboarding" ON public.agent_onboarding;
CREATE POLICY "agents_view_own_onboarding"
ON public.agent_onboarding
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Admins can manage all agent onboarding
DROP POLICY IF EXISTS "admins_manage_agent_onboarding" ON public.agent_onboarding;
CREATE POLICY "admins_manage_agent_onboarding"
ON public.agent_onboarding
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 10. RLS POLICIES FOR eligibility_assessments
-- =====================================================

-- Customers can manage their own assessments
DROP POLICY IF EXISTS "customers_manage_own_assessments" ON public.eligibility_assessments;
CREATE POLICY "customers_manage_own_assessments"
ON public.eligibility_assessments
FOR ALL
TO authenticated
USING (customer_id = auth.uid())
WITH CHECK (customer_id = auth.uid());

-- Public can create assessments (for pre-registration assessment)
DROP POLICY IF EXISTS "public_create_assessments" ON public.eligibility_assessments;
CREATE POLICY "public_create_assessments"
ON public.eligibility_assessments
FOR INSERT
TO public
WITH CHECK (true);

-- Admins can view all assessments
DROP POLICY IF EXISTS "admins_view_all_assessments" ON public.eligibility_assessments;
CREATE POLICY "admins_view_all_assessments"
ON public.eligibility_assessments
FOR SELECT
TO authenticated
USING (public.is_admin());

-- 11. RLS POLICIES FOR customer_registrations
-- =====================================================

-- Public can create registrations (after assessment)
DROP POLICY IF EXISTS "public_create_registrations" ON public.customer_registrations;
CREATE POLICY "public_create_registrations"
ON public.customer_registrations
FOR INSERT
TO public
WITH CHECK (true);

-- Admins can manage all registrations
DROP POLICY IF EXISTS "admins_manage_registrations" ON public.customer_registrations;
CREATE POLICY "admins_manage_registrations"
ON public.customer_registrations
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 12. DEMO USERS FOR TESTING (Idempotent)
-- =====================================================

DO $$
DECLARE
  admin_uuid UUID;
  employee_uuid UUID;
  agent_uuid UUID;
  customer_uuid UUID;
BEGIN
  -- Check if demo users already exist
  SELECT id INTO admin_uuid FROM auth.users WHERE email = 'admin@rfincare.com' LIMIT 1;
  SELECT id INTO employee_uuid FROM auth.users WHERE email = 'employee@rfincare.com' LIMIT 1;
  SELECT id INTO agent_uuid FROM auth.users WHERE email = 'agent@rfincare.com' LIMIT 1;
  SELECT id INTO customer_uuid FROM auth.users WHERE email = 'customer@rfincare.com' LIMIT 1;

  -- Create admin user if not exists
  IF admin_uuid IS NULL THEN
    admin_uuid := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
      is_sso_user, is_anonymous, confirmation_token, confirmation_sent_at,
      recovery_token, recovery_sent_at, email_change_token_new, email_change,
      email_change_sent_at, email_change_token_current, email_change_confirm_status,
      reauthentication_token, reauthentication_sent_at, phone, phone_change,
      phone_change_token, phone_change_sent_at
    ) VALUES (
      admin_uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'admin@rfincare.com', crypt('Admin@2026', gen_salt('bf', 10)), now(), now(), now(),
      jsonb_build_object('full_name', 'Admin User', 'role', 'super_admin'),
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::TEXT[]),
      false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null
    ) ON CONFLICT (id) DO NOTHING;
    
    -- Create corresponding user_profile for admin
    INSERT INTO public.user_profiles (
      id, email, full_name, role, is_active, account_status, 
      failed_login_attempts, created_at, updated_at
    ) VALUES (
      admin_uuid, 'admin@rfincare.com', 'Admin User', 'super_admin', true, 'active',
      0, now(), now()
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Create employee user if not exists
  IF employee_uuid IS NULL THEN
    employee_uuid := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
      is_sso_user, is_anonymous, confirmation_token, confirmation_sent_at,
      recovery_token, recovery_sent_at, email_change_token_new, email_change,
      email_change_sent_at, email_change_token_current, email_change_confirm_status,
      reauthentication_token, reauthentication_sent_at, phone, phone_change,
      phone_change_token, phone_change_sent_at
    ) VALUES (
      employee_uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'employee@rfincare.com', crypt('Employee@2026', gen_salt('bf', 10)), now(), now(), now(),
      jsonb_build_object('full_name', 'Employee User', 'role', 'employee'),
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::TEXT[]),
      false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null
    ) ON CONFLICT (id) DO NOTHING;
    
    -- Create corresponding user_profile for employee
    INSERT INTO public.user_profiles (
      id, email, full_name, role, is_active, account_status, 
      failed_login_attempts, created_at, updated_at
    ) VALUES (
      employee_uuid, 'employee@rfincare.com', 'Employee User', 'employee', true, 'active',
      0, now(), now()
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Create agent user if not exists
  IF agent_uuid IS NULL THEN
    agent_uuid := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
      is_sso_user, is_anonymous, confirmation_token, confirmation_sent_at,
      recovery_token, recovery_sent_at, email_change_token_new, email_change,
      email_change_sent_at, email_change_token_current, email_change_confirm_status,
      reauthentication_token, reauthentication_sent_at, phone, phone_change,
      phone_change_token, phone_change_sent_at
    ) VALUES (
      agent_uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'agent@rfincare.com', crypt('Agent@2026', gen_salt('bf', 10)), now(), now(), now(),
      jsonb_build_object('full_name', 'Agent User', 'role', 'agent'),
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::TEXT[]),
      false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null
    ) ON CONFLICT (id) DO NOTHING;
    
    -- Create corresponding user_profile for agent
    INSERT INTO public.user_profiles (
      id, email, full_name, role, is_active, account_status, 
      failed_login_attempts, created_at, updated_at
    ) VALUES (
      agent_uuid, 'agent@rfincare.com', 'Agent User', 'agent', true, 'active',
      0, now(), now()
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Create customer user if not exists
  IF customer_uuid IS NULL THEN
    customer_uuid := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
      is_sso_user, is_anonymous, confirmation_token, confirmation_sent_at,
      recovery_token, recovery_sent_at, email_change_token_new, email_change,
      email_change_sent_at, email_change_token_current, email_change_confirm_status,
      reauthentication_token, reauthentication_sent_at, phone, phone_change,
      phone_change_token, phone_change_sent_at
    ) VALUES (
      customer_uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'customer@rfincare.com', crypt('Customer@2026', gen_salt('bf', 10)), now(), now(), now(),
      jsonb_build_object('full_name', 'Customer User', 'role', 'customer'),
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::TEXT[]),
      false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null
    ) ON CONFLICT (id) DO NOTHING;
    
    -- Create corresponding user_profile for customer
    INSERT INTO public.user_profiles (
      id, email, full_name, role, is_active, account_status, 
      failed_login_attempts, created_at, updated_at
    ) VALUES (
      customer_uuid, 'customer@rfincare.com', 'Customer User', 'customer', true, 'active',
      0, now(), now()
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  RAISE NOTICE 'Demo users created/verified successfully';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Demo user creation failed: %', SQLERRM;
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