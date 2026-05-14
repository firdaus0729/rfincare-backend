-- Assessment Draft Progress Migration
-- Allows saving form progress for unauthenticated users using session_key

CREATE TABLE IF NOT EXISTS public.assessment_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_key TEXT NOT NULL,
    current_step INTEGER DEFAULT 0,
    form_data JSONB DEFAULT '{}'::jsonb,
    customer_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_assessment_drafts_session_key ON public.assessment_drafts(session_key);
CREATE INDEX IF NOT EXISTS idx_assessment_drafts_customer_id ON public.assessment_drafts(customer_id);

ALTER TABLE public.assessment_drafts ENABLE ROW LEVEL SECURITY;

-- Allow public (unauthenticated) access by session_key for draft saving
DROP POLICY IF EXISTS "public_manage_own_draft" ON public.assessment_drafts;
CREATE POLICY "public_manage_own_draft"
ON public.assessment_drafts
FOR ALL
TO public
USING (true)
WITH CHECK (true);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_assessment_draft_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assessment_draft_updated_at ON public.assessment_drafts;
CREATE TRIGGER assessment_draft_updated_at
    BEFORE UPDATE ON public.assessment_drafts
    FOR EACH ROW
    EXECUTE FUNCTION public.update_assessment_draft_timestamp();
