import type { GraphModel, Severity } from '$lib/graph/model';
import type { Finding } from '$lib/types/api';
import { parseSeverity } from './layout';
import { SEVERITY_COLORS } from './model';

export interface SeverityBreakdownItem {
	severity: Severity;
	count: number;
	color: string;
}

export interface VisualizationInsights {
	totalFindings: number;
	activeFindings: number;
	targetCount: number;
	criticalCount: number;
	pulsingCount: number;
	highestScore: number;
	largestCluster: {
		id: string;
		name: string;
		count: number;
	} | null;
	severityBreakdown: SeverityBreakdownItem[];
}

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export function buildVisualizationInsights(
	findings: Finding[],
	graphModel: GraphModel,
): VisualizationInsights {
	const counts = new Map<Severity, number>(SEVERITY_ORDER.map((severity) => [severity, 0]));

	let activeFindings = 0;
	let criticalCount = 0;
	let highestScore = 0;

	for (const finding of findings) {
		const severity = parseSeverity(finding.severity);
		counts.set(severity, (counts.get(severity) ?? 0) + 1);

		if (finding.is_active) activeFindings += 1;
		if (severity === 'CRITICAL') criticalCount += 1;
		highestScore = Math.max(highestScore, finding.decree_score ?? 0);
	}

	const severityBreakdown = SEVERITY_ORDER.map((severity) => ({
		severity,
		count: counts.get(severity) ?? 0,
		color: SEVERITY_COLORS[severity],
	}));

	const largestCluster = graphModel.clusters.reduce<VisualizationInsights['largestCluster']>(
		(currentLargest, cluster) => {
			if (!currentLargest || cluster.nodes.length > currentLargest.count) {
				return {
					id: cluster.id,
					name: cluster.name,
					count: cluster.nodes.length,
				};
			}

			return currentLargest;
		},
		null,
	);

	const pulsingCount = [...graphModel.nodes.values()].filter((node) => node.visual.pulse).length;

	return {
		totalFindings: findings.length,
		activeFindings,
		targetCount: graphModel.clusters.length,
		criticalCount,
		pulsingCount,
		highestScore,
		largestCluster,
		severityBreakdown,
	};
}

export function getTopVisibleRisks(findings: Finding[], limit = 8): Finding[] {
	return [...findings]
		.sort((a, b) => (b.decree_score ?? 0) - (a.decree_score ?? 0))
		.slice(0, limit);
}
