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

import { env } from '$env/dynamic/public';

const BASE_URL = env.PUBLIC_GATEWAY_URL ?? 'http://localhost:8400';

interface DataEnvelope<T> {
	data: T;
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
	const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
	if (entries.length === 0) return '';
	const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
	return `?${qs.join('&')}`;
}

async function request<T>(path: string, unwrapData = true): Promise<T> {
	const res = await fetch(`${BASE_URL}${path}`);
	if (!res.ok) {
		const body = (await res.json()) as ApiError;
		throw body;
	}
	const body = (await res.json()) as T | DataEnvelope<T>;
	if (
		unwrapData &&
		typeof body === 'object' &&
		body !== null &&
		'data' in body &&
		!('has_more' in body)
	) {
		return (body as DataEnvelope<T>).data;
	}
	return body as T;
}

export class ApiClient {
	getProjects(): Promise<Project[]> {
		return request<Project[]>('/api/projects');
	}

	getTargets(projectId: string): Promise<Target[]> {
		return request<Target[]>(`/api/projects/${projectId}/targets`);
	}

	getFindings(projectId: string, params?: FindingFilterParams): Promise<PagedResponse<Finding>> {
		const qs = buildQuery((params ?? {}) as Record<string, string | number | boolean | undefined>);
		return request<PagedResponse<Finding>>(`/api/projects/${projectId}/findings${qs}`, false);
	}

	getFindingDetail(instanceId: string): Promise<FindingDetail> {
		return request<FindingDetail>(`/api/findings/${instanceId}`);
	}

	getTopRisks(projectId: string, limit?: number): Promise<Finding[]> {
		const qs = buildQuery({ limit });
		return request<Finding[]>(`/api/projects/${projectId}/top-risks${qs}`);
	}

	getTimeline(
		projectId: string,
		params?: TimelineFilterParams,
	): Promise<PagedResponse<TimelineEvent>> {
		const qs = buildQuery((params ?? {}) as Record<string, string | number | boolean | undefined>);
		return request<PagedResponse<TimelineEvent>>(`/api/projects/${projectId}/timeline${qs}`, false);
	}
}

export const api = new ApiClient();
