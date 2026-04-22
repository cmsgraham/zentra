-- 006_shopping.sql - Shopping List module

-- Enums
CREATE TYPE shopping_item_category AS ENUM (
  'groceries', 'cleaning', 'personal_care', 'kitchen',
  'hardware', 'pets', 'pharmacy', 'miscellaneous'
);

CREATE TYPE shopping_list_role AS ENUM ('owner', 'editor');

CREATE TYPE shopping_event_type AS ENUM (
  'added', 'edited', 'removed', 'checked', 'unchecked'
);

-- Shopping lists
CREATE TABLE shopping_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shopping_lists_owner ON shopping_lists(owner_user_id);

-- Shopping list members (sharing)
CREATE TABLE shopping_list_members (
  list_id UUID NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role shopping_list_role NOT NULL DEFAULT 'editor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, user_id)
);

-- Shopping item memory / catalog (per-user reusable item knowledge)
CREATE TABLE shopping_item_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  normalized_name TEXT NOT NULL,
  preferred_display_name TEXT NOT NULL,
  default_category shopping_item_category,
  default_unit TEXT,
  total_added_count INT NOT NULL DEFAULT 0,
  total_checked_count INT NOT NULL DEFAULT 0,
  last_added_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  avg_days_between_checks NUMERIC(8,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, normalized_name)
);

CREATE INDEX idx_shopping_item_memory_user ON shopping_item_memory(user_id);

-- Shopping list items
CREATE TABLE shopping_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  item_memory_id UUID REFERENCES shopping_item_memory(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  quantity NUMERIC(10,3),
  unit TEXT,
  notes TEXT,
  category shopping_item_category,
  checked BOOLEAN NOT NULL DEFAULT FALSE,
  checked_at TIMESTAMPTZ,
  checked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shopping_items_list ON shopping_list_items(list_id);
CREATE INDEX idx_shopping_items_memory ON shopping_list_items(item_memory_id);

-- Shopping item history / events
CREATE TABLE shopping_item_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID REFERENCES shopping_list_items(id) ON DELETE SET NULL,
  list_id UUID NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  item_memory_id UUID REFERENCES shopping_item_memory(id) ON DELETE SET NULL,
  event_type shopping_event_type NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shopping_events_list ON shopping_item_events(list_id);
CREATE INDEX idx_shopping_events_memory ON shopping_item_events(item_memory_id);
CREATE INDEX idx_shopping_events_actor ON shopping_item_events(actor_user_id);
CREATE INDEX idx_shopping_events_type ON shopping_item_events(event_type);

-- Shopping AI import jobs (reuse pattern from ai_import_jobs but for shopping)
CREATE TABLE shopping_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID REFERENCES shopping_lists(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  input_type ai_input_type NOT NULL,
  source_text TEXT,
  source_file_url TEXT,
  status ai_job_status NOT NULL DEFAULT 'queued',
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shopping_import_jobs_user ON shopping_import_jobs(created_by);

-- Shopping import draft items
CREATE TABLE shopping_import_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES shopping_import_jobs(id) ON DELETE CASCADE,
  proposed_name TEXT NOT NULL,
  proposed_quantity NUMERIC(10,3),
  proposed_unit TEXT,
  proposed_category shopping_item_category,
  confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.5,
  ambiguity_flags TEXT[] DEFAULT '{}',
  original_text_snippet TEXT,
  accepted BOOLEAN
);

CREATE INDEX idx_shopping_import_items_job ON shopping_import_items(job_id);

-- Triggers for updated_at
CREATE TRIGGER set_shopping_lists_updated_at
  BEFORE UPDATE ON shopping_lists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_shopping_item_memory_updated_at
  BEFORE UPDATE ON shopping_item_memory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_shopping_list_items_updated_at
  BEFORE UPDATE ON shopping_list_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_shopping_import_jobs_updated_at
  BEFORE UPDATE ON shopping_import_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
