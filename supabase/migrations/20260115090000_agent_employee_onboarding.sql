-- Agent and Employee Onboarding Migration
-- Adds tables for admin-controlled agent and employee onboarding with username/password authentication

-- ============================================
-- STEP 1: CREATE AGENT ONBOARDING TABLE
-- ============================================

CREATE TABLE public.agent_onboarding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    
    -- Login Credentials
    username TEXT NOT NULL UNIQUE,
    
    -- Agent Details
    agent_name TEXT NOT NULL,
    agent_code TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    mobile_number TEXT NOT NULL,
    
    -- Bank Information
    account_number TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    ifsc_code TEXT NOT NULL,
    
    -- Status and Metadata
    onboarding_status TEXT DEFAULT 'pending' CHECK (onboarding_status IN ('pending', 'active', 'inactive', 'suspended')),
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- STEP 2: CREATE EMPLOYEE ONBOARDING TABLE
-- ============================================

CREATE TABLE public.employee_onboarding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    
    -- Login Credentials
    username TEXT NOT NULL UNIQUE,
    
    -- Employee Details
    employee_name TEXT NOT NULL,
    employee_code TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    mobile_number TEXT NOT NULL,
    
    -- Bank Information
    account_number TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    ifsc_code TEXT NOT NULL,
    
    -- Status and Metadata
    onboarding_status TEXT DEFAULT 'pending' CHECK (onboarding_status IN ('pending', 'active', 'inactive', 'suspended')),
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- STEP 3: INDEXES
-- ============================================

CREATE INDEX idx_agent_onboarding_username ON public.agent_onboarding(username);
CREATE INDEX idx_agent_onboarding_email ON public.agent_onboarding(email);
CREATE INDEX idx_agent_onboarding_agent_code ON public.agent_onboarding(agent_code);
CREATE INDEX idx_agent_onboarding_status ON public.agent_onboarding(onboarding_status);
CREATE INDEX idx_agent_onboarding_user_id ON public.agent_onboarding(user_id);

CREATE INDEX idx_employee_onboarding_username ON public.employee_onboarding(username);
CREATE INDEX idx_employee_onboarding_email ON public.employee_onboarding(email);
CREATE INDEX idx_employee_onboarding_employee_code ON public.employee_onboarding(employee_code);
CREATE INDEX idx_employee_onboarding_status ON public.employee_onboarding(onboarding_status);
CREATE INDEX idx_employee_onboarding_user_id ON public.employee_onboarding(user_id);

-- ============================================
-- STEP 4: ENABLE RLS
-- ============================================

ALTER TABLE public.agent_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_onboarding ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 5: RLS POLICIES
-- ============================================

-- Agent Onboarding Policies
CREATE POLICY "agents_view_own_agent_onboarding"
ON public.agent_onboarding
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "admins_manage_agent_onboarding"
ON public.agent_onboarding
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

-- Employee Onboarding Policies
CREATE POLICY "employees_view_own_employee_onboarding"
ON public.employee_onboarding
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "admins_manage_employee_onboarding"
ON public.employee_onboarding
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

-- ============================================
-- STEP 6: MOCK DATA
-- ============================================

DO $$
DECLARE
    admin_user_id UUID;
BEGIN
    -- Get admin user ID
    SELECT id INTO admin_user_id FROM public.user_profiles WHERE role = 'admin' LIMIT 1;
    
    IF admin_user_id IS NOT NULL THEN
        -- Create sample agent onboarding records
        INSERT INTO public.agent_onboarding (
            username, agent_name, agent_code, email, mobile_number,
            account_number, bank_name, ifsc_code, onboarding_status, created_by
        ) VALUES
            ('agent_demo', 'Demo Agent', 'AGT-DEMO-001', 'demo.agent@financeflow.com', '+91-9876543210',
             '1234567890', 'HDFC Bank', 'HDFC0001234', 'pending', admin_user_id)
        ON CONFLICT (username) DO NOTHING;
        
        -- Create sample employee onboarding records
        INSERT INTO public.employee_onboarding (
            username, employee_name, employee_code, email, mobile_number,
            account_number, bank_name, ifsc_code, onboarding_status, created_by
        ) VALUES
            ('employee_demo', 'Demo Employee', 'EMP-DEMO-001', 'demo.employee@financeflow.com', '+91-9876543211',
             '0987654321', 'ICICI Bank', 'ICIC0004321', 'pending', admin_user_id)
        ON CONFLICT (username) DO NOTHING;
    END IF;
    
    RAISE NOTICE 'Agent and Employee onboarding tables created successfully';
END $$;