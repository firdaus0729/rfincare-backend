-- Employee Workflow Enhancement Migration
-- Adds employee activity logging, enhanced agent verification, and application tracking

-- ============================================
-- STEP 1: CREATE EMPLOYEE ACTIVITY LOG TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS public.employee_activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    description TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- STEP 2: ADD COLUMNS TO AGENT_ONBOARDING
-- ============================================

DO $$
BEGIN
    -- Add bank verification columns if they don't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'agent_onboarding'
                   AND column_name = 'bank_verification_status') THEN
        ALTER TABLE public.agent_onboarding
        ADD COLUMN bank_verification_status TEXT DEFAULT 'pending'
        CHECK (bank_verification_status IN ('pending', 'verified', 'rejected'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'agent_onboarding'
                   AND column_name = 'bank_verification_notes') THEN
        ALTER TABLE public.agent_onboarding ADD COLUMN bank_verification_notes TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'agent_onboarding'
                   AND column_name = 'bank_verified_by') THEN
        ALTER TABLE public.agent_onboarding
        ADD COLUMN bank_verified_by UUID REFERENCES public.user_profiles(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'agent_onboarding'
                   AND column_name = 'bank_verified_at') THEN
        ALTER TABLE public.agent_onboarding ADD COLUMN bank_verified_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'agent_onboarding'
                   AND column_name = 'approved_by') THEN
        ALTER TABLE public.agent_onboarding
        ADD COLUMN approved_by UUID REFERENCES public.user_profiles(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'agent_onboarding'
                   AND column_name = 'approved_at') THEN
        ALTER TABLE public.agent_onboarding ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'agent_onboarding'
                   AND column_name = 'reviewed_by') THEN
        ALTER TABLE public.agent_onboarding
        ADD COLUMN reviewed_by UUID REFERENCES public.user_profiles(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'agent_onboarding'
                   AND column_name = 'reviewed_at') THEN
        ALTER TABLE public.agent_onboarding ADD COLUMN reviewed_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'agent_onboarding'
                   AND column_name = 'rejection_reason') THEN
        ALTER TABLE public.agent_onboarding ADD COLUMN rejection_reason TEXT;
    END IF;
END $$;

-- ============================================
-- STEP 3: ADD COLUMNS TO LOAN_APPLICATIONS
-- ============================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'loan_applications'
                   AND column_name = 'eligibility_status') THEN
        ALTER TABLE public.loan_applications
        ADD COLUMN eligibility_status TEXT DEFAULT 'pending'
        CHECK (eligibility_status IN ('pending', 'eligible', 'partially_eligible', 'not_eligible'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'loan_applications'
                   AND column_name = 'status_notes') THEN
        ALTER TABLE public.loan_applications ADD COLUMN status_notes TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'loan_applications'
                   AND column_name = 'updated_by') THEN
        ALTER TABLE public.loan_applications
        ADD COLUMN updated_by UUID REFERENCES public.user_profiles(id);
    END IF;
END $$;

-- ============================================
-- STEP 4: CREATE CUSTOMER_DOCUMENTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS public.customer_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    application_id UUID REFERENCES public.loan_applications(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    document_url TEXT NOT NULL,
    document_name TEXT,
    file_size INTEGER,
    verification_status TEXT DEFAULT 'pending'
        CHECK (verification_status IN ('pending', 'verified', 'rejected', 'reupload_required')),
    verification_notes TEXT,
    verified_by UUID REFERENCES public.user_profiles(id),
    verified_at TIMESTAMPTZ,
    quality_checks JSONB,
    rejection_reason TEXT,
    reupload_reason TEXT,
    requested_by UUID REFERENCES public.user_profiles(id),
    requested_at TIMESTAMPTZ,
    uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- STEP 5: CREATE NOTIFICATIONS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL,
    related_entity_type TEXT,
    related_entity_id UUID,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- STEP 6: INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_employee_activity_log_employee_id
    ON public.employee_activity_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_activity_log_created_at
    ON public.employee_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_activity_log_action_type
    ON public.employee_activity_log(action_type);

CREATE INDEX IF NOT EXISTS idx_customer_documents_customer_id
    ON public.customer_documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_documents_application_id
    ON public.customer_documents(application_id);
CREATE INDEX IF NOT EXISTS idx_customer_documents_verification_status
    ON public.customer_documents(verification_status);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
    ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read
    ON public.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
    ON public.notifications(created_at DESC);

-- ============================================
-- STEP 7: ENABLE RLS
-- ============================================

ALTER TABLE public.employee_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 8: RLS POLICIES
-- ============================================

-- Employee Activity Log Policies
CREATE POLICY "employees_view_own_activity_log"
ON public.employee_activity_log
FOR SELECT
TO authenticated
USING (employee_id = auth.uid());

CREATE POLICY "employees_insert_own_activity_log"
ON public.employee_activity_log
FOR INSERT
TO authenticated
WITH CHECK (employee_id = auth.uid());

CREATE POLICY "admins_view_all_activity_logs"
ON public.employee_activity_log
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
);

-- Customer Documents Policies
CREATE POLICY "customers_manage_own_documents"
ON public.customer_documents
FOR ALL
TO authenticated
USING (customer_id = auth.uid())
WITH CHECK (customer_id = auth.uid());

CREATE POLICY "employees_view_assigned_documents"
ON public.customer_documents
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.loan_applications
        WHERE id = customer_documents.application_id
        AND assigned_employee_id = auth.uid()
    )
);

CREATE POLICY "employees_update_document_verification"
ON public.customer_documents
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role IN ('employee', 'admin', 'super_admin')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role IN ('employee', 'admin', 'super_admin')
    )
);

-- Notifications Policies
CREATE POLICY "users_view_own_notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "users_update_own_notifications"
ON public.notifications
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "system_create_notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (true);

-- ============================================
-- STEP 9: UPDATE EXISTING RLS POLICIES
-- ============================================

-- Allow employees to view applications assigned to them
DROP POLICY IF EXISTS "employees_view_assigned_applications" ON public.loan_applications;
CREATE POLICY "employees_view_assigned_applications"
ON public.loan_applications
FOR SELECT
TO authenticated
USING (
    assigned_employee_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
);

-- Allow employees to update applications assigned to them
DROP POLICY IF EXISTS "employees_update_assigned_applications" ON public.loan_applications;
CREATE POLICY "employees_update_assigned_applications"
ON public.loan_applications
FOR UPDATE
TO authenticated
USING (
    assigned_employee_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
)
WITH CHECK (
    assigned_employee_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
);