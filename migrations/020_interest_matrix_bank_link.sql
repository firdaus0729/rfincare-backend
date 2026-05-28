ALTER TABLE interest_matrix_rates
  ADD COLUMN bank_id CHAR(36) NULL AFTER id,
  ADD KEY idx_interest_matrix_bank (bank_id);
