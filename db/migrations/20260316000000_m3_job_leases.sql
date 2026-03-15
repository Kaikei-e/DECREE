-- job_leases: per-target exclusive scan control
CREATE TABLE job_leases (
  target_id   UUID PRIMARY KEY REFERENCES targets(id) ON DELETE CASCADE,
  holder_id   TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  job_id      UUID
);

-- notification_delivery_log: delivery records + dedup
CREATE TABLE notification_delivery_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id       UUID NOT NULL REFERENCES targets(id),
  advisory_id     TEXT NOT NULL,
  diff_kind       TEXT NOT NULL,
  channel         TEXT NOT NULL,
  status          TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  dedup_key       TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_delivery_dedup ON notification_delivery_log (dedup_key, channel);
