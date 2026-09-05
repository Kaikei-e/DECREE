import {
	fetchAllAdvisories,
	fetchAllFindings,
	getFacets,
	getProject,
	getTargets,
} from '$lib/api/client';
import { parseFindingsQuery } from '$lib/state/query-params';
import type { LayoutLoad } from './$types';

export const ssr = false;

export const load: LayoutLoad = async ({ params, url, fetch }) => {
	const { projectId } = params;

	// Only the data-shaping params are read here. `view` and `finding` are deliberately
	// left to the page, so switching view or opening a finding does not refetch.
	const query = parseFindingsQuery(url.searchParams);

	const filters = {
		severity: query.severity,
		ecosystem: query.ecosystem,
		min_epss: query.minEpss,
		active_only: query.activeOnly,
		q: query.q,
	};

	const [project, targets, facets, findings, advisories] = await Promise.all([
		getProject(projectId, fetch),
		getTargets(projectId, fetch),
		getFacets(projectId, query.activeOnly, fetch),
		fetchAllFindings(projectId, { ...filters, sort: query.sort, order: query.order }, 2000, fetch),
		fetchAllAdvisories(projectId, { ...filters }, 2000, fetch),
	]);

	return {
		projectId,
		project,
		targets,
		facets,
		query,
		findings: findings.data,
		advisories: advisories.data,
		truncated: findings.truncated || advisories.truncated,
	};
};
