import type {
	ApiError,
	Finding,
	FindingDetail,
	PagedResponse,
	Project,
	Target,
	TimelineEvent,
} from '$lib/types/api';

export interface FindingFilterParams {
	severity?: string;
	ecosystem?: string;
	min_epss?: number;
	active_only?: boolean;
	cursor?: string;
	limit?: number;
}

export interface TimelineFilterParams {
	target_id?: string;
	event_type?: string;
	from?: string;
	to?: string;
	cursor?: string;
	limit?: number;
}

const BASE_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8400';

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
	const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
	if (entries.length === 0) return '';
	const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
	return `?${qs.join('&')}`;
}

async function request<T>(path: string): Promise<T> {
	const res = await fetch(`${BASE_URL}${path}`);
	if (!res.ok) {
		const body = (await res.json()) as ApiError;
		throw body;
	}
	return res.json() as Promise<T>;
}

export class ApiClient {
	getProjects(): Promise<Project[]> {
		return request<Project[]>('/api/v1/projects');
	}

	getTargets(projectId: string): Promise<Target[]> {
		return request<Target[]>(`/api/v1/projects/${projectId}/targets`);
	}

	getFindings(projectId: string, params?: FindingFilterParams): Promise<PagedResponse<Finding>> {
		const qs = buildQuery((params ?? {}) as Record<string, string | number | boolean | undefined>);
		return request<PagedResponse<Finding>>(`/api/v1/projects/${projectId}/findings${qs}`);
	}

	getFindingDetail(instanceId: string): Promise<FindingDetail> {
		return request<FindingDetail>(`/api/v1/findings/${instanceId}`);
	}

	getTopRisks(projectId: string, limit?: number): Promise<Finding[]> {
		const qs = buildQuery({ limit });
		return request<Finding[]>(`/api/v1/projects/${projectId}/top-risks${qs}`);
	}

	getTimeline(
		projectId: string,
		params?: TimelineFilterParams,
	): Promise<PagedResponse<TimelineEvent>> {
		const qs = buildQuery((params ?? {}) as Record<string, string | number | boolean | undefined>);
		return request<PagedResponse<TimelineEvent>>(`/api/v1/projects/${projectId}/timeline${qs}`);
	}
}

export const api = new ApiClient();
