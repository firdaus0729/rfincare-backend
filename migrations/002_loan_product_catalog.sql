-- Platform loan product catalog (homepage cards, product pages, forms)
CREATE TABLE IF NOT EXISTS loan_product_catalog (
  id CHAR(36) NOT NULL,
  slug VARCHAR(64) NOT NULL,
  api_key VARCHAR(64) NOT NULL,
  label VARCHAR(255) NOT NULL,
  short_label VARCHAR(64) NULL,
  icon VARCHAR(64) NOT NULL DEFAULT 'Wallet',
  description TEXT NULL,
  interest_rate_min DECIMAL(5,2) NULL,
  interest_rate_max DECIMAL(5,2) NULL,
  features JSON NULL,
  color VARCHAR(32) NOT NULL DEFAULT 'var(--color-primary)',
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_loan_product_catalog_slug (slug),
  UNIQUE KEY uq_loan_product_catalog_api_key (api_key),
  KEY idx_loan_product_catalog_active (is_active, sort_order)
);
