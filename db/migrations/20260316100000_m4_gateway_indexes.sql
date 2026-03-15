-- M4: indexes for gateway REST API queries

CREATE INDEX IF NOT EXISTS idx_cfs_target_active_score
  ON current_finding_status (target_id, is_active, last_score DESC);

CREATE INDEX IF NOT EXISTS idx_vo_instance_observed
  ON vulnerability_observations (instance_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_vd_scan_disappeared
  ON vulnerability_disappearances (scan_id, disappeared_at DESC);

CREATE INDEX IF NOT EXISTS idx_vi_target
  ON vulnerability_instances (target_id);
