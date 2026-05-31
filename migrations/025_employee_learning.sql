-- Employee learning (shares agent_learning_content with audience column)

ALTER TABLE agent_learning_content
  ADD COLUMN audience VARCHAR(16) NOT NULL DEFAULT 'agent' AFTER content_type,
  ADD COLUMN category_label VARCHAR(64) NULL AFTER description;

CREATE TABLE IF NOT EXISTS employee_learning_progress (
  id CHAR(36) NOT NULL,
  employee_user_id CHAR(36) NOT NULL,
  content_id CHAR(36) NOT NULL,
  progress_percent INT NOT NULL DEFAULT 0,
  completed_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_employee_learning_progress (employee_user_id, content_id),
  KEY idx_employee_progress_user (employee_user_id)
);
