import type { FindingSort } from '$lib/api/client';

export type ViewMode = '3d' | '2d' | 'table';

export interface FindingsQuery {
	severity?: string;
	/** Case-sensitive: the gateway compares ecosystem with an exact match. */
	ecosystem?: string;
	minEpss?: number;
	activeOnly: boolean;
	q?: string;
	sort: FindingSort;
	order: 'asc' | 'desc';
}

export interface ViewQuery {
	view: ViewMode;
	/** Selected advisory group. Set by the scene and the table, which are advisory-grained. */
	advisory?: string;
	/** Selected instance. Set by the beeswarm and by expanding an advisory. */
	finding?: string;
}

const SORT_KEYS: readonly FindingSort[] = [
	'decree_score',
	'severity',
	'epss',
	'cvss',
	'package',
	'advisory',
	'target',
	'last_observed',
];

const VIEW_MODES: readonly ViewMode[] = ['3d', '2d', 'table'];

/** The gateway rejects a longer term with a 400, so clamp rather than let the request fail. */
const MAX_QUERY_LENGTH = 128;

export const DEFAULT_FINDINGS_QUERY: FindingsQuery = {
	activeOnly: true,
	sort: 'decree_score',
	order: 'desc',
};

export const DEFAULT_VIEW_QUERY: ViewQuery = {
	view: '3d',
};

export function parseFindingsQuery(search: URLSearchParams): FindingsQuery {
	const query: FindingsQuery = {
		activeOnly: search.get('active') !== '0',
		sort: pick(search.get('sort'), SORT_KEYS, DEFAULT_FINDINGS_QUERY.sort),
		order: pick(search.get('order'), ['asc', 'desc'] as const, DEFAULT_FINDINGS_QUERY.order),
	};

	const severity = search.get('severity');
	if (severity) query.severity = severity;

	const ecosystem = search.get('ecosystem');
	if (ecosystem) query.ecosystem = ecosystem;

	const epss = Number.parseFloat(search.get('epss') ?? '');
	if (Number.isFinite(epss) && epss > 0 && epss <= 1) query.minEpss = epss;

	const term = search.get('q')?.trim().slice(0, MAX_QUERY_LENGTH);
	if (term) query.q = term;

	return query;
}

export function parseViewQuery(search: URLSearchParams): ViewQuery {
	const query: ViewQuery = {
		view: pick(search.get('view'), VIEW_MODES, DEFAULT_VIEW_QUERY.view),
	};

	const advisory = search.get('advisory');
	if (advisory) query.advisory = advisory;

	const finding = search.get('finding');
	if (finding) query.finding = finding;

	return query;
}

/**
 * Values equal to their default are omitted, and keys are written in a fixed order,
 * so the same state always produces the same URL.
 */
export function toSearchParams(
	findings: FindingsQuery,
	view: ViewQuery = DEFAULT_VIEW_QUERY,
): URLSearchParams {
	const search = new URLSearchParams();

	if (findings.severity) search.set('severity', findings.severity);
	if (findings.ecosystem) search.set('ecosystem', findings.ecosystem);
	if (findings.minEpss != null && findings.minEpss > 0) {
		search.set('epss', String(findings.minEpss));
	}
	if (!findings.activeOnly) search.set('active', '0');
	if (findings.q) search.set('q', findings.q);
	if (findings.sort !== DEFAULT_FINDINGS_QUERY.sort) search.set('sort', findings.sort);
	if (findings.order !== DEFAULT_FINDINGS_QUERY.order) search.set('order', findings.order);
	if (view.view !== DEFAULT_VIEW_QUERY.view) search.set('view', view.view);
	if (view.advisory) search.set('advisory', view.advisory);
	if (view.finding) search.set('finding', view.finding);

	return search;
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
	return allowed.includes(value as T) ? (value as T) : fallback;
}
