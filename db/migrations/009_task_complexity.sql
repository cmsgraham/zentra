-- Add complexity column to tasks (1=simple, 2=moderate, 3=complex)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS complexity SMALLINT NOT NULL DEFAULT 1 CHECK (complexity BETWEEN 1 AND 3);
