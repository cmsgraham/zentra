-- 023_shopping_list_enabled_fields.sql
-- Per-list field configuration: when creating a list the owner picks which
-- optional fields apply (price, vendor, category, notes, quantity). The item
-- form on that list then renders only those fields, keeping the UI minimal.
--
-- Default: '{quantity}' so existing lists keep their current behavior
-- (quantity was always shown).

ALTER TABLE shopping_lists
  ADD COLUMN IF NOT EXISTS enabled_fields TEXT[] NOT NULL DEFAULT ARRAY['quantity']::TEXT[];
