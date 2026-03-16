schema "public" {
}

// ============================================================
// Resource tables
// ============================================================

table "projects" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "name" {
    type = text
    null = false
  }
  column "created_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_projects_name" {
    columns = [column.name]
    unique  = true
  }
}

table "targets" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "project_id" {
    type = uuid
    null = false
  }
  column "name" {
    type = text
    null = false
  }
  column "target_type" {
    type = text
    null = false
  }
  column "source_ref" {
    type = text
  }
  column "branch" {
    type = text
  }
  column "subpath" {
    type = text
  }
  column "exposure_class" {
    type = text
  }
  column "created_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_project" {
    columns     = [column.project_id]
    ref_columns = [table.projects.column.id]
    on_delete   = CASCADE
  }
  index "idx_targets_project_name" {
    columns = [column.project_id, column.name]
    unique  = true
  }
}

table "vulnerability_instances" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "target_id" {
    type = uuid
    null = false
  }
  column "package_name" {
    type = text
    null = false
  }
  column "package_version" {
    type = text
    null = false
  }
  column "ecosystem" {
    type = text
    null = false
  }
  column "advisory_id" {
    type = text
    null = false
  }
  column "advisory_source" {
    type = text
    null = false
  }
  column "dep_path_hash" {
    type = text
  }
  column "created_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_target" {
    columns     = [column.target_id]
    ref_columns = [table.targets.column.id]
    on_delete   = CASCADE
  }
  index "idx_vuln_instance_key" {
    columns = [column.target_id, column.package_name, column.package_version, column.ecosystem, column.advisory_id]
    unique  = true
  }
  index "idx_vi_target" {
    columns = [column.target_id]
  }
}

table "advisory_fix_versions" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "instance_id" {
    type = uuid
    null = false
  }
  column "fixed_version" {
    type = text
    null = false
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_instance" {
    columns     = [column.instance_id]
    ref_columns = [table.vulnerability_instances.column.id]
    on_delete   = CASCADE
  }
  index "uq_advisory_fix_versions" {
    columns = [column.instance_id, column.fixed_version]
    unique  = true
  }
}

// ============================================================
// Fact tables (INSERT ONLY)
// ============================================================

table "scans" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "target_id" {
    type = uuid
    null = false
  }
  column "started_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  column "completed_at" {
    type = timestamptz
  }
  column "status" {
    type = text
    null = false
  }
  column "sbom_hash" {
    type = text
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_target" {
    columns     = [column.target_id]
    ref_columns = [table.targets.column.id]
    on_delete   = CASCADE
  }
}

table "vulnerability_observations" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "instance_id" {
    type = uuid
    null = false
  }
  column "scan_id" {
    type = uuid
    null = false
  }
  column "observed_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  column "cvss_score" {
    type = real
  }
  column "cvss_vector" {
    type = text
  }
  column "epss_score" {
    type = real
  }
  column "epss_percentile" {
    type = real
  }
  column "decree_score" {
    type = real
  }
  column "severity" {
    type = text
    null = false
  }
  column "reachability" {
    type = real
  }
  column "is_direct_dep" {
    type = boolean
  }
  column "dep_depth" {
    type = integer
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_instance" {
    columns     = [column.instance_id]
    ref_columns = [table.vulnerability_instances.column.id]
    on_delete   = CASCADE
  }
  foreign_key "fk_scan" {
    columns     = [column.scan_id]
    ref_columns = [table.scans.column.id]
    on_delete   = CASCADE
  }
  index "idx_vo_instance_observed" {
    columns = [column.instance_id, column.observed_at]
  }
}

table "vulnerability_disappearances" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "instance_id" {
    type = uuid
    null = false
  }
  column "scan_id" {
    type = uuid
    null = false
  }
  column "disappeared_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_instance" {
    columns     = [column.instance_id]
    ref_columns = [table.vulnerability_instances.column.id]
    on_delete   = CASCADE
  }
  foreign_key "fk_scan" {
    columns     = [column.scan_id]
    ref_columns = [table.scans.column.id]
    on_delete   = CASCADE
  }
  index "idx_vd_scan_disappeared" {
    columns = [column.scan_id, column.disappeared_at]
  }
}

// ============================================================
// Graph
// ============================================================

table "dependency_edges" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "scan_id" {
    type = uuid
    null = false
  }
  column "target_id" {
    type = uuid
    null = false
  }
  column "from_pkg" {
    type = text
    null = false
  }
  column "to_pkg" {
    type = text
    null = false
  }
  column "dep_type" {
    type = text
    null = false
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_scan" {
    columns     = [column.scan_id]
    ref_columns = [table.scans.column.id]
    on_delete   = CASCADE
  }
  foreign_key "fk_target" {
    columns     = [column.target_id]
    ref_columns = [table.targets.column.id]
    on_delete   = CASCADE
  }
}

// ============================================================
// Projection (UPDATE allowed)
// ============================================================

table "current_finding_status" {
  schema = schema.public
  column "instance_id" {
    type = uuid
  }
  column "target_id" {
    type = uuid
    null = false
  }
  column "latest_scan_id" {
    type = uuid
    null = false
  }
  column "is_active" {
    type = boolean
    null = false
  }
  column "last_observed_at" {
    type = timestamptz
  }
  column "last_score" {
    type = real
  }
  column "last_severity" {
    type = text
  }
  column "updated_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  primary_key {
    columns = [column.instance_id]
  }
  foreign_key "fk_instance" {
    columns     = [column.instance_id]
    ref_columns = [table.vulnerability_instances.column.id]
    on_delete   = CASCADE
  }
  foreign_key "fk_target" {
    columns     = [column.target_id]
    ref_columns = [table.targets.column.id]
    on_delete   = CASCADE
  }
  foreign_key "fk_scan" {
    columns     = [column.latest_scan_id]
    ref_columns = [table.scans.column.id]
    on_delete   = CASCADE
  }
  index "idx_cfs_target_active_score" {
    columns = [column.target_id, column.is_active, column.last_score]
  }
}

// ============================================================
// M2 enrichment tables
// ============================================================

table "advisories" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "advisory_id" {
    type = text
    null = false
  }
  column "source" {
    type = text
    null = false
  }
  column "raw_json" {
    type = jsonb
  }
  column "fetched_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_advisory_source" {
    columns = [column.advisory_id, column.source]
    unique  = true
  }
}

table "advisory_aliases" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "advisory_id" {
    type = text
    null = false
  }
  column "alias" {
    type = text
    null = false
  }
  column "created_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_alias_lookup" {
    columns = [column.alias]
  }
  index "idx_advisory_alias_unique" {
    columns = [column.advisory_id, column.alias]
    unique  = true
  }
}

table "advisory_cvss_snapshots" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "cve_id" {
    type = text
    null = false
  }
  column "cvss_version" {
    type = text
    null = false
  }
  column "cvss_score" {
    type = real
    null = false
  }
  column "cvss_vector" {
    type = text
  }
  column "source" {
    type = text
    null = false
  }
  column "fetched_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_cvss_cve_source" {
    columns = [column.cve_id, column.source]
    unique  = true
  }
}

table "advisory_epss_snapshots" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "cve_id" {
    type = text
    null = false
  }
  column "epss_score" {
    type = real
    null = false
  }
  column "epss_percentile" {
    type = real
    null = false
  }
  column "epss_date" {
    type = date
    null = false
  }
  column "fetched_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_epss_cve_date" {
    columns = [column.cve_id, column.epss_date]
    unique  = true
  }
}

// ============================================================
// M0 additions
// ============================================================

table "scan_jobs" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "target_id" {
    type = uuid
    null = false
  }
  column "status" {
    type    = text
    null    = false
    default = "pending"
  }
  column "created_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  column "started_at" {
    type = timestamptz
  }
  column "completed_at" {
    type = timestamptz
  }
  column "error_message" {
    type = text
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_target" {
    columns     = [column.target_id]
    ref_columns = [table.targets.column.id]
    on_delete   = CASCADE
  }
}

table "stream_outbox" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "stream_name" {
    type = text
    null = false
  }
  column "payload" {
    type = jsonb
    null = false
  }
  column "published" {
    type    = boolean
    null    = false
    default = false
  }
  column "created_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
}

table "exploit_source_items" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "source" {
    type = text
    null = false
  }
  column "source_id" {
    type = text
    null = false
  }
  column "title" {
    type = text
  }
  column "url" {
    type = text
  }
  column "published_at" {
    type = timestamptz
  }
  column "created_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  index "idx_exploit_source" {
    columns = [column.source, column.source_id]
    unique  = true
  }
}

// ============================================================
// M3 tables
// ============================================================

table "job_leases" {
  schema = schema.public
  column "target_id" {
    type = uuid
  }
  column "holder_id" {
    type = text
    null = false
  }
  column "acquired_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  column "expires_at" {
    type = timestamptz
    null = false
  }
  column "job_id" {
    type = uuid
  }
  primary_key {
    columns = [column.target_id]
  }
  foreign_key "fk_target" {
    columns     = [column.target_id]
    ref_columns = [table.targets.column.id]
    on_delete   = CASCADE
  }
}

table "notification_delivery_log" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "target_id" {
    type = uuid
    null = false
  }
  column "advisory_id" {
    type = text
    null = false
  }
  column "diff_kind" {
    type = text
    null = false
  }
  column "channel" {
    type = text
    null = false
  }
  column "status" {
    type = text
    null = false
  }
  column "attempts" {
    type    = integer
    null    = false
    default = 0
  }
  column "last_attempt_at" {
    type = timestamptz
  }
  column "delivered_at" {
    type = timestamptz
  }
  column "dedup_key" {
    type = text
    null = false
  }
  column "created_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_target" {
    columns     = [column.target_id]
    ref_columns = [table.targets.column.id]
  }
  index "idx_delivery_dedup" {
    columns = [column.dedup_key, column.channel]
    unique  = true
  }
}

table "exploit_cve_links" {
  schema = schema.public
  column "id" {
    type    = uuid
    default = sql("gen_random_uuid()")
  }
  column "exploit_id" {
    type = uuid
    null = false
  }
  column "cve_id" {
    type = text
    null = false
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_exploit" {
    columns     = [column.exploit_id]
    ref_columns = [table.exploit_source_items.column.id]
    on_delete   = CASCADE
  }
  index "idx_exploit_cve" {
    columns = [column.exploit_id, column.cve_id]
    unique  = true
  }
}
