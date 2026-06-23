-- Auto-managed exchange rate per budget space.
-- When auto_exchange_rate = true (default), the rate is kept in sync with the
-- live USD→CRC buy rate from api.hacienda.go.cr. The moment the user types a
-- custom value, the API flips this to false and treats exchange_rate as a
-- manual override.

ALTER TABLE budget_spaces
  ADD COLUMN IF NOT EXISTS auto_exchange_rate boolean NOT NULL DEFAULT true;

-- Existing spaces that still carry the legacy default of 540 are clearly
-- "never customized", so leave them on auto. Spaces whose rate differs from
-- 540 were almost certainly typed by the user — opt them out of auto so we
-- don't surprise them on next sync.
UPDATE budget_spaces
   SET auto_exchange_rate = false
 WHERE abs(exchange_rate - 540) > 0.0001;
