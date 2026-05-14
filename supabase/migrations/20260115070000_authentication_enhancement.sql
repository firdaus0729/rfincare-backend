-- Authentication Enhancement Migration
-- Includes: OAuth provider integration, password management, admin onboarding, multi-level authentication

-- ============================================
-- STEP 1: EXTEND EXISTING TYPES
-- ============================================

CREATE TYPE public.oauth_provider AS ENUM ('google', 'microsoft', 'outlook', 'yahoo', 'rediff', 'email');
CREATE TYPE public.account_status AS ENUM ('pending_verification', 'active', 'suspended', 'locked', 'inactive');
CREATE TYPE public.onboarding_status AS ENUM ('pending', 'demographic_completed', 'bank_info_completed', 'completed');

-- ============================================
-- STEP 2: EXTEND USER_PROFILES TABLE
-- ============================================

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS oauth_provider public.oauth_provider DEFAULT 'email'::public.oauth_provider,
ADD COLUMN IF NOT EXISTS oauth_provider_id TEXT,
ADD COLUMN IF NOT EXISTS account_status public.account_status DEFAULT 'active'::public.account_status,
ADD COLUMN IF NOT EXISTS onboarding_status public.onboarding_status DEFAULT 'completed'::public.onboarding_status,
ADD COLUMN IF NOT EXISTS password_change_required BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_password_change TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- ============================================
-- STEP 3: CUSTOMER REGISTRATIONS TABLE
-- ============================================

CREATE TABLE public.customer_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    oauth_provider public.oauth_provider NOT NULL,
    oauth_provider_id TEXT,
    oauth_access_token TEXT,
    oauth_refresh_token TEXT,
    
    -- Personal Information
    full_name TEXT NOT NULL,
    phone TEXT,
    date_of_birth DATE,
    
    -- Demographic Details
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT,
    pin_code TEXT,
    
    -- Employment Information
    employment_type public.employment_type,
    employer_name TEXT,
    annual_income DECIMAL(15,2),
    
    -- Bank Information
    bank_name TEXT,
    account_number TEXT,
    ifsc_code TEXT,
    account_type TEXT,
    
    -- Registration Status
    registration_status TEXT DEFAULT 'pending' CHECK (registration_status IN ('pending', 'approved', 'rejected')),
    approved_by UUID REFERENCES public.user_profiles(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- STEP 4: ADMIN ONBOARDING TABLE
-- ============================================

CREATE TABLE public.admin_onboarding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID REFERENCES public.customer_registrations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    
    -- Onboarding Steps
    username TEXT UNIQUE,
    demographic_verified BOOLEAN DEFAULT false,
    bank_info_verified BOOLEAN DEFAULT false,
    documents_verified BOOLEAN DEFAULT false,
    
    -- Verification Details
    verified_by UUID REFERENCES public.user_profiles(id),
    verification_notes TEXT,
    
    onboarding_status public.onboarding_status DEFAULT 'pending'::public.onboarding_status,
    completed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- STEP 5: PASSWORD HISTORY TABLE
-- ============================================

CREATE TABLE public.password_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    changed_by UUID REFERENCES public.user_profiles(id),
    change_reason TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- STEP 6: USER SESSIONS TABLE
-- ============================================

CREATE TABLE public.user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    session_token TEXT NOT NULL UNIQUE,
    oauth_provider public.oauth_provider,
    ip_address TEXT,
    user_agent TEXT,
    last_activity TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- STEP 7: INDEXES
-- ============================================

CREATE INDEX idx_user_profiles_oauth_provider ON public.user_profiles(oauth_provider);
CREATE INDEX idx_user_profiles_account_status ON public.user_profiles(account_status);
CREATE INDEX idx_customer_registrations_email ON public.customer_registrations(email);
CREATE INDEX idx_customer_registrations_status ON public.customer_registrations(registration_status);
CREATE INDEX idx_admin_onboarding_user_id ON public.admin_onboarding(user_id);
CREATE INDEX idx_admin_onboarding_status ON public.admin_onboarding(onboarding_status);
CREATE INDEX idx_password_history_user_id ON public.password_history(user_id);
CREATE INDEX idx_password_history_created_at ON public.password_history(created_at DESC);
CREATE INDEX idx_user_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX idx_user_sessions_active ON public.user_sessions(is_active);

-- ============================================
-- STEP 8: FUNCTIONS (BEFORE RLS POLICIES)
-- ============================================

-- Function to check password reuse
CREATE OR REPLACE FUNCTION public.check_password_reuse(p_user_id UUID, p_password_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.password_history
        WHERE user_id = p_user_id
        AND password_hash = p_password_hash
        AND created_at > NOW() - INTERVAL '90 days'
        LIMIT 1
    );
END;
$$;

-- Function to log password change
CREATE OR REPLACE FUNCTION public.log_password_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
        INSERT INTO public.password_history (user_id, password_hash, changed_by)
        VALUES (NEW.id, NEW.encrypted_password, auth.uid());
        
        UPDATE public.user_profiles
        SET last_password_change = NOW()
        WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

-- Function to clean expired sessions
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.user_sessions
    SET is_active = false
    WHERE expires_at < NOW() AND is_active = true;
END;
$$;

-- ============================================
-- STEP 9: ENABLE RLS
-- ============================================

ALTER TABLE public.customer_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 10: RLS POLICIES
-- ============================================

-- Customer Registrations Policies
CREATE POLICY "users_view_own_customer_registrations"
ON public.customer_registrations
FOR SELECT
TO authenticated
USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

CREATE POLICY "users_create_customer_registrations"
ON public.customer_registrations
FOR INSERT
TO authenticated
WITH CHECK (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

CREATE POLICY "admins_manage_customer_registrations"
ON public.customer_registrations
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
);

-- Admin Onboarding Policies
CREATE POLICY "users_view_own_admin_onboarding"
ON public.admin_onboarding
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "admins_manage_admin_onboarding"
ON public.admin_onboarding
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
);

-- Password History Policies
CREATE POLICY "users_view_own_password_history"
ON public.password_history
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "system_insert_password_history"
ON public.password_history
FOR INSERT
TO authenticated
WITH CHECK (true);

-- User Sessions Policies
CREATE POLICY "users_view_own_user_sessions"
ON public.user_sessions
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "users_manage_own_user_sessions"
ON public.user_sessions
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ============================================
-- STEP 11: TRIGGERS
-- ============================================

-- Trigger to log password changes
CREATE TRIGGER trigger_log_password_change
    AFTER UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.log_password_change();

-- ============================================
-- STEP 12: MOCK DATA
-- ============================================

DO $$
DECLARE
    admin_uuid UUID := gen_random_uuid();
    agent_uuid UUID := gen_random_uuid();
    employee_uuid UUID := gen_random_uuid();
    customer_uuid UUID := gen_random_uuid();
BEGIN
    -- Create admin user (Redfin26 / Pass@2026)
    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
        is_sso_user, is_anonymous, confirmation_token, confirmation_sent_at,
        recovery_token, recovery_sent_at, email_change_token_new, email_change,
        email_change_sent_at, email_change_token_current, email_change_confirm_status,
        reauthentication_token, reauthentication_sent_at, phone, phone_change,
        phone_change_token, phone_change_sent_at
    ) VALUES
        (admin_uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'redfin26@financeflow.com', crypt('Pass@2026', gen_salt('bf', 10)), now(), now(), now(),
         '{"full_name": "Redfin26 Admin", "role": "admin"}'::jsonb,
         '{"provider": "email", "providers": ["email"]}'::jsonb,
         false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null)
    ON CONFLICT (id) DO NOTHING;

    -- Update admin user profile with additional fields
    UPDATE public.user_profiles
    SET 
        oauth_provider = 'email'::public.oauth_provider,
        account_status = 'active'::public.account_status,
        onboarding_status = 'completed'::public.onboarding_status,
        last_password_change = NOW()
    WHERE id = admin_uuid;

    -- Create sample customer registration
    INSERT INTO public.customer_registrations (
        id, email, oauth_provider, full_name, phone, registration_status
    ) VALUES
        (gen_random_uuid(), 'customer.demo@gmail.com', 'google'::public.oauth_provider, 'Demo Customer', '+91-9876543210', 'pending'),
        (gen_random_uuid(), 'business.user@outlook.com', 'outlook'::public.oauth_provider, 'Business User', '+91-9876543211', 'pending')
    ON CONFLICT (email) DO NOTHING;

    RAISE NOTICE 'Authentication enhancement migration completed successfully';
    RAISE NOTICE 'Admin credentials: Username=Redfin26, Email=redfin26@financeflow.com, Password=Pass@2026';
END $$;