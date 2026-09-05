import type {
	AdvisoryGroup,
	ApiError,
	Facets,
	Finding,
	FindingDetail,
	PagedResponse,
	Project,
	Target,
	TimelineEvent,
} from '$lib/types/api';

export type FindingSort =
	| 'decree_score'
	| 'severity'
	| 'epss'
	| 'cvss'
	| 'package'
	| 'advisory'
	| 'target'
	| 'last_observed';

export type AdvisorySort =
	| 'decree_score'
	| 'severity'
	| 'epss'
	| 'cvss'
	| 'advisory'
	| 'instance_count'
	| 'last_observed';

export interface FindingFilterParams {
	severity?: string;
	/** Case-sensitive exact match — send a value the facets endpoint returned, unmodified. */
	ecosystem?: string;
	min_epss?: number;
	active_only?: boolean;
	q?: string;
	sort?: FindingSort;
	order?: 'asc' | 'desc';
	/** Exact advisory id — used to expand one grouped row into its instances. */
	advisory?: string;
	cursor?: string;
	limit?: number;
}

export interface AdvisoryFilterParams extends Omit<FindingFilterParams, 'sort' | 'advisory'> {
	sort?: AdvisorySort;
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

async function request<T>(
	path: string,
	unwrapData = true,
	customFetch: typeof fetch = fetch,
): Promise<T> {
	const res = await customFetch(`${BASE_URL}${path}`);
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

export function getProjects(customFetch: typeof fetch = fetch): Promise<Project[]> {
	return request<Project[]>('/api/projects', true, customFetch);
}

export function getProject(projectId: string, customFetch: typeof fetch = fetch): Promise<Project> {
	return request<Project>(`/api/projects/${projectId}`, true, customFetch);
}

/** Facet counts are computed independently of the caller's filters, so the option lists never collapse. */
export function getFacets(
	projectId: string,
	activeOnly?: boolean,
	customFetch: typeof fetch = fetch,
): Promise<Facets> {
	const qs = buildQuery({ active_only: activeOnly });
	return request<Facets>(`/api/projects/${projectId}/facets${qs}`, true, customFetch);
}

export function getTargets(
	projectId: string,
	customFetch: typeof fetch = fetch,
): Promise<Target[]> {
	return request<Target[]>(`/api/projects/${projectId}/targets`, true, customFetch);
}

export function getFindings(
	projectId: string,
	params?: FindingFilterParams,
	customFetch: typeof fetch = fetch,
): Promise<PagedResponse<Finding>> {
	const qs = buildQuery((params ?? {}) as Record<string, string | number | boolean | undefined>);
	return request<PagedResponse<Finding>>(
		`/api/projects/${projectId}/findings${qs}`,
		false,
		customFetch,
	);
}

/** The gateway caps a page at 200, so the spatial views have to walk the cursor to see the whole filter result. */
export const FINDINGS_PAGE_LIMIT = 200;

export interface AllPages<T> {
	data: T[];
	truncated: boolean;
}

/**
 * Follow `next_cursor` until the server runs out or `cap` rows have been collected.
 * The cap is what stops a pathological project from pulling an unbounded set into a view.
 */
async function fetchAllPages<T>(
	cap: number,
	fetchPage: (cursor: string | undefined) => Promise<PagedResponse<T>>,
): Promise<AllPages<T>> {
	const data: T[] = [];
	let cursor: string | undefined;

	while (data.length < cap) {
		const page = await fetchPage(cursor);
		data.push(...page.data);

		// A server that claims more but sends nothing would otherwise spin forever.
		if (!page.has_more || !page.next_cursor || page.data.length === 0) {
			return { data, truncated: false };
		}
		cursor = page.next_cursor;
	}

	return { data, truncated: true };
}

export function fetchAllFindings(
	projectId: string,
	params: Omit<FindingFilterParams, 'cursor' | 'limit'> = {},
	cap = 2000,
	customFetch: typeof fetch = fetch,
): Promise<AllPages<Finding>> {
	return fetchAllPages(cap, (cursor) =>
		getFindings(projectId, { ...params, cursor, limit: FINDINGS_PAGE_LIMIT }, customFetch),
	);
}

export function fetchAllAdvisories(
	projectId: string,
	params: Omit<AdvisoryFilterParams, 'cursor' | 'limit'> = {},
	cap = 2000,
	customFetch: typeof fetch = fetch,
): Promise<AllPages<AdvisoryGroup>> {
	return fetchAllPages(cap, (cursor) =>
		getAdvisories(projectId, { ...params, cursor, limit: FINDINGS_PAGE_LIMIT }, customFetch),
	);
}

export function getAdvisories(
	projectId: string,
	params?: AdvisoryFilterParams,
	customFetch: typeof fetch = fetch,
): Promise<PagedResponse<AdvisoryGroup>> {
	const qs = buildQuery((params ?? {}) as Record<string, string | number | boolean | undefined>);
	return request<PagedResponse<AdvisoryGroup>>(
		`/api/projects/${projectId}/advisories${qs}`,
		false,
		customFetch,
	);
}

export function getFindingDetail(
	instanceId: string,
	customFetch: typeof fetch = fetch,
): Promise<FindingDetail> {
	return request<FindingDetail>(`/api/findings/${instanceId}`, true, customFetch);
}

export function getTopRisks(
	projectId: string,
	limit?: number,
	customFetch: typeof fetch = fetch,
): Promise<Finding[]> {
	const qs = buildQuery({ limit });
	return request<Finding[]>(`/api/projects/${projectId}/top-risks${qs}`, true, customFetch);
}

export function getTimeline(
	projectId: string,
	params?: TimelineFilterParams,
	customFetch: typeof fetch = fetch,
): Promise<PagedResponse<TimelineEvent>> {
	const qs = buildQuery((params ?? {}) as Record<string, string | number | boolean | undefined>);
	return request<PagedResponse<TimelineEvent>>(
		`/api/projects/${projectId}/timeline${qs}`,
		false,
		customFetch,
	);
}
