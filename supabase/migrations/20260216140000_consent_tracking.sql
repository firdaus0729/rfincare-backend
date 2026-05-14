-- Consent Tracking Migration
-- Adds: Application consent tracking table

-- ============================================
-- STEP 1: CUSTOM TYPES
-- ============================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consent_type') THEN
    CREATE TYPE public.consent_type AS ENUM (
      'data_sharing',
      'credit_check',
      'terms_conditions',
      'privacy_policy',
      'communication_consent',
      'marketing_consent'
    );
  END IF;
END $$;

-- ============================================
-- STEP 2: TABLES
-- ============================================

-- Application Consents
CREATE TABLE IF NOT EXISTS public.application_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID REFERENCES public.loan_applications(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    consent_type public.consent_type NOT NULL,
    is_granted BOOLEAN DEFAULT false,
    granted_at TIMESTAMPTZ,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- OTP Verifications
CREATE TABLE IF NOT EXISTS public.otp_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    application_id UUID REFERENCES public.loan_applications(id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    email TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    is_verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- STEP 3: INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_application_consents_application_id ON public.application_consents(application_id);
CREATE INDEX IF NOT EXISTS idx_application_consents_customer_id ON public.application_consents(customer_id);
CREATE INDEX IF NOT EXISTS idx_otp_verifications_customer_id ON public.otp_verifications(customer_id);
CREATE INDEX IF NOT EXISTS idx_otp_verifications_application_id ON public.otp_verifications(application_id);
CREATE INDEX IF NOT EXISTS idx_otp_verifications_expires_at ON public.otp_verifications(expires_at);

-- ============================================
-- STEP 4: RLS POLICIES
-- ============================================

ALTER TABLE public.application_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_verifications ENABLE ROW LEVEL SECURITY;

-- Application Consents Policies
DROP POLICY IF EXISTS "Customers can view their own consents" ON public.application_consents;
CREATE POLICY "Customers can view their own consents"
  ON public.application_consents FOR SELECT
  USING (auth.uid() = customer_id);

DROP POLICY IF EXISTS "Customers can insert their own consents" ON public.application_consents;
CREATE POLICY "Customers can insert their own consents"
  ON public.application_consents FOR INSERT
  WITH CHECK (auth.uid() = customer_id);

DROP POLICY IF EXISTS "Admins and employees can view all consents" ON public.application_consents;
CREATE POLICY "Admins and employees can view all consents"
  ON public.application_consents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
      AND role IN ('super_admin', 'admin', 'employee')
    )
  );

-- OTP Verifications Policies
DROP POLICY IF EXISTS "Customers can view their own OTP records" ON public.otp_verifications;
CREATE POLICY "Customers can view their own OTP records"
  ON public.otp_verifications FOR SELECT
  USING (auth.uid() = customer_id);

DROP POLICY IF EXISTS "Customers can insert their own OTP records" ON public.otp_verifications;
CREATE POLICY "Customers can insert their own OTP records"
  ON public.otp_verifications FOR INSERT
  WITH CHECK (auth.uid() = customer_id);

DROP POLICY IF EXISTS "Customers can update their own OTP records" ON public.otp_verifications;
CREATE POLICY "Customers can update their own OTP records"
  ON public.otp_verifications FOR UPDATE
  USING (auth.uid() = customer_id);

-- ============================================
-- STEP 5: FUNCTIONS
-- ============================================

-- Function to clean up expired OTPs
CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.otp_verifications
  WHERE expires_at < CURRENT_TIMESTAMP
  AND is_verified = false;
END;
$$;

-- ============================================
-- STEP 6: TRIGGERS
-- ============================================

-- Update timestamp trigger for application_consents
DROP TRIGGER IF EXISTS update_application_consents_updated_at ON public.application_consents;
CREATE TRIGGER update_application_consents_updated_at
  BEFORE UPDATE ON public.application_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();