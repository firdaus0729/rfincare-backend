ALTER TABLE otp_provider_settings
  ADD COLUMN IF NOT EXISTS whatsapp_provider VARCHAR(32) NOT NULL DEFAULT 'console' AFTER sms_provider,
  ADD COLUMN IF NOT EXISTS require_whatsapp_otp TINYINT(1) NOT NULL DEFAULT 0 AFTER require_email_otp;
