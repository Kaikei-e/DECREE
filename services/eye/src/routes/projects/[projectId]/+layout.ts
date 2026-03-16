import { getFindings, getTargets, getTopRisks } from '$lib/api/client';
import type { LayoutLoad } from './$types';

export const ssr = false;

export const load: LayoutLoad = async ({ params, fetch }) => {
	const { projectId } = params;
	const [targets, findings, topRisks] = await Promise.all([
		getTargets(projectId, fetch),
		getFindings(projectId, { active_only: true }, fetch),
		getTopRisks(projectId, undefined, fetch),
	]);

	return {
		projectId,
		targets,
		findings: findings.data,
		topRisks,
	};
};
