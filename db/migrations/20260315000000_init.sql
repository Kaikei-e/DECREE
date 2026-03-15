-- Create "projects" table
CREATE TABLE "public"."projects" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("id")
);

-- Create "targets" table
CREATE TABLE "public"."targets" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "project_id" uuid NOT NULL,
    "name" text NOT NULL,
    "target_type" text NOT NULL,
    "source_ref" text,
    "branch" text,
    "subpath" text,
    "exposure_class" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON DELETE CASCADE
);

-- Create "scans" table
CREATE TABLE "public"."scans" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "target_id" uuid NOT NULL,
    "started_at" timestamptz NOT NULL DEFAULT now(),
    "completed_at" timestamptz,
    "status" text NOT NULL,
    "sbom_hash" text,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_target" FOREIGN KEY ("target_id") REFERENCES "public"."targets" ("id") ON DELETE CASCADE
);

-- Create "vulnerability_instances" table
CREATE TABLE "public"."vulnerability_instances" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "target_id" uuid NOT NULL,
    "package_name" text NOT NULL,
    "package_version" text NOT NULL,
    "ecosystem" text NOT NULL,
    "advisory_id" text NOT NULL,
    "advisory_source" text NOT NULL,
    "dep_path_hash" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_target" FOREIGN KEY ("target_id") REFERENCES "public"."targets" ("id") ON DELETE CASCADE
);

-- Create "vulnerability_observations" table
CREATE TABLE "public"."vulnerability_observations" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "instance_id" uuid NOT NULL,
    "scan_id" uuid NOT NULL,
    "observed_at" timestamptz NOT NULL DEFAULT now(),
    "cvss_score" real,
    "cvss_vector" text,
    "epss_score" real,
    "epss_percentile" real,
    "decree_score" real,
    "severity" text NOT NULL,
    "reachability" real,
    "is_direct_dep" boolean,
    "dep_depth" integer,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_instance" FOREIGN KEY ("instance_id") REFERENCES "public"."vulnerability_instances" ("id") ON DELETE CASCADE,
    CONSTRAINT "fk_scan" FOREIGN KEY ("scan_id") REFERENCES "public"."scans" ("id") ON DELETE CASCADE
);

-- Create "vulnerability_disappearances" table
CREATE TABLE "public"."vulnerability_disappearances" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "instance_id" uuid NOT NULL,
    "scan_id" uuid NOT NULL,
    "disappeared_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_instance" FOREIGN KEY ("instance_id") REFERENCES "public"."vulnerability_instances" ("id") ON DELETE CASCADE,
    CONSTRAINT "fk_scan" FOREIGN KEY ("scan_id") REFERENCES "public"."scans" ("id") ON DELETE CASCADE
);

-- Create "advisory_fix_versions" table
CREATE TABLE "public"."advisory_fix_versions" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "instance_id" uuid NOT NULL,
    "fixed_version" text NOT NULL,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_instance" FOREIGN KEY ("instance_id") REFERENCES "public"."vulnerability_instances" ("id") ON DELETE CASCADE
);

-- Create "dependency_edges" table
CREATE TABLE "public"."dependency_edges" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "scan_id" uuid NOT NULL,
    "target_id" uuid NOT NULL,
    "from_pkg" text NOT NULL,
    "to_pkg" text NOT NULL,
    "dep_type" text NOT NULL,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_scan" FOREIGN KEY ("scan_id") REFERENCES "public"."scans" ("id") ON DELETE CASCADE,
    CONSTRAINT "fk_target" FOREIGN KEY ("target_id") REFERENCES "public"."targets" ("id") ON DELETE CASCADE
);

-- Create "current_finding_status" table
CREATE TABLE "public"."current_finding_status" (
    "instance_id" uuid NOT NULL,
    "target_id" uuid NOT NULL,
    "latest_scan_id" uuid NOT NULL,
    "is_active" boolean NOT NULL,
    "last_observed_at" timestamptz,
    "last_score" real,
    "last_severity" text,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("instance_id"),
    CONSTRAINT "fk_instance" FOREIGN KEY ("instance_id") REFERENCES "public"."vulnerability_instances" ("id") ON DELETE CASCADE,
    CONSTRAINT "fk_target" FOREIGN KEY ("target_id") REFERENCES "public"."targets" ("id") ON DELETE CASCADE,
    CONSTRAINT "fk_scan" FOREIGN KEY ("latest_scan_id") REFERENCES "public"."scans" ("id") ON DELETE CASCADE
);

-- Create "scan_jobs" table
CREATE TABLE "public"."scan_jobs" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "target_id" uuid NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "started_at" timestamptz,
    "completed_at" timestamptz,
    "error_message" text,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_target" FOREIGN KEY ("target_id") REFERENCES "public"."targets" ("id") ON DELETE CASCADE
);

-- Create "stream_outbox" table
CREATE TABLE "public"."stream_outbox" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "stream_name" text NOT NULL,
    "payload" jsonb NOT NULL,
    "published" boolean NOT NULL DEFAULT false,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("id")
);

-- Create "exploit_source_items" table
CREATE TABLE "public"."exploit_source_items" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "source" text NOT NULL,
    "source_id" text NOT NULL,
    "title" text,
    "url" text,
    "published_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "idx_exploit_source" ON "public"."exploit_source_items" ("source", "source_id");

-- Create "exploit_cve_links" table
CREATE TABLE "public"."exploit_cve_links" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "exploit_id" uuid NOT NULL,
    "cve_id" text NOT NULL,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_exploit" FOREIGN KEY ("exploit_id") REFERENCES "public"."exploit_source_items" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "idx_exploit_cve" ON "public"."exploit_cve_links" ("exploit_id", "cve_id");
