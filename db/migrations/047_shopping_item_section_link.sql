-- Persist which section (store) each shopping item belongs to so the grouping
-- survives check/uncheck and reorder. Previously membership was purely
-- positional (sort_order relative to section headers), so checking an item and
-- later reordering would strip it of its store when unchecked.
ALTER TABLE shopping_list_items
  ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES shopping_list_items(id) ON DELETE SET NULL;

-- Backfill: assign each non-section item the nearest preceding section header
-- (by sort_order) within the same list, matching the old positional grouping.
WITH ranked AS (
  SELECT sli.id,
         (SELECT s.id FROM shopping_list_items s
           WHERE s.list_id = sli.list_id
             AND s.is_section = true
             AND s.sort_order <= sli.sort_order
             AND s.id <> sli.id
           ORDER BY s.sort_order DESC
           LIMIT 1) AS sect
  FROM shopping_list_items sli
  WHERE sli.is_section = false
)
UPDATE shopping_list_items t
SET section_id = ranked.sect
FROM ranked
WHERE t.id = ranked.id;
