-- Per-space USD→CRC exchange rate, shared across all members & devices.
ALTER TABLE budget_spaces
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(12,4) NOT NULL DEFAULT 540;
