-- =====================================================
-- DOCUMENT STORAGE AND MANAGEMENT ENHANCEMENT
-- Purpose: Add storage bucket and comprehensive document management
-- =====================================================

-- 1. CREATE STORAGE BUCKET FOR CUSTOMER DOCUMENTS
-- =====================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'customer-documents',
  'customer-documents',
  true,
  10485760, -- 10MB limit
  ARRAY['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

-- 2. STORAGE RLS POLICIES FOR customer-documents BUCKET
-- =====================================================

-- Drop existing policies if any
DROP POLICY IF EXISTS "customers_upload_own_documents" ON storage.objects;
DROP POLICY IF EXISTS "customers_view_own_documents" ON storage.objects;
DROP POLICY IF EXISTS "employees_manage_all_documents" ON storage.objects;
DROP POLICY IF EXISTS "admins_full_access_documents" ON storage.objects;
DROP POLICY IF EXISTS "agents_view_client_documents" ON storage.objects;

-- Customers can upload their own documents
CREATE POLICY "customers_upload_own_documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'customer-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Customers can view and update their own documents
CREATE POLICY "customers_view_own_documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'customer-documents' AND
  (
    (storage.foldername(name))[1] = auth.uid()::text OR
    public.is_employee() OR
    public.is_admin()
  )
);

-- Customers can delete their own documents
CREATE POLICY "customers_delete_own_documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'customer-documents' AND
  (
    (storage.foldername(name))[1] = auth.uid()::text OR
    public.is_employee() OR
    public.is_admin()
  )
);

-- Employees can manage all documents
CREATE POLICY "employees_manage_all_documents"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'customer-documents' AND
  public.is_employee()
)
WITH CHECK (
  bucket_id = 'customer-documents' AND
  public.is_employee()
);

-- Admins have full access to all documents
CREATE POLICY "admins_full_access_documents"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'customer-documents' AND
  public.is_admin()
)
WITH CHECK (
  bucket_id = 'customer-documents' AND
  public.is_admin()
);

-- Agents can view documents for their clients
CREATE POLICY "agents_view_client_documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'customer-documents' AND
  public.is_agent()
);

-- 3. ADD MISSING COLUMNS TO customer_documents TABLE
-- =====================================================

-- Add document_url column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'customer_documents'
    AND column_name = 'document_url'
  ) THEN
    ALTER TABLE public.customer_documents
    ADD COLUMN document_url TEXT;
  END IF;
END $$;

-- Add verification_status column if not exists (rename from status)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'customer_documents'
    AND column_name = 'verification_status'
  ) THEN
    ALTER TABLE public.customer_documents
    ADD COLUMN verification_status TEXT DEFAULT 'pending';
    
    -- Copy data from status column if it exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'customer_documents'
      AND column_name = 'status'
    ) THEN
      UPDATE public.customer_documents
      SET verification_status = status;
    END IF;
  END IF;
END $$;

-- Add reupload_reason column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'customer_documents'
    AND column_name = 'reupload_reason'
  ) THEN
    ALTER TABLE public.customer_documents
    ADD COLUMN reupload_reason TEXT;
  END IF;
END $$;

-- Add requested_by column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'customer_documents'
    AND column_name = 'requested_by'
  ) THEN
    ALTER TABLE public.customer_documents
    ADD COLUMN requested_by UUID REFERENCES auth.users(id);
  END IF;
END $$;

-- Add requested_at column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'customer_documents'
    AND column_name = 'requested_at'
  ) THEN
    ALTER TABLE public.customer_documents
    ADD COLUMN requested_at TIMESTAMPTZ;
  END IF;
END $$;

-- 4. ENHANCE RLS POLICIES FOR customer_documents TABLE
-- =====================================================

-- Drop existing policies
DROP POLICY IF EXISTS "customers_manage_own_documents" ON public.customer_documents;
DROP POLICY IF EXISTS "employees_manage_documents" ON public.customer_documents;
DROP POLICY IF EXISTS "admins_full_access_documents" ON public.customer_documents;
DROP POLICY IF EXISTS "agents_view_client_documents" ON public.customer_documents;

-- Customers can manage their own documents
CREATE POLICY "customers_manage_own_documents"
ON public.customer_documents
FOR ALL
TO authenticated
USING (customer_id = auth.uid())
WITH CHECK (customer_id = auth.uid());

-- Employees can view and manage all documents
CREATE POLICY "employees_manage_documents"
ON public.customer_documents
FOR ALL
TO authenticated
USING (public.is_employee())
WITH CHECK (public.is_employee());

-- Admins have full access to all documents
CREATE POLICY "admins_full_access_documents"
ON public.customer_documents
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Agents can view documents for applications they're assigned to
CREATE POLICY "agents_view_client_documents"
ON public.customer_documents
FOR SELECT
TO authenticated
USING (
  public.is_agent() AND
  EXISTS (
    SELECT 1 FROM public.loan_applications
    WHERE loan_applications.id = customer_documents.application_id
    AND loan_applications.agent_id = auth.uid()
  )
);