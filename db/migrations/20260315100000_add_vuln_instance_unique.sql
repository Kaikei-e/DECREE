-- Add unique index for vulnerability_instance upsert
CREATE UNIQUE INDEX idx_vuln_instance_key ON vulnerability_instances (target_id, package_name, package_version, ecosystem, advisory_id);
