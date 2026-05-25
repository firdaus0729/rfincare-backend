-- Agent and employee onboarding records (admin-created staff)

CREATE TABLE IF NOT EXISTS agent_onboarding (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  username VARCHAR(128) NOT NULL,
  agent_name VARCHAR(255) NOT NULL,
  agent_code VARCHAR(64) NOT NULL,
  email VARCHAR(320) NOT NULL,
  mobile_number VARCHAR(32) NOT NULL,
  account_number VARCHAR(64) NOT NULL,
  bank_name VARCHAR(255) NOT NULL,
  ifsc_code VARCHAR(32) NOT NULL,
  onboarding_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_onboarding_username (username),
  UNIQUE KEY uq_agent_onboarding_agent_code (agent_code),
  UNIQUE KEY uq_agent_onboarding_email (email),
  UNIQUE KEY uq_agent_onboarding_user_id (user_id),
  KEY idx_agent_onboarding_status (onboarding_status),
  CONSTRAINT fk_agent_onboarding_user FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_onboarding (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  username VARCHAR(128) NOT NULL,
  employee_name VARCHAR(255) NOT NULL,
  employee_code VARCHAR(64) NOT NULL,
  email VARCHAR(320) NOT NULL,
  mobile_number VARCHAR(32) NOT NULL,
  account_number VARCHAR(64) NOT NULL,
  bank_name VARCHAR(255) NOT NULL,
  ifsc_code VARCHAR(32) NOT NULL,
  onboarding_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_employee_onboarding_username (username),
  UNIQUE KEY uq_employee_onboarding_employee_code (employee_code),
  UNIQUE KEY uq_employee_onboarding_email (email),
  UNIQUE KEY uq_employee_onboarding_user_id (user_id),
  KEY idx_employee_onboarding_status (onboarding_status),
  CONSTRAINT fk_employee_onboarding_user FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE
);
