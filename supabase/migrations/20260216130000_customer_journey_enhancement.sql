-- Customer Journey Enhancement Migration
-- Adds: Eligibility assessments, Document tracking, Application workflow, Storage bucket

-- ============================================
-- STEP 1: CUSTOM TYPES
-- ============================================

DROP TYPE IF EXISTS public.document_status CASCADE;
CREATE TYPE public.document_status AS ENUM ('required', 'pending', 'verified', 'rejected');

DROP TYPE IF EXISTS public.document_type CASCADE;
CREATE TYPE public.document_type AS ENUM ('identity_proof', 'address_proof', 'income_proof', 'bank_statement', 'tax_return', 'employment_letter', 'other');

DROP TYPE IF EXISTS public.eligibility_status CASCADE;
CREATE TYPE public.eligibility_status AS ENUM ('high', 'medium', 'low');

-- ============================================
-- STEP 2: CORE TABLES
-- ============================================

-- Eligibility Assessments
CREATE TABLE IF NOT EXISTS public.eligibility_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    loan_type public.loan_type NOT NULL,
    loan_amount DECIMAL(15,2) NOT NULL,
    monthly_income DECIMAL(12,2) NOT NULL,
    employment_type public.employment_type NOT NULL,
    credit_score_range public.credit_score_range,
    existing_loans DECIMAL(12,2) DEFAULT 0,
    eligibility_score INTEGER CHECK (eligibility_score >= 0 AND eligibility_score <= 100),
    eligibility_status public.eligibility_status,
    eligible_amount DECIMAL(15,2),
    message TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Customer Documents
CREATE TABLE IF NOT EXISTS public.customer_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    application_id UUID REFERENCES public.loan_applications(id) ON DELETE CASCADE,
    document_type public.document_type NOT NULL,
    document_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    mime_type TEXT,
    status public.document_status DEFAULT 'pending'::public.document_status,
    rejection_reason TEXT,
    uploaded_by UUID REFERENCES public.user_profiles(id),
    verified_by UUID REFERENCES public.user_profiles(id),
    uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Application Timeline
CREATE TABLE IF NOT EXISTS public.application_timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID REFERENCES public.loan_applications(id) ON DELETE CASCADE,
    status public.application_status NOT NULL,
    message TEXT NOT NULL,
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Customer Notifications
CREATE TABLE IF NOT EXISTS public.customer_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    source TEXT,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- STEP 3: INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_eligibility_assessments_customer_id ON public.eligibility_assessments(customer_id);
CREATE INDEX IF NOT EXISTS idx_eligibility_assessments_created_at ON public.eligibility_assessments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_documents_customer_id ON public.customer_documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_documents_application_id ON public.customer_documents(application_id);
CREATE INDEX IF NOT EXISTS idx_customer_documents_status ON public.customer_documents(status);
CREATE INDEX IF NOT EXISTS idx_application_timeline_application_id ON public.application_timeline(application_id);
CREATE INDEX IF NOT EXISTS idx_application_timeline_created_at ON public.application_timeline(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_notifications_customer_id ON public.customer_notifications(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_notifications_is_read ON public.customer_notifications(is_read);

-- ============================================
-- STEP 4: FUNCTIONS (BEFORE RLS POLICIES)
-- ============================================

-- Function to create timeline entry when application status changes
CREATE OR REPLACE FUNCTION public.create_application_timeline_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
        INSERT INTO public.application_timeline (application_id, status, message, created_by)
        VALUES (
            NEW.id,
            NEW.status,
            CASE NEW.status
                WHEN 'submitted'::public.application_status THEN 'Application submitted successfully'
                WHEN 'under_review'::public.application_status THEN 'Application is under review'
                WHEN 'documents_pending'::public.application_status THEN 'Additional documents required'
                WHEN 'approved'::public.application_status THEN 'Application approved'
                WHEN 'rejected'::public.application_status THEN 'Application rejected'
                WHEN 'disbursed'::public.application_status THEN 'Loan disbursed'
                ELSE 'Status updated'
            END,
            NEW.customer_id
        );
    END IF;
    RETURN NEW;
END;
$$;

-- Function to create notification when document status changes
CREATE OR REPLACE FUNCTION public.create_document_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
        INSERT INTO public.customer_notifications (customer_id, notification_type, title, message, source)
        VALUES (
            NEW.customer_id,
            'document_update',
            CASE NEW.status
                WHEN 'verified'::public.document_status THEN 'Document Verified'
                WHEN 'rejected'::public.document_status THEN 'Document Rejected'
                ELSE 'Document Status Updated'
            END,
            CASE NEW.status
                WHEN 'verified'::public.document_status THEN 'Your ' || NEW.document_name || ' has been verified'
                WHEN 'rejected'::public.document_status THEN 'Your ' || NEW.document_name || ' was rejected. ' || COALESCE(NEW.rejection_reason, 'Please re-upload')
                ELSE 'Document status updated to ' || NEW.status::TEXT
            END,
            'Document Management'
        );
    END IF;
    RETURN NEW;
END;
$$;

-- ============================================
-- STEP 5: ENABLE RLS
-- ============================================

ALTER TABLE public.eligibility_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 6: RLS POLICIES
-- ============================================

-- Eligibility Assessments Policies
DROP POLICY IF EXISTS "users_manage_own_eligibility_assessments" ON public.eligibility_assessments;
CREATE POLICY "users_manage_own_eligibility_assessments"
ON public.eligibility_assessments
FOR ALL
TO authenticated
USING (customer_id = auth.uid())
WITH CHECK (customer_id = auth.uid());

-- Customer Documents Policies
DROP POLICY IF EXISTS "users_manage_own_customer_documents" ON public.customer_documents;
CREATE POLICY "users_manage_own_customer_documents"
ON public.customer_documents
FOR ALL
TO authenticated
USING (customer_id = auth.uid())
WITH CHECK (customer_id = auth.uid());

-- Application Timeline Policies
DROP POLICY IF EXISTS "users_view_own_application_timeline" ON public.application_timeline;
CREATE POLICY "users_view_own_application_timeline"
ON public.application_timeline
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.loan_applications la
        WHERE la.id = application_timeline.application_id
        AND la.customer_id = auth.uid()
    )
);

-- Customer Notifications Policies
DROP POLICY IF EXISTS "users_manage_own_customer_notifications" ON public.customer_notifications;
CREATE POLICY "users_manage_own_customer_notifications"
ON public.customer_notifications
FOR ALL
TO authenticated
USING (customer_id = auth.uid())
WITH CHECK (customer_id = auth.uid());

-- ============================================
-- STEP 7: TRIGGERS
-- ============================================

DROP TRIGGER IF EXISTS on_application_status_change ON public.loan_applications;
CREATE TRIGGER on_application_status_change
    AFTER UPDATE ON public.loan_applications
    FOR EACH ROW
    EXECUTE FUNCTION public.create_application_timeline_entry();

DROP TRIGGER IF EXISTS on_document_status_change ON public.customer_documents;
CREATE TRIGGER on_document_status_change
    AFTER UPDATE ON public.customer_documents
    FOR EACH ROW
    EXECUTE FUNCTION public.create_document_notification();

-- ============================================
-- STEP 8: STORAGE BUCKET
-- ============================================

-- Create private bucket for customer documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'customer-documents',
    'customer-documents',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: Users access only their documents
DROP POLICY IF EXISTS "users_manage_own_documents" ON storage.objects;
CREATE POLICY "users_manage_own_documents"
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'customer-documents' AND (storage.foldername(name))[1] = auth.uid()::TEXT)
WITH CHECK (bucket_id = 'customer-documents' AND (storage.foldername(name))[1] = auth.uid()::TEXT);

-- ============================================
-- STEP 9: MOCK DATA
-- ============================================

DO $$
DECLARE
    existing_customer_id UUID;
    existing_application_id UUID;
    assessment_id UUID;
BEGIN
    -- Get existing customer user
    SELECT id INTO existing_customer_id 
    FROM public.user_profiles 
    WHERE role = 'customer'::public.user_role 
    LIMIT 1;
    
    IF existing_customer_id IS NOT NULL THEN
        -- Create eligibility assessment
        INSERT INTO public.eligibility_assessments (
            id, customer_id, loan_type, loan_amount, monthly_income, 
            employment_type, credit_score_range, existing_loans,
            eligibility_score, eligibility_status, eligible_amount, message
        ) VALUES (
            gen_random_uuid(),
            existing_customer_id,
            'personal_loan'::public.loan_type,
            500000,
            75000,
            'salaried'::public.employment_type,
            'good'::public.credit_score_range,
            0,
            85,
            'high'::public.eligibility_status,
            600000,
            'Excellent! You have high chances of loan approval with competitive interest rates.'
        )
        ON CONFLICT (id) DO NOTHING;
        
        -- Get existing application
        SELECT id INTO existing_application_id
        FROM public.loan_applications
        WHERE customer_id = existing_customer_id
        LIMIT 1;
        
        IF existing_application_id IS NOT NULL THEN
            -- Create sample documents
            INSERT INTO public.customer_documents (
                customer_id, application_id, document_type, document_name,
                file_path, file_size, mime_type, status
            ) VALUES
                (
                    existing_customer_id,
                    existing_application_id,
                    'identity_proof'::public.document_type,
                    'Aadhaar Card',
                    existing_customer_id::TEXT || '/aadhaar.pdf',
                    2457600,
                    'application/pdf',
                    'verified'::public.document_status
                ),
                (
                    existing_customer_id,
                    existing_application_id,
                    'income_proof'::public.document_type,
                    'Salary Slip - December 2025',
                    existing_customer_id::TEXT || '/salary-slip.pdf',
                    1048576,
                    'application/pdf',
                    'verified'::public.document_status
                ),
                (
                    existing_customer_id,
                    existing_application_id,
                    'bank_statement'::public.document_type,
                    'Bank Statement - November 2025',
                    existing_customer_id::TEXT || '/bank-statement.pdf',
                    3145728,
                    'application/pdf',
                    'pending'::public.document_status
                )
            ON CONFLICT (id) DO NOTHING;
            
            -- Create timeline entries
            INSERT INTO public.application_timeline (
                application_id, status, message, created_by
            ) VALUES
                (
                    existing_application_id,
                    'submitted'::public.application_status,
                    'Application submitted successfully',
                    existing_customer_id
                ),
                (
                    existing_application_id,
                    'under_review'::public.application_status,
                    'Application is under review by our team',
                    existing_customer_id
                )
            ON CONFLICT (id) DO NOTHING;
            
            -- Create notifications
            INSERT INTO public.customer_notifications (
                customer_id, notification_type, title, message, source, is_read
            ) VALUES
                (
                    existing_customer_id,
                    'status_update',
                    'Application Under Review',
                    'Your loan application is currently being reviewed by our team.',
                    'Application System',
                    false
                ),
                (
                    existing_customer_id,
                    'document_update',
                    'Documents Verified',
                    'Your Aadhaar Card and Salary Slip have been verified successfully.',
                    'Document Management',
                    false
                )
            ON CONFLICT (id) DO NOTHING;
        END IF;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Mock data insertion failed: %', SQLERRM;
END $$;