-- India-Specific Loan Application System Migration
-- Includes: User management, Bank marketplace, Approval matrix, Applications, Audit logs

-- ============================================
-- STEP 1: CUSTOM TYPES
-- ============================================

CREATE TYPE public.user_role AS ENUM ('super_admin', 'admin', 'employee', 'agent', 'customer');
CREATE TYPE public.application_status AS ENUM ('draft', 'submitted', 'under_review', 'documents_pending', 'approved', 'rejected', 'disbursed');
CREATE TYPE public.loan_type AS ENUM ('home_loan', 'personal_loan', 'business_loan', 'auto_loan', 'education_loan', 'debt_consolidation');
CREATE TYPE public.employment_type AS ENUM ('salaried', 'self_employed', 'business_owner', 'professional', 'retired', 'unemployed');
CREATE TYPE public.bank_status AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE public.agent_status AS ENUM ('pending', 'active', 'inactive', 'suspended');
CREATE TYPE public.credit_score_range AS ENUM ('excellent', 'good', 'fair', 'poor', 'very_poor', 'unknown');

-- ============================================
-- STEP 2: CORE TABLES
-- ============================================

-- User Profiles (linked to auth.users)
CREATE TABLE public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    phone TEXT,
    role public.user_role DEFAULT 'customer'::public.user_role,
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indian States Master Data
CREATE TABLE public.indian_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_code TEXT NOT NULL UNIQUE,
    state_name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true
);

-- Bank Master Data
CREATE TABLE public.banks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    logo_url TEXT,
    logo_alt TEXT,
    bank_type TEXT CHECK (bank_type IN ('public', 'private', 'foreign', 'cooperative')),
    status public.bank_status DEFAULT 'active'::public.bank_status,
    rating DECIMAL(2,1) CHECK (rating >= 0 AND rating <= 5),
    reviews_count INTEGER DEFAULT 0,
    customers_served TEXT,
    partnership_duration TEXT,
    certifications TEXT[],
    display_priority INTEGER DEFAULT 0,
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Bank Products (Loan offerings)
CREATE TABLE public.bank_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id UUID REFERENCES public.banks(id) ON DELETE CASCADE,
    loan_type public.loan_type NOT NULL,
    interest_rate_min DECIMAL(5,2) NOT NULL,
    interest_rate_max DECIMAL(5,2) NOT NULL,
    processing_fee_percentage DECIMAL(5,2),
    processing_fee_fixed DECIMAL(12,2),
    max_loan_amount DECIMAL(15,2) NOT NULL,
    min_loan_amount DECIMAL(15,2) DEFAULT 100000,
    max_tenure_years INTEGER NOT NULL,
    min_tenure_years INTEGER DEFAULT 1,
    features TEXT[],
    required_documents TEXT[],
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Bank Approval Matrix (Dynamic Rules)
CREATE TABLE public.approval_matrix_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name TEXT NOT NULL,
    bank_id UUID REFERENCES public.banks(id) ON DELETE CASCADE,
    loan_type public.loan_type,
    min_annual_income DECIMAL(15,2),
    max_annual_income DECIMAL(15,2),
    min_credit_score INTEGER,
    max_credit_score INTEGER,
    employment_types public.employment_type[],
    eligible_states TEXT[],
    eligible_cities TEXT[],
    min_loan_amount DECIMAL(15,2),
    max_loan_amount DECIMAL(15,2),
    min_age INTEGER,
    max_age INTEGER,
    approval_probability INTEGER CHECK (approval_probability >= 0 AND approval_probability <= 100),
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Customer Applications
CREATE TABLE public.loan_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_number TEXT UNIQUE NOT NULL,
    customer_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES public.user_profiles(id),
    assigned_employee_id UUID REFERENCES public.user_profiles(id),
    
    -- Personal Information
    title TEXT,
    first_name TEXT NOT NULL,
    middle_name TEXT,
    last_name TEXT NOT NULL,
    date_of_birth DATE NOT NULL,
    gender TEXT,
    marital_status TEXT,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    aadhaar_number TEXT,
    pan_number TEXT,
    
    -- Address Information (India-specific)
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    city TEXT NOT NULL,
    district TEXT,
    state TEXT NOT NULL,
    pin_code TEXT NOT NULL CHECK (LENGTH(pin_code) = 6),
    residence_type TEXT,
    years_at_address INTEGER,
    monthly_rent DECIMAL(12,2),
    
    -- Employment Information
    employment_type public.employment_type NOT NULL,
    employer_name TEXT,
    job_title TEXT,
    industry TEXT,
    years_employed INTEGER,
    annual_income DECIMAL(15,2) NOT NULL,
    monthly_income DECIMAL(12,2) NOT NULL,
    employer_phone TEXT,
    
    -- Financial Information (INR)
    loan_purpose public.loan_type NOT NULL,
    requested_loan_amount DECIMAL(15,2) NOT NULL,
    credit_score_range public.credit_score_range,
    monthly_debt_payments DECIMAL(12,2),
    total_assets DECIMAL(15,2),
    has_bankruptcy BOOLEAN DEFAULT false,
    has_foreclosure BOOLEAN DEFAULT false,
    has_tax_liens BOOLEAN DEFAULT false,
    has_co_signed_loans BOOLEAN DEFAULT false,
    
    -- Application Status
    status public.application_status DEFAULT 'draft'::public.application_status,
    selected_bank_id UUID REFERENCES public.banks(id),
    approval_probability INTEGER,
    
    -- Timestamps
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Agent Management
CREATE TABLE public.agents (
    id UUID PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    agent_code TEXT UNIQUE NOT NULL,
    status public.agent_status DEFAULT 'pending'::public.agent_status,
    total_clients INTEGER DEFAULT 0,
    total_commission DECIMAL(15,2) DEFAULT 0,
    success_rate DECIMAL(5,2) DEFAULT 0,
    joined_date DATE DEFAULT CURRENT_DATE,
    approved_by UUID REFERENCES public.user_profiles(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Audit Logs (Track all admin changes)
CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.user_profiles(id),
    action_type TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Localization Settings
CREATE TABLE public.localization_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key TEXT UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES public.user_profiles(id),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- STEP 3: INDEXES
-- ============================================

CREATE INDEX idx_user_profiles_email ON public.user_profiles(email);
CREATE INDEX idx_user_profiles_role ON public.user_profiles(role);
CREATE INDEX idx_banks_status ON public.banks(status);
CREATE INDEX idx_banks_display_priority ON public.banks(display_priority DESC);
CREATE INDEX idx_bank_products_bank_id ON public.bank_products(bank_id);
CREATE INDEX idx_bank_products_loan_type ON public.bank_products(loan_type);
CREATE INDEX idx_approval_matrix_bank_id ON public.approval_matrix_rules(bank_id);
CREATE INDEX idx_approval_matrix_active ON public.approval_matrix_rules(is_active);
CREATE INDEX idx_loan_applications_customer_id ON public.loan_applications(customer_id);
CREATE INDEX idx_loan_applications_status ON public.loan_applications(status);
CREATE INDEX idx_loan_applications_agent_id ON public.loan_applications(agent_id);
CREATE INDEX idx_loan_applications_application_number ON public.loan_applications(application_number);
CREATE INDEX idx_agents_status ON public.agents(status);
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- ============================================
-- STEP 4: FUNCTIONS (BEFORE RLS POLICIES)
-- ============================================

-- Trigger function to create user_profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, full_name, phone, role, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'phone', ''),
        COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'customer'::public.user_role),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
    );
    RETURN NEW;
END;
$$;

-- Function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin')
        AND is_active = true
    )
$$;

-- Function to check if user is employee or admin
CREATE OR REPLACE FUNCTION public.is_employee_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'employee')
        AND is_active = true
    )
$$;

-- Function to generate application number
CREATE OR REPLACE FUNCTION public.generate_application_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    new_number TEXT;
    year_part TEXT;
    sequence_part TEXT;
BEGIN
    year_part := TO_CHAR(CURRENT_DATE, 'YYYY');
    sequence_part := LPAD((SELECT COUNT(*) + 1 FROM public.loan_applications)::TEXT, 6, '0');
    new_number := 'APP-' || year_part || '-' || sequence_part;
    RETURN new_number;
END;
$$;

-- Function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- Function to calculate approval probability based on matrix rules
CREATE OR REPLACE FUNCTION public.calculate_approval_probability(
    p_bank_id UUID,
    p_loan_type public.loan_type,
    p_annual_income DECIMAL,
    p_employment_type public.employment_type,
    p_state TEXT,
    p_city TEXT,
    p_loan_amount DECIMAL,
    p_age INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    matching_probability INTEGER := 0;
BEGIN
    SELECT approval_probability INTO matching_probability
    FROM public.approval_matrix_rules
    WHERE bank_id = p_bank_id
    AND is_active = true
    AND (loan_type = p_loan_type OR loan_type IS NULL)
    AND (min_annual_income IS NULL OR p_annual_income >= min_annual_income)
    AND (max_annual_income IS NULL OR p_annual_income <= max_annual_income)
    AND (employment_types IS NULL OR p_employment_type = ANY(employment_types))
    AND (eligible_states IS NULL OR p_state = ANY(eligible_states))
    AND (eligible_cities IS NULL OR p_city = ANY(eligible_cities))
    AND (min_loan_amount IS NULL OR p_loan_amount >= min_loan_amount)
    AND (max_loan_amount IS NULL OR p_loan_amount <= max_loan_amount)
    AND (min_age IS NULL OR p_age >= min_age)
    AND (max_age IS NULL OR p_age <= max_age)
    ORDER BY priority DESC
    LIMIT 1;
    
    RETURN COALESCE(matching_probability, 50);
END;
$$;

-- ============================================
-- STEP 5: ENABLE RLS
-- ============================================

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indian_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_matrix_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.localization_settings ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 6: RLS POLICIES
-- ============================================

-- User Profiles Policies
CREATE POLICY "users_view_own_profile"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (id = auth.uid() OR public.is_employee_or_admin());

CREATE POLICY "users_update_own_profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

CREATE POLICY "admins_manage_all_profiles"
ON public.user_profiles
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Indian States Policies (Public read)
CREATE POLICY "public_read_states"
ON public.indian_states
FOR SELECT
TO public
USING (is_active = true);

CREATE POLICY "admins_manage_states"
ON public.indian_states
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Banks Policies
CREATE POLICY "public_read_active_banks"
ON public.banks
FOR SELECT
TO public
USING (status = 'active'::public.bank_status);

CREATE POLICY "admins_manage_banks"
ON public.banks
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Bank Products Policies
CREATE POLICY "public_read_active_products"
ON public.bank_products
FOR SELECT
TO public
USING (is_active = true);

CREATE POLICY "admins_manage_products"
ON public.bank_products
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Approval Matrix Policies
CREATE POLICY "authenticated_read_active_rules"
ON public.approval_matrix_rules
FOR SELECT
TO authenticated
USING (is_active = true);

CREATE POLICY "admins_manage_rules"
ON public.approval_matrix_rules
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Loan Applications Policies
CREATE POLICY "customers_view_own_applications"
ON public.loan_applications
FOR SELECT
TO authenticated
USING (customer_id = auth.uid() OR public.is_employee_or_admin());

CREATE POLICY "customers_create_applications"
ON public.loan_applications
FOR INSERT
TO authenticated
WITH CHECK (customer_id = auth.uid());

CREATE POLICY "customers_update_own_draft_applications"
ON public.loan_applications
FOR UPDATE
TO authenticated
USING (customer_id = auth.uid() AND status = 'draft'::public.application_status)
WITH CHECK (customer_id = auth.uid());

CREATE POLICY "employees_manage_applications"
ON public.loan_applications
FOR ALL
TO authenticated
USING (public.is_employee_or_admin())
WITH CHECK (public.is_employee_or_admin());

-- Agents Policies
CREATE POLICY "agents_view_own_profile"
ON public.agents
FOR SELECT
TO authenticated
USING (id = auth.uid() OR public.is_admin());

CREATE POLICY "admins_manage_agents"
ON public.agents
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Audit Logs Policies
CREATE POLICY "admins_view_audit_logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY "system_insert_audit_logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Localization Settings Policies
CREATE POLICY "public_read_localization"
ON public.localization_settings
FOR SELECT
TO public
USING (true);

CREATE POLICY "admins_manage_localization"
ON public.localization_settings
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- ============================================
-- STEP 7: TRIGGERS
-- ============================================

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_banks_updated_at
    BEFORE UPDATE ON public.banks
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_bank_products_updated_at
    BEFORE UPDATE ON public.bank_products
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_approval_matrix_updated_at
    BEFORE UPDATE ON public.approval_matrix_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_loan_applications_updated_at
    BEFORE UPDATE ON public.loan_applications
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- STEP 8: MOCK DATA
-- ============================================

DO $$
DECLARE
    admin_uuid UUID := gen_random_uuid();
    customer_uuid UUID := gen_random_uuid();
    agent_uuid UUID := gen_random_uuid();
    employee_uuid UUID := gen_random_uuid();
    
    bank1_uuid UUID := gen_random_uuid();
    bank2_uuid UUID := gen_random_uuid();
    bank3_uuid UUID := gen_random_uuid();
    bank4_uuid UUID := gen_random_uuid();
    bank5_uuid UUID := gen_random_uuid();
    bank6_uuid UUID := gen_random_uuid();
BEGIN
    -- Create auth users
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
         'admin@financeflow.com', crypt('admin123', gen_salt('bf', 10)), now(), now(), now(),
         '{"full_name": "Admin User", "role": "admin", "phone": "9876543210"}'::jsonb,
         '{"provider": "email", "providers": ["email"]}'::jsonb,
         false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null),
        (customer_uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'customer@example.com', crypt('customer123', gen_salt('bf', 10)), now(), now(), now(),
         '{"full_name": "Rajesh Kumar", "role": "customer", "phone": "9123456789"}'::jsonb,
         '{"provider": "email", "providers": ["email"]}'::jsonb,
         false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null),
        (agent_uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'agent@financeflow.com', crypt('agent123', gen_salt('bf', 10)), now(), now(), now(),
         '{"full_name": "Priya Sharma", "role": "agent", "phone": "9234567890"}'::jsonb,
         '{"provider": "email", "providers": ["email"]}'::jsonb,
         false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null),
        (employee_uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'employee@financeflow.com', crypt('employee123', gen_salt('bf', 10)), now(), now(), now(),
         '{"full_name": "Amit Patel", "role": "employee", "phone": "9345678901"}'::jsonb,
         '{"provider": "email", "providers": ["email"]}'::jsonb,
         false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null);

    -- Insert Indian States
    INSERT INTO public.indian_states (state_code, state_name) VALUES
        ('AN', 'Andaman and Nicobar Islands'),
        ('AP', 'Andhra Pradesh'),
        ('AR', 'Arunachal Pradesh'),
        ('AS', 'Assam'),
        ('BR', 'Bihar'),
        ('CH', 'Chandigarh'),
        ('CT', 'Chhattisgarh'),
        ('DN', 'Dadra and Nagar Haveli'),
        ('DD', 'Daman and Diu'),
        ('DL', 'Delhi'),
        ('GA', 'Goa'),
        ('GJ', 'Gujarat'),
        ('HR', 'Haryana'),
        ('HP', 'Himachal Pradesh'),
        ('JK', 'Jammu and Kashmir'),
        ('JH', 'Jharkhand'),
        ('KA', 'Karnataka'),
        ('KL', 'Kerala'),
        ('LD', 'Lakshadweep'),
        ('MP', 'Madhya Pradesh'),
        ('MH', 'Maharashtra'),
        ('MN', 'Manipur'),
        ('ML', 'Meghalaya'),
        ('MZ', 'Mizoram'),
        ('NL', 'Nagaland'),
        ('OR', 'Odisha'),
        ('PY', 'Puducherry'),
        ('PB', 'Punjab'),
        ('RJ', 'Rajasthan'),
        ('SK', 'Sikkim'),
        ('TN', 'Tamil Nadu'),
        ('TG', 'Telangana'),
        ('TR', 'Tripura'),
        ('UP', 'Uttar Pradesh'),
        ('UT', 'Uttarakhand'),
        ('WB', 'West Bengal');

    -- Insert Banks
    INSERT INTO public.banks (id, name, logo_url, logo_alt, bank_type, status, rating, reviews_count, customers_served, partnership_duration, certifications, display_priority, created_by) VALUES
        (bank1_uuid, 'State Bank of India', 'https://img.rocket.new/generatedImages/rocket_gen_img_110ddeab1-1767460670898.png', 'State Bank of India logo with blue and white colors', 'public', 'active', 4.8, 2450, '15,000+', 'Partner since 2018', ARRAY['RBI Approved', 'ISO 27001', 'PCI DSS'], 1, admin_uuid),
        (bank2_uuid, 'HDFC Bank', 'https://img.rocket.new/generatedImages/rocket_gen_img_1ff66e20f-1766487661200.png', 'HDFC Bank logo with red and blue colors', 'private', 'active', 4.6, 1890, '12,000+', 'Partner since 2019', ARRAY['RBI Approved', 'ISO 9001'], 2, admin_uuid),
        (bank3_uuid, 'ICICI Bank', 'https://img.rocket.new/generatedImages/rocket_gen_img_1bc64a9e1-1767006787399.png', 'ICICI Bank logo with orange and brown colors', 'private', 'active', 4.7, 3120, '20,000+', 'Partner since 2017', ARRAY['RBI Approved', 'ISO 27001', 'CRISIL AAA'], 3, admin_uuid),
        (bank4_uuid, 'Axis Bank', 'https://img.rocket.new/generatedImages/rocket_gen_img_1400c9c6b-1768453457893.png', 'Axis Bank logo with maroon and white colors', 'private', 'active', 4.5, 1650, '10,000+', 'Partner since 2020', ARRAY['RBI Approved', 'PCI DSS'], 4, admin_uuid),
        (bank5_uuid, 'Punjab National Bank', 'https://img.rocket.new/generatedImages/rocket_gen_img_1588d351f-1768453457885.png', 'Punjab National Bank logo with blue and orange colors', 'public', 'active', 4.4, 980, '8,000+', 'Partner since 2021', ARRAY['RBI Approved', 'ISO 27001'], 5, admin_uuid),
        (bank6_uuid, 'Kotak Mahindra Bank', 'https://img.rocket.new/generatedImages/rocket_gen_img_120bfcc1a-1768453457449.png', 'Kotak Mahindra Bank logo with red color', 'private', 'active', 4.9, 4200, '25,000+', 'Partner since 2016', ARRAY['RBI Approved', 'ISO 27001', 'Basel III Compliant'], 6, admin_uuid);

    -- Insert Bank Products
    INSERT INTO public.bank_products (bank_id, loan_type, interest_rate_min, interest_rate_max, processing_fee_percentage, max_loan_amount, max_tenure_years, features, required_documents, is_active) VALUES
        (bank1_uuid, 'home_loan', 7.5, 8.5, 1.0, 20000000, 20, ARRAY['Zero prepayment charges after 6 months', 'Doorstep document collection', 'Quick approval within 48 hours', 'Flexible repayment options'], ARRAY['Aadhaar Card', 'PAN Card', 'Income Proof', 'Property Documents'], true),
        (bank2_uuid, 'personal_loan', 10.5, 12.5, 2.0, 2500000, 5, ARRAY['Instant approval', 'No collateral required', 'Flexible tenure', 'Quick disbursal'], ARRAY['Aadhaar Card', 'PAN Card', 'Salary Slips', 'Bank Statements'], true),
        (bank3_uuid, 'business_loan', 9.0, 11.0, 1.5, 50000000, 10, ARRAY['Working capital support', 'Equipment financing', 'Business expansion loans', 'Overdraft facility'], ARRAY['Business Registration', 'GST Returns', 'ITR', 'Bank Statements'], true),
        (bank4_uuid, 'auto_loan', 8.5, 10.5, 0.5, 2000000, 7, ARRAY['Up to 90% financing', 'Quick approval', 'Flexible repayment', 'Insurance included'], ARRAY['Aadhaar Card', 'PAN Card', 'Income Proof', 'Vehicle Quotation'], true),
        (bank5_uuid, 'education_loan', 7.0, 9.0, 0.0, 10000000, 15, ARRAY['No collateral for loans up to 7.5 lakhs', 'Moratorium period', 'Tax benefits', 'Covers tuition and living expenses'], ARRAY['Admission Letter', 'Fee Structure', 'Aadhaar Card', 'PAN Card', 'Income Proof'], true),
        (bank6_uuid, 'home_loan', 7.2, 8.2, 0.5, 30000000, 30, ARRAY['Lowest interest rates', 'Balance transfer facility', 'Top-up loans', 'Digital loan management'], ARRAY['Aadhaar Card', 'PAN Card', 'Income Proof', 'Property Documents'], true);

    -- Insert Approval Matrix Rules
    INSERT INTO public.approval_matrix_rules (bank_id, rule_name, loan_type, min_annual_income, min_credit_score, employment_types, approval_probability, is_active, priority, created_by) VALUES
        (bank1_uuid, 'SBI High Income Salaried', 'home_loan', 1200000, 750, ARRAY['salaried']::public.employment_type[], 92, true, 1, admin_uuid),
        (bank2_uuid, 'HDFC Medium Income', 'personal_loan', 600000, 700, ARRAY['salaried', 'self_employed']::public.employment_type[], 85, true, 2, admin_uuid),
        (bank3_uuid, 'ICICI Business Premium', 'business_loan', 2000000, 720, ARRAY['business_owner', 'self_employed']::public.employment_type[], 78, true, 3, admin_uuid),
        (bank4_uuid, 'Axis Auto Standard', 'auto_loan', 500000, 680, ARRAY['salaried', 'self_employed']::public.employment_type[], 88, true, 4, admin_uuid),
        (bank5_uuid, 'PNB Education Basic', 'education_loan', 400000, 650, ARRAY['salaried', 'self_employed']::public.employment_type[], 90, true, 5, admin_uuid),
        (bank6_uuid, 'Kotak Premium Home', 'home_loan', 1500000, 780, ARRAY['salaried', 'professional']::public.employment_type[], 72, true, 6, admin_uuid);

    -- Insert Agent
    INSERT INTO public.agents (id, agent_code, status, total_clients, total_commission, success_rate, approved_by, approved_at) VALUES
        (agent_uuid, 'AGT-001', 'active', 45, 125000, 92.5, admin_uuid, now());

    -- Insert Localization Settings
    INSERT INTO public.localization_settings (setting_key, setting_value, description, updated_by) VALUES
        ('default_country', 'India', 'Default country for all users', admin_uuid),
        ('currency_symbol', '₹', 'Indian Rupee symbol', admin_uuid),
        ('currency_code', 'INR', 'Indian Rupee code', admin_uuid),
        ('phone_format', '10_digit', 'Indian mobile number format', admin_uuid),
        ('pin_code_length', '6', 'Indian PIN code length', admin_uuid);

    RAISE NOTICE 'Mock data created successfully';
END $$;