-- Agent commission + employee access controls

CREATE TABLE IF NOT EXISTS agent_commission_config (
  id CHAR(36) NOT NULL,
  agent_user_id CHAR(36) NOT NULL,
  loan_type VARCHAR(64) NULL,
  commission_type VARCHAR(32) NOT NULL DEFAULT 'percentage',
  commission_value DECIMAL(10, 2) NOT NULL DEFAULT 2.5,
  min_loan_amount DECIMAL(15, 2) NULL,
  max_loan_amount DECIMAL(15, 2) NULL,
  effective_from DATE NULL,
  effective_to DATE NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_agent_commission_agent (agent_user_id)
);

CREATE TABLE IF NOT EXISTS employee_access_controls (
  id CHAR(36) NOT NULL,
  employee_user_id CHAR(36) NOT NULL,
  module_name VARCHAR(64) NOT NULL,
  permissions_json JSON NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  expires_at DATETIME(3) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_employee_access_user (employee_user_id),
  UNIQUE KEY uq_employee_access_module (employee_user_id, module_name)
);
