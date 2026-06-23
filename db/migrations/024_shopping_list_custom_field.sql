-- 024_shopping_list_custom_field.sql
-- Adds a per-list custom field: owner picks a label at list creation
-- (e.g. "Aisle", "Brand", "URL") and each item can have a free-text value
-- for it. The field is only rendered in the UI when 'custom' is present in
-- shopping_lists.enabled_fields AND custom_field_label is not null.

ALTER TABLE shopping_lists
  ADD COLUMN IF NOT EXISTS custom_field_label TEXT;

ALTER TABLE shopping_list_items
  ADD COLUMN IF NOT EXISTS custom_value TEXT;
