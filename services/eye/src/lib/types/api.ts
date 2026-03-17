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
