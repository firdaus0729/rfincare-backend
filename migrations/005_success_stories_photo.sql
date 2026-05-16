-- Optional photo for success story submissions
ALTER TABLE success_stories
  ADD COLUMN photo_url VARCHAR(512) NULL AFTER loan_amount;
