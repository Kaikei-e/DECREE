// Match the Go gateway API exactly

export interface Project {
	id: string;
	name: string;
	created_at: string;
}

export interface Target {
	id: string;
	project_id: string;
	name: string;
	target_type: string;
	source_ref?: string;
	branch?: string;
	subpath?: string;
	exposure_class?: string;
	created_at: string;
}

export interface Finding {
	instance_id: string;
	target_id: string;
	target_name: string;
	package_name: string;
	package_version: string;
	ecosystem: string;
	advisory_id: string;
	severity?: string;
	decree_score?: number;
	epss_score?: number;
	cvss_score?: number;
	is_active: boolean;
	last_observed_at?: string;
}

export interface FindingDetail extends Finding {
	advisory_source: string;
	detection_evidence?: DetectionEvidence;
	cvss_vector?: string;
	reachability?: number;
	is_direct_dep?: boolean;
	dep_depth?: number;
	exposure_class?: string;
	fix_versions: string[];
	exploits: ExploitRef[];
	dependency_path: DependencyEdge[];
}

export interface DetectionEvidence {
	source: string;
	fetched_at?: string;
	summary?: string;
	aliases: string[];
	range_evaluation_status: 'supports_match' | 'contradicts_match' | 'inconclusive';
}

export interface ExploitRef {
	source: string;
	source_id: string;
	title?: string;
	url?: string;
	published_at?: string;
}

export interface DependencyEdge {
	from_pkg: string;
	to_pkg: string;
	dep_type: string;
}

/**
 * Payload published by the oracle diff engine on the `finding_changed` stream.
 * Deliberately narrower than `Finding`: it carries no cvss_score and no last_observed_at.
 */
export interface FindingChangedEvent {
	type: string;
	project_id: string;
	target_id: string;
	target_name: string;
	scan_id: string;
	instance_id: string;
	advisory_id: string;
	package_name: string;
	package_version: string;
	ecosystem: string;
	severity?: string;
	decree_score?: number;
	epss_score?: number;
	is_active: boolean;
	has_exploit: boolean;
}

export interface TimelineEvent {
	id: string;
	instance_id: string;
	scan_id: string;
	event_type: 'observed' | 'disappeared';
	occurred_at: string;
	advisory_id?: string;
	package_name?: string;
	severity?: string;
	decree_score?: number;
}

/**
 * One row per advisory, aggregated over its instances by the gateway.
 * Absent values are omitted from the JSON rather than sent as null.
 */
export interface AdvisoryGroup {
	advisory_id: string;
	severity?: string;
	max_decree_score?: number;
	epss_score?: number;
	cvss_score?: number;
	instance_count: number;
	target_count: number;
	/** Capped at 5 by the gateway; compare against target_count to know if more exist. */
	target_names: string[];
	package_names: string[];
	ecosystems: string[];
	is_active: boolean;
	first_observed_at?: string;
	last_observed_at?: string;
}

export interface Facets {
	ecosystems: string[];
	severity_counts: Record<string, number>;
	total: number;
}

export interface PagedResponse<T> {
	data: T[];
	next_cursor?: string;
	has_more: boolean;
}

export interface ApiError {
	error: {
		code: string;
		message: string;
	};
}
