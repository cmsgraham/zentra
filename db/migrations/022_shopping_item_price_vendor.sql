-- 022_shopping_item_price_vendor.sql
-- Adds optional price and vendor fields to shopping list items so lists can
-- capture per-item cost and source without forcing users to fill them in.
-- Both columns are nullable; existing rows are unaffected.

ALTER TABLE shopping_list_items
  ADD COLUMN IF NOT EXISTS price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS vendor TEXT;

-- Helpful index if we later want to filter/sum spend by vendor.
CREATE INDEX IF NOT EXISTS idx_shopping_items_vendor
  ON shopping_list_items(vendor)
  WHERE vendor IS NOT NULL;
