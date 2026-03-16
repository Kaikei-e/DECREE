-- Remove duplicate projects (keep oldest by created_at)
DELETE FROM projects WHERE id NOT IN (
  SELECT DISTINCT ON (name) id FROM projects ORDER BY name, created_at ASC
);

-- Remove duplicate targets (keep oldest by created_at)
DELETE FROM targets WHERE id NOT IN (
  SELECT DISTINCT ON (project_id, name) id FROM targets ORDER BY project_id, name, created_at ASC
);

-- Add unique constraints
CREATE UNIQUE INDEX idx_projects_name ON projects (name);
CREATE UNIQUE INDEX idx_targets_project_name ON targets (project_id, name);
