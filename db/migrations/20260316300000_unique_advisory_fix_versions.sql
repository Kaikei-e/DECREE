-- Remove duplicate advisory_fix_versions rows (keep the oldest per instance_id + fixed_version)
DELETE FROM advisory_fix_versions WHERE id NOT IN (
  SELECT DISTINCT ON (instance_id, fixed_version) id
  FROM advisory_fix_versions
  ORDER BY instance_id, fixed_version, id ASC
);

-- Add unique constraint to prevent future duplicates
CREATE UNIQUE INDEX uq_advisory_fix_versions ON advisory_fix_versions (instance_id, fixed_version);
