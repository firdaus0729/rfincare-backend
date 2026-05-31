-- Agent profile settings: avatar + OTP-backed changes

ALTER TABLE user_profiles
  ADD COLUMN avatar_url VARCHAR(512) NULL AFTER phone;

CREATE TABLE IF NOT EXISTS agent_profile_otps (
  id CHAR(36) NOT NULL,
  agent_user_id CHAR(36) NOT NULL,
  purpose VARCHAR(48) NOT NULL,
  channel VARCHAR(16) NOT NULL,
  target_email VARCHAR(320) NULL,
  target_phone VARCHAR(32) NULL,
  otp_hash VARCHAR(64) NOT NULL,
  payload JSON NULL,
  verified_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_agent_profile_otp_user (agent_user_id, purpose),
  KEY idx_agent_profile_otp_exp (expires_at)
);
