-- Milestone 2: leads, eligibility storage, form draft recovery

CREATE TABLE IF NOT EXISTS marketing_leads (
  id CHAR(36) NOT NULL,
  full_name VARCHAR(255) NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  loan_type VARCHAR(64) NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'website',
  status VARCHAR(32) NOT NULL DEFAULT 'new',
  consent_accepted TINYINT(1) NOT NULL DEFAULT 0,
  consent_verified_at DATETIME(3) NULL,
  eligibility_score INT NULL,
  eligibility_data JSON NULL,
  assigned_to CHAR(36) NULL,
  application_id CHAR(36) NULL,
  session_key VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_leads_email (email),
  KEY idx_leads_phone (phone),
  KEY idx_leads_status (status),
  KEY idx_leads_session (session_key)
);

CREATE TABLE IF NOT EXISTS lead_otps (
  id CHAR(36) NOT NULL,
  lead_id CHAR(36) NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(32) NULL,
  otp_hash VARCHAR(64) NOT NULL,
  purpose VARCHAR(32) NOT NULL DEFAULT 'lead_verify',
  channel VARCHAR(16) NOT NULL DEFAULT 'sms',
  verified_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_lead_otps_phone (phone),
  KEY idx_lead_otps_lead (lead_id)
);

CREATE TABLE IF NOT EXISTS application_form_drafts (
  id CHAR(36) NOT NULL,
  session_key VARCHAR(128) NOT NULL,
  customer_id CHAR(36) NULL,
  application_id CHAR(36) NULL,
  form_data JSON NOT NULL,
  current_step INT NOT NULL DEFAULT 0,
  loan_type VARCHAR(64) NULL,
  preferred_bank_id CHAR(36) NULL,
  loan_priority VARCHAR(32) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_draft_session (session_key),
  KEY idx_draft_application (application_id)
);

CREATE TABLE IF NOT EXISTS eligibility_assessments (
  id CHAR(36) NOT NULL,
  customer_id CHAR(36) NULL,
  lead_id CHAR(36) NULL,
  loan_type VARCHAR(64) NULL,
  loan_amount DECIMAL(15,2) NULL,
  monthly_income DECIMAL(15,2) NULL,
  employment_type VARCHAR(64) NULL,
  credit_score_range VARCHAR(32) NULL,
  existing_loans DECIMAL(15,2) NULL,
  eligibility_score INT NULL,
  eligibility_status VARCHAR(32) NULL,
  eligible_amount DECIMAL(15,2) NULL,
  bank_results JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_eligibility_customer (customer_id),
  KEY idx_eligibility_lead (lead_id)
);
