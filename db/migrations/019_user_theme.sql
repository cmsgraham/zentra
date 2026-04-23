-- Persist per-user light/dark theme preference so it follows the account
-- across devices and browsers. NULL means "no explicit preference — follow
-- system / last local choice".

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS theme TEXT CHECK (theme IN ('light', 'dark'));
