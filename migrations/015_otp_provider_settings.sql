-- Admin-managed OTP delivery operators (SMS + email)

CREATE TABLE IF NOT EXISTS otp_provider_settings (
  id VARCHAR(32) NOT NULL DEFAULT 'default',
  sms_provider VARCHAR(32) NOT NULL DEFAULT 'console',
  email_provider VARCHAR(32) NOT NULL DEFAULT 'console',
  require_mobile_otp TINYINT(1) NOT NULL DEFAULT 1,
  require_email_otp TINYINT(1) NOT NULL DEFAULT 1,
  provider_config_json JSON NULL,
  updated_by CHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
);

INSERT INTO otp_provider_settings (
  id, sms_provider, email_provider, require_mobile_otp, require_email_otp, provider_config_json
) VALUES (
  'default', 'console', 'console', 1, 1,
  JSON_OBJECT(
    'msg91SenderId', '',
    'msg91TemplateId', '',
    'otpMessageTemplate', 'Your Rfincare verification code is {{otp}}. Valid for 10 minutes.'
  )
)
ON DUPLICATE KEY UPDATE id = id;
