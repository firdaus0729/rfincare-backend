-- Milestone update: separate document stage and bank approval stage tracking

ALTER TABLE loan_applications
  ADD COLUMN IF NOT EXISTS document_stage_status VARCHAR(64) NOT NULL DEFAULT 'documents_pending' AFTER status,
  ADD COLUMN IF NOT EXISTS bank_approval_status VARCHAR(64) NOT NULL DEFAULT 'submitted_to_bank' AFTER document_stage_status,
  ADD COLUMN IF NOT EXISTS qc_employee_id CHAR(36) NULL AFTER assigned_employee_id,
  ADD COLUMN IF NOT EXISTS qc_admin_id CHAR(36) NULL AFTER qc_employee_id,
  ADD COLUMN IF NOT EXISTS qc_updated_at DATETIME(3) NULL AFTER reviewed_at,
  ADD COLUMN IF NOT EXISTS sourced_agent_code VARCHAR(64) NULL AFTER agent_id;

ALTER TABLE loan_applications
  ADD KEY IF NOT EXISTS idx_loan_app_document_stage (document_stage_status),
  ADD KEY IF NOT EXISTS idx_loan_app_bank_stage (bank_approval_status),
  ADD KEY IF NOT EXISTS idx_loan_app_qc_employee (qc_employee_id),
  ADD KEY IF NOT EXISTS idx_loan_app_qc_admin (qc_admin_id),
  ADD KEY IF NOT EXISTS idx_loan_app_agent_code (sourced_agent_code);

UPDATE loan_applications la
LEFT JOIN agent_onboarding ao ON ao.user_id = la.agent_id
SET la.sourced_agent_code = COALESCE(la.sourced_agent_code, ao.agent_code)
WHERE la.agent_id IS NOT NULL;
