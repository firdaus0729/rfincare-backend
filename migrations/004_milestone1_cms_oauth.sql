-- Milestone 1: CMS, OAuth identities, OTP, success stories, legal pages

ALTER TABLE auth_users
  MODIFY password_hash VARCHAR(255) NULL;

CREATE TABLE IF NOT EXISTS oauth_identities (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,
  email VARCHAR(320) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_oauth_provider_user (provider, provider_user_id),
  KEY idx_oauth_user_id (user_id),
  CONSTRAINT fk_oauth_user FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS homepage_news (
  id CHAR(36) NOT NULL,
  title VARCHAR(512) NOT NULL,
  excerpt TEXT NULL,
  blog_url TEXT NULL,
  image_url TEXT NULL,
  image_alt VARCHAR(255) NULL,
  category VARCHAR(64) NULL,
  published_at DATETIME(3) NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS homepage_videos (
  id CHAR(36) NOT NULL,
  title VARCHAR(512) NOT NULL,
  description TEXT NULL,
  youtube_url TEXT NOT NULL,
  thumbnail_url TEXT NULL,
  thumbnail_alt VARCHAR(255) NULL,
  duration_label VARCHAR(32) NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS legal_pages (
  slug VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body_html MEDIUMTEXT NULL,
  updated_by CHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (slug)
);

CREATE TABLE IF NOT EXISTS success_stories (
  id CHAR(36) NOT NULL,
  submitter_name VARCHAR(255) NOT NULL,
  submitter_email VARCHAR(320) NOT NULL,
  submitter_phone VARCHAR(32) NULL,
  story_type VARCHAR(32) NOT NULL DEFAULT 'customer',
  story_text TEXT NOT NULL,
  location VARCHAR(255) NULL,
  loan_amount VARCHAR(64) NULL,
  moderation_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  moderated_by CHAR(36) NULL,
  moderated_at DATETIME(3) NULL,
  rejection_reason TEXT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_stories_status (moderation_status)
);

CREATE TABLE IF NOT EXISTS status_check_otps (
  id CHAR(36) NOT NULL,
  email VARCHAR(320) NOT NULL,
  phone VARCHAR(32) NULL,
  otp_hash CHAR(64) NOT NULL,
  channel VARCHAR(16) NOT NULL DEFAULT 'email',
  expires_at DATETIME(3) NOT NULL,
  verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_status_otp_email (email)
);

INSERT IGNORE INTO legal_pages (slug, title, body_html) VALUES
('privacy-policy', 'Privacy Policy', '<p>Privacy policy content managed by admin.</p>'),
('terms-of-service', 'Terms of Service', '<p>Terms of service content managed by admin.</p>'),
('help-center', 'Help Center', '<p>Help center content managed by admin.</p>'),
('financial-guides', 'Financial Guides', '<p>Financial guides content managed by admin.</p>'),
('careers', 'Careers', '<p>Careers content managed by admin.</p>'),
('cookie-policy', 'Cookie Policy', '<p>Cookie policy content managed by admin.</p>');
