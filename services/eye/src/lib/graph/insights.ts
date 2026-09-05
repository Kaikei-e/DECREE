import type { GraphModel, Severity } from '$lib/graph/model';
import type { AdvisoryGroup, Finding } from '$lib/types/api';
import { parseSeverity } from './layout';
import { SEVERITY_COLORS } from './model';

export interface SeverityBreakdownItem {
	severity: Severity;
	count: number;
	color: string;
}

/** What a single counted row is: the scene draws advisories, the risk plot draws instances. */
export type InsightScope = 'advisory' | 'instance';

export interface VisualizationInsights {
	scope: InsightScope;
	/** Plural noun for one counted row, so the summary never says "findings" about advisories. */
	unitLabel: string;
	/** Plural noun for one cluster: the advisory scene groups by ecosystem, not by target. */
	clusterLabel: string;
	unitCount: number;
	activeCount: number;
	clusterCount: number;
	criticalCount: number;
	freshCount: number;
	highestScore: number;
	largestCluster: {
		id: string;
		name: string;
		count: number;
	} | null;
	severityBreakdown: SeverityBreakdownItem[];
	/** The loader hit its row cap, so these counts are a floor rather than a total. */
	truncated: boolean;
}

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

interface CountableRow {
	severity?: string;
	score?: number;
	isActive: boolean;
	lastObservedAt?: string;
}

export function buildInstanceInsights(
	findings: Finding[],
	graphModel: GraphModel,
	truncated = false,
): VisualizationInsights {
	return summarize(
		findings.map((finding) => ({
			severity: finding.severity,
			score: finding.decree_score,
			isActive: finding.is_active,
			lastObservedAt: finding.last_observed_at,
		})),
		graphModel,
		{ scope: 'instance', unitLabel: 'Instances', clusterLabel: 'Targets' },
		truncated,
	);
}

export function buildAdvisoryInsights(
	groups: AdvisoryGroup[],
	graphModel: GraphModel,
	truncated = false,
): VisualizationInsights {
	return summarize(
		groups.map((group) => ({
			severity: group.severity,
			score: group.max_decree_score,
			isActive: group.is_active,
			lastObservedAt: group.last_observed_at,
		})),
		graphModel,
		{ scope: 'advisory', unitLabel: 'Advisories', clusterLabel: 'Ecosystems' },
		truncated,
	);
}

function summarize(
	rows: CountableRow[],
	graphModel: GraphModel,
	labels: Pick<VisualizationInsights, 'scope' | 'unitLabel' | 'clusterLabel'>,
	truncated: boolean,
): VisualizationInsights {
	const counts = new Map<Severity, number>(SEVERITY_ORDER.map((severity) => [severity, 0]));
	const freshAfter = Date.now() - FRESH_WINDOW_MS;

	let activeCount = 0;
	let criticalCount = 0;
	let freshCount = 0;
	let highestScore = 0;

	for (const row of rows) {
		const severity = parseSeverity(row.severity);
		counts.set(severity, (counts.get(severity) ?? 0) + 1);

		if (row.isActive) activeCount += 1;
		if (severity === 'CRITICAL') criticalCount += 1;
		if (row.lastObservedAt && Date.parse(row.lastObservedAt) >= freshAfter) freshCount += 1;
		highestScore = Math.max(highestScore, row.score ?? 0);
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

	return {
		...labels,
		unitCount: rows.length,
		activeCount,
		clusterCount: graphModel.clusters.length,
		criticalCount,
		freshCount,
		highestScore,
		largestCluster,
		severityBreakdown,
		truncated,
	};
}

export function getTopAdvisories(advisories: AdvisoryGroup[], limit = 8): AdvisoryGroup[] {
	return [...advisories]
		.sort((a, b) => (b.max_decree_score ?? 0) - (a.max_decree_score ?? 0))
		.slice(0, limit);
}

export function getTopVisibleRisks(findings: Finding[], limit = 8): Finding[] {
	return [...findings]
		.sort((a, b) => (b.decree_score ?? 0) - (a.decree_score ?? 0))
		.slice(0, limit);
}
