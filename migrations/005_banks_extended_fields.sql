-- Extended bank fields for marketplace management UI

ALTER TABLE banks
  ADD COLUMN bank_type VARCHAR(32) NULL DEFAULT 'private' AFTER logo_alt,
  ADD COLUMN rating DECIMAL(4, 2) NULL DEFAULT NULL AFTER bank_type,
  ADD COLUMN reviews_count INT NULL DEFAULT 0 AFTER rating,
  ADD COLUMN customers_served VARCHAR(64) NULL AFTER reviews_count,
  ADD COLUMN partnership_duration VARCHAR(128) NULL AFTER customers_served,
  ADD COLUMN certifications JSON NULL AFTER partnership_duration;
