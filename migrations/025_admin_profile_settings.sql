-- Admin profile settings: OTP verification + three verifier emails

CREATE TABLE IF NOT EXISTS admin_profile_otps (
  id CHAR(36) NOT NULL,
  admin_user_id CHAR(36) NOT NULL,
  purpose VARCHAR(48) NOT NULL,
  channel VARCHAR(16) NOT NULL,
  target_email VARCHAR(320) NULL,
  otp_hash VARCHAR(64) NOT NULL,
  payload JSON NULL,
  verified_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_admin_profile_otp_user (admin_user_id, purpose),
  KEY idx_admin_profile_otp_exp (expires_at)
);

CREATE TABLE IF NOT EXISTS admin_verification_settings (
  id VARCHAR(16) NOT NULL PRIMARY KEY,
  verifier_email_1 VARCHAR(320) NULL,
  verifier_email_2 VARCHAR(320) NULL,
  verifier_email_3 VARCHAR(320) NULL,
  updated_by CHAR(36) NULL,
  updated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
