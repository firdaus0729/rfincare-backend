-- Initial MySQL schema for replacing Supabase.
-- Focuses on fields currently referenced by the frontend code.

CREATE TABLE IF NOT EXISTS auth_users (
  id CHAR(36) NOT NULL,
  email VARCHAR(320) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_users_email (email)
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id CHAR(36) NOT NULL,
  email VARCHAR(320) NOT NULL,
  full_name VARCHAR(255) NULL,
  phone VARCHAR(32) NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'customer',
  account_status VARCHAR(32) NOT NULL DEFAULT 'active',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  password_change_required TINYINT(1) NOT NULL DEFAULT 0,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  onboarding_status VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_profiles_email (email)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  issued_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  rotated_to_token_id CHAR(36) NULL,
  user_agent VARCHAR(512) NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_refresh_tokens_user_id (user_id),
  KEY idx_refresh_tokens_token_hash (token_hash),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

-- Core domain tables (minimal columns; extend as needed)
CREATE TABLE IF NOT EXISTS banks (
  id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  logo_url TEXT NULL,
  logo_alt VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  display_priority INT NOT NULL DEFAULT 0,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS bank_products (
  id CHAR(36) NOT NULL,
  bank_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  data JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_bank_products_bank_id (bank_id),
  CONSTRAINT fk_bank_products_bank FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approval_matrix_rules (
  id CHAR(36) NOT NULL,
  bank_id CHAR(36) NOT NULL,
  rule_name VARCHAR(255) NULL,
  priority INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  approval_probability INT NULL,
  data JSON NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_approval_rules_bank_id (bank_id),
  CONSTRAINT fk_approval_rules_bank FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS loan_applications (
  id CHAR(36) NOT NULL,
  application_number VARCHAR(64) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  agent_id CHAR(36) NULL,
  assigned_employee_id CHAR(36) NULL,
  selected_bank_id CHAR(36) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  status_notes TEXT NULL,
  review_notes TEXT NULL,
  eligibility_status VARCHAR(64) NULL,
  rejection_reason TEXT NULL,
  submitted_at DATETIME(3) NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME(3) NULL,
  data JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_loan_applications_number (application_number),
  KEY idx_loan_applications_customer (customer_id),
  KEY idx_loan_applications_status (status)
);

CREATE TABLE IF NOT EXISTS application_timeline (
  id CHAR(36) NOT NULL,
  application_id CHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL,
  message TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_timeline_application (application_id),
  CONSTRAINT fk_timeline_application FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS application_consents (
  id CHAR(36) NOT NULL,
  application_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  consent_type VARCHAR(128) NOT NULL,
  is_granted TINYINT(1) NOT NULL,
  granted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_consents_application (application_id)
);

CREATE TABLE IF NOT EXISTS otp_verifications (
  id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  application_id CHAR(36) NOT NULL,
  phone_number VARCHAR(32) NULL,
  email VARCHAR(320) NULL,
  otp_code VARCHAR(16) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  is_verified TINYINT(1) NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NOT NULL,
  verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_otp_application (application_id),
  KEY idx_otp_customer (customer_id)
);

CREATE TABLE IF NOT EXISTS customer_documents (
  id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  application_id CHAR(36) NULL,
  document_type VARCHAR(64) NULL,
  document_name VARCHAR(255) NULL,
  file_path TEXT NOT NULL,
  document_url TEXT NULL,
  file_size BIGINT NULL,
  mime_type VARCHAR(255) NULL,
  status VARCHAR(32) NULL,
  verification_status VARCHAR(32) NULL,
  verified_by CHAR(36) NULL,
  verified_at DATETIME(3) NULL,
  uploaded_by CHAR(36) NULL,
  uploaded_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_docs_customer (customer_id),
  KEY idx_docs_application (application_id)
);

CREATE TABLE IF NOT EXISTS customer_notifications (
  id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  title VARCHAR(255) NULL,
  message TEXT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notifications_customer (customer_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NULL,
  action_type VARCHAR(64) NOT NULL,
  table_name VARCHAR(128) NOT NULL,
  record_id VARCHAR(128) NULL,
  old_values JSON NULL,
  new_values JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at)
);

CREATE TABLE IF NOT EXISTS indian_states (
  id CHAR(36) NOT NULL,
  state_name VARCHAR(128) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_state_name (state_name)
);

CREATE TABLE IF NOT EXISTS localization_settings (
  id CHAR(36) NOT NULL,
  setting_key VARCHAR(128) NOT NULL,
  setting_value TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_localization_key (setting_key)
);

-- Simple sequence table to generate application numbers (optional, API can also do this)
CREATE TABLE IF NOT EXISTS sequences (
  name VARCHAR(64) NOT NULL,
  value BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (name)
);

