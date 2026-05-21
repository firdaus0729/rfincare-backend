-- Milestone 2: magic links to resume abandoned applications

CREATE TABLE IF NOT EXISTS application_resume_tokens (
  id CHAR(36) NOT NULL,
  session_key VARCHAR(128) NOT NULL,
  lead_id CHAR(36) NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_resume_token_hash (token_hash),
  KEY idx_resume_session (session_key)
);
