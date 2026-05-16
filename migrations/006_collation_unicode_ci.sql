-- Align string columns to utf8mb4_unicode_ci (fixes "Illegal mix of collations" on hosted MySQL).

ALTER TABLE loan_applications
  MODIFY status VARCHAR(32) NOT NULL DEFAULT 'draft' COLLATE utf8mb4_unicode_ci,
  MODIFY status_notes TEXT COLLATE utf8mb4_unicode_ci,
  MODIFY review_notes TEXT COLLATE utf8mb4_unicode_ci,
  MODIFY rejection_reason TEXT COLLATE utf8mb4_unicode_ci,
  MODIFY eligibility_status VARCHAR(64) NULL COLLATE utf8mb4_unicode_ci,
  MODIFY application_number VARCHAR(64) NULL COLLATE utf8mb4_unicode_ci;

ALTER TABLE application_timeline
  MODIFY status VARCHAR(32) NOT NULL COLLATE utf8mb4_unicode_ci,
  MODIFY message TEXT COLLATE utf8mb4_unicode_ci;
