-- M2: Enrichment tables for NVD, EPSS, and advisory metadata caching

-- Advisory metadata cache (resource table)
CREATE TABLE "advisories" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "advisory_id" text NOT NULL,
  "source" text NOT NULL,
  "raw_json" jsonb,
  "fetched_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "idx_advisory_source" ON "advisories" ("advisory_id", "source");

-- Advisory alias cross-references (CVE↔GHSA↔OSV)
CREATE TABLE "advisory_aliases" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "advisory_id" text NOT NULL,
  "alias" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE INDEX "idx_alias_lookup" ON "advisory_aliases" ("alias");
CREATE UNIQUE INDEX "idx_advisory_alias_unique" ON "advisory_aliases" ("advisory_id", "alias");

-- NVD CVSS snapshots (fact table, INSERT ONLY)
CREATE TABLE "advisory_cvss_snapshots" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "cve_id" text NOT NULL,
  "cvss_version" text NOT NULL,
  "cvss_score" real NOT NULL,
  "cvss_vector" text,
  "source" text NOT NULL,
  "fetched_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "idx_cvss_cve_source" ON "advisory_cvss_snapshots" ("cve_id", "source");

-- EPSS snapshots (fact table, INSERT ONLY)
CREATE TABLE "advisory_epss_snapshots" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "cve_id" text NOT NULL,
  "epss_score" real NOT NULL,
  "epss_percentile" real NOT NULL,
  "epss_date" date NOT NULL,
  "fetched_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "idx_epss_cve_date" ON "advisory_epss_snapshots" ("cve_id", "epss_date");
