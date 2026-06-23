-- Allow items in a shopping list to act as section headers (groupings).
ALTER TABLE shopping_list_items
  ADD COLUMN IF NOT EXISTS is_section BOOLEAN NOT NULL DEFAULT false;
