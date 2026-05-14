-- Admin Journey Enhancement Migration
-- Creates admin user with hardcoded credentials and enhances admin functionality

-- Create admin user with hardcoded credentials (Redfin26/Pass@2026)
-- Note: This will be executed after migration is applied
DO $$
DECLARE
  admin_user_id uuid;
  admin_email text := 'admin@rfincare.com';
  admin_username text := 'Redfin26';
  admin_password text := 'Pass@2026';
BEGIN
  -- Check if admin user already exists
  SELECT id INTO admin_user_id FROM auth.users WHERE email = admin_email;
  
  IF admin_user_id IS NULL THEN
    -- Create admin user in auth.users (using Supabase auth)
    -- Note: Password will be set via Supabase dashboard or API
    INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      admin_email,
      crypt(admin_password, gen_salt('bf')),
      now(),
      now(),
      now()
    )
    RETURNING id INTO admin_user_id;
    
    -- Create user profile for admin
    INSERT INTO public.user_profiles (
      id,
      email,
      full_name,
      role,
      account_status,
      is_active,
      created_at,
      updated_at
    ) VALUES (
      admin_user_id,
      admin_email,
      'Super Admin',
      'super_admin',
      'active',
      true,
      now(),
      now()
    )
    ON CONFLICT (id) DO NOTHING;
    
    -- Create admin onboarding record
    INSERT INTO public.employee_onboarding (
      user_id,
      username,
      employee_name,
      employee_code,
      email,
      mobile_number,
      account_number,
      bank_name,
      ifsc_code,
      onboarding_status,
      created_at
    ) VALUES (
      admin_user_id,
      admin_username,
      'Super Admin',
      'ADMIN001',
      admin_email,
      '+919999999999',
      'ADMIN000000001',
      'System Account',
      'SYSTEM0000',
      'active',
      now()
    )
    ON CONFLICT (username) DO NOTHING;
  END IF;
END $$;

-- Enhance audit_logs table for comprehensive tracking
ALTER TABLE IF EXISTS public.audit_logs ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE IF EXISTS public.audit_logs ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE IF EXISTS public.audit_logs ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE IF EXISTS public.audit_logs ADD COLUMN IF NOT EXISTS severity text DEFAULT 'info';
ALTER TABLE IF EXISTS public.audit_logs ADD COLUMN IF NOT EXISTS category text DEFAULT 'general';

-- Create system_configuration table
CREATE TABLE IF NOT EXISTS public.system_configuration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text UNIQUE NOT NULL,
  config_value jsonb NOT NULL,
  config_type text NOT NULL, -- 'string', 'number', 'boolean', 'json'
  category text NOT NULL, -- 'general', 'security', 'email', 'sms', 'payment'
  description text,
  is_sensitive boolean DEFAULT false,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Insert default system configurations
INSERT INTO public.system_configuration (config_key, config_value, config_type, category, description) VALUES
  ('max_login_attempts', '5', 'number', 'security', 'Maximum failed login attempts before account lock'),
  ('session_timeout_minutes', '30', 'number', 'security', 'Session timeout in minutes'),
  ('password_min_length', '8', 'number', 'security', 'Minimum password length'),
  ('enable_2fa', 'false', 'boolean', 'security', 'Enable two-factor authentication'),
  ('application_approval_auto', 'false', 'boolean', 'general', 'Auto-approve applications'),
  ('commission_rate_default', '2.5', 'number', 'general', 'Default commission rate percentage'),
  ('email_notifications_enabled', 'true', 'boolean', 'email', 'Enable email notifications'),
  ('sms_notifications_enabled', 'true', 'boolean', 'sms', 'Enable SMS notifications')
ON CONFLICT (config_key) DO NOTHING;

-- Create agent_commission_config table
CREATE TABLE IF NOT EXISTS public.agent_commission_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  loan_type text NOT NULL,
  commission_type text NOT NULL, -- 'percentage', 'fixed'
  commission_value decimal(10, 2) NOT NULL,
  min_loan_amount decimal(15, 2),
  max_loan_amount decimal(15, 2),
  is_active boolean DEFAULT true,
  effective_from date NOT NULL,
  effective_to date,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(agent_id, loan_type, effective_from)
);

-- Create employee_access_controls table
CREATE TABLE IF NOT EXISTS public.employee_access_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  module_name text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]', -- ['read', 'write', 'delete', 'approve']
  is_active boolean DEFAULT true,
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, module_name)
);

-- Create admin_reports table for scheduled reports
CREATE TABLE IF NOT EXISTS public.admin_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_name text NOT NULL,
  report_type text NOT NULL, -- 'agent_performance', 'customer_funnel', 'revenue_tracking'
  schedule_frequency text, -- 'daily', 'weekly', 'monthly', 'custom'
  schedule_config jsonb, -- cron expression or custom config
  filters jsonb,
  format text NOT NULL, -- 'pdf', 'excel', 'csv'
  recipients text[], -- email addresses
  is_active boolean DEFAULT true,
  last_generated_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enhance loan_applications table with admin fields
ALTER TABLE IF EXISTS public.loan_applications ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id);
ALTER TABLE IF EXISTS public.loan_applications ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE IF EXISTS public.loan_applications ADD COLUMN IF NOT EXISTS review_notes text;
ALTER TABLE IF EXISTS public.loan_applications ADD COLUMN IF NOT EXISTS admin_priority text DEFAULT 'medium';
ALTER TABLE IF EXISTS public.loan_applications ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON public.audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON public.audit_logs(category);
CREATE INDEX IF NOT EXISTS idx_system_config_category ON public.system_configuration(category);
CREATE INDEX IF NOT EXISTS idx_agent_commission_agent_id ON public.agent_commission_config(agent_id);
CREATE INDEX IF NOT EXISTS idx_employee_access_employee_id ON public.employee_access_controls(employee_id);
CREATE INDEX IF NOT EXISTS idx_loan_apps_reviewed_by ON public.loan_applications(reviewed_by);

-- RLS Policies

-- system_configuration policies
ALTER TABLE public.system_configuration ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can view all system configurations"
  ON public.system_configuration FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Super admin can modify system configurations"
  ON public.system_configuration FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'super_admin'
    )
  );

-- agent_commission_config policies
ALTER TABLE public.agent_commission_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can view all commission configs"
  ON public.agent_commission_config FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admin can manage commission configs"
  ON public.agent_commission_config FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- employee_access_controls policies
ALTER TABLE public.employee_access_controls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can view all access controls"
  ON public.employee_access_controls FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admin can manage access controls"
  ON public.employee_access_controls FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- admin_reports policies
ALTER TABLE public.admin_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can view all reports"
  ON public.admin_reports FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admin can manage reports"
  ON public.admin_reports FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- Function to log admin actions automatically
CREATE OR REPLACE FUNCTION public.log_admin_action()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.audit_logs (
    user_id,
    action_type,
    table_name,
    record_id,
    old_values,
    new_values,
    category
  ) VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW) ELSE NULL END,
    'admin_action'
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add triggers for audit logging
DROP TRIGGER IF EXISTS audit_agent_commission_config ON public.agent_commission_config;
CREATE TRIGGER audit_agent_commission_config
  AFTER INSERT OR UPDATE OR DELETE ON public.agent_commission_config
  FOR EACH ROW EXECUTE FUNCTION public.log_admin_action();

DROP TRIGGER IF EXISTS audit_employee_access_controls ON public.employee_access_controls;
CREATE TRIGGER audit_employee_access_controls
  AFTER INSERT OR UPDATE OR DELETE ON public.employee_access_controls
  FOR EACH ROW EXECUTE FUNCTION public.log_admin_action();

DROP TRIGGER IF EXISTS audit_system_configuration ON public.system_configuration;
CREATE TRIGGER audit_system_configuration
  AFTER INSERT OR UPDATE OR DELETE ON public.system_configuration
  FOR EACH ROW EXECUTE FUNCTION public.log_admin_action();

-- Function to generate admin reports
CREATE OR REPLACE FUNCTION public.generate_admin_report(
  p_report_type text,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  result jsonb;
BEGIN
  CASE p_report_type
    WHEN 'agent_performance' THEN
      SELECT jsonb_build_object(
        'total_agents', COUNT(DISTINCT a.id),
        'active_agents', COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'active'),
        'total_applications', COUNT(la.id),
        'approved_applications', COUNT(la.id) FILTER (WHERE la.status = 'approved'),
        'total_commission', COALESCE(SUM(la.loan_amount * 0.025), 0),
        'agents', jsonb_agg(
          jsonb_build_object(
            'agent_id', a.id,
            'agent_name', ao.agent_name,
            'applications_count', COUNT(la.id),
            'approval_rate', ROUND(COUNT(la.id) FILTER (WHERE la.status = 'approved')::numeric / NULLIF(COUNT(la.id), 0) * 100, 2),
            'total_commission', COALESCE(SUM(la.loan_amount * 0.025), 0)
          )
        )
      ) INTO result
      FROM public.agents a
      LEFT JOIN public.agent_onboarding ao ON ao.user_id = a.id
      LEFT JOIN public.loan_applications la ON la.agent_id = a.id
        AND (p_start_date IS NULL OR la.created_at >= p_start_date)
        AND (p_end_date IS NULL OR la.created_at <= p_end_date)
      GROUP BY a.id, ao.agent_name;
    
    WHEN 'customer_funnel' THEN
      SELECT jsonb_build_object(
        'total_registrations', COUNT(DISTINCT cr.id),
        'approved_registrations', COUNT(DISTINCT cr.id) FILTER (WHERE cr.registration_status = 'approved'),
        'total_applications', COUNT(DISTINCT la.id),
        'submitted_applications', COUNT(DISTINCT la.id) FILTER (WHERE la.status = 'submitted'),
        'approved_applications', COUNT(DISTINCT la.id) FILTER (WHERE la.status = 'approved'),
        'conversion_rate', ROUND(COUNT(DISTINCT la.id) FILTER (WHERE la.status = 'approved')::numeric / NULLIF(COUNT(DISTINCT cr.id), 0) * 100, 2)
      ) INTO result
      FROM public.customer_registrations cr
      LEFT JOIN public.loan_applications la ON la.customer_id = cr.user_id
      WHERE (p_start_date IS NULL OR cr.created_at >= p_start_date)
        AND (p_end_date IS NULL OR cr.created_at <= p_end_date);
    
    WHEN 'revenue_tracking' THEN
      SELECT jsonb_build_object(
        'total_loan_amount', COALESCE(SUM(la.loan_amount), 0),
        'total_commission', COALESCE(SUM(la.loan_amount * 0.025), 0),
        'approved_loans_count', COUNT(la.id) FILTER (WHERE la.status = 'approved'),
        'average_loan_amount', COALESCE(AVG(la.loan_amount), 0),
        'by_loan_type', jsonb_object_agg(
          la.loan_type,
          jsonb_build_object(
            'count', COUNT(la.id),
            'total_amount', COALESCE(SUM(la.loan_amount), 0),
            'commission', COALESCE(SUM(la.loan_amount * 0.025), 0)
          )
        )
      ) INTO result
      FROM public.loan_applications la
      WHERE la.status = 'approved'
        AND (p_start_date IS NULL OR la.created_at >= p_start_date)
        AND (p_end_date IS NULL OR la.created_at <= p_end_date)
      GROUP BY la.loan_type;
    
    ELSE
      result := jsonb_build_object('error', 'Invalid report type');
  END CASE;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
