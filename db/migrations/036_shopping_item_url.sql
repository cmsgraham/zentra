-- 036_shopping_item_url.sql
-- Adds an optional product URL to shopping list items so users can tap an
-- item and jump straight to where it can be purchased online.
-- The column is nullable; existing rows are unaffected. The new field id
-- 'url' is also allowed in shopping_lists.enabled_fields (which is a free-form
-- TEXT[] — no enum to update).

ALTER TABLE shopping_list_items
  ADD COLUMN IF NOT EXISTS url TEXT;
