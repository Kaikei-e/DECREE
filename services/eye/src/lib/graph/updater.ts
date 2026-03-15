import type { Finding, Target } from '$lib/types/api';
import { computeLayout, parseSeverity } from './layout';
import { type GraphModel, SEVERITY_COLORS } from './model';

/**
 * Apply a single finding update to the graph immutably.
 * Returns a new GraphModel with the change applied.
 */
export function applyFindingUpdate(
	graph: GraphModel,
	finding: Finding,
	targets: Target[],
): GraphModel {
	const existingNode = graph.nodes.get(finding.instance_id);

	if (existingNode && finding.is_active) {
		// Update existing active node: refresh score and visuals
		const severity = parseSeverity(finding.severity);
		const decreeScore = finding.decree_score ?? 0;
		const now = new Date();

		let opacity = 0.5;
		if (finding.epss_score != null) {
			opacity = Math.max(0.3, Math.min(1.0, finding.epss_score));
		}

		const pulse = finding.last_observed_at
			? now.getTime() - new Date(finding.last_observed_at).getTime() < 24 * 60 * 60 * 1000
			: false;

		const updatedNode = {
			...existingNode,
			severity,
			decreeScore,
			epssScore: finding.epss_score ?? 0,
			cvssScore: finding.cvss_score ?? 0,
			isActive: true,
			lastObservedAt: finding.last_observed_at ?? null,
			position: {
				...existingNode.position,
				y: decreeScore * 5, // Y_SCALE
			},
			visual: {
				...existingNode.visual,
				color: SEVERITY_COLORS[severity],
				opacity,
				pulse,
				isNew: false,
				isDisappearing: false,
			},
		};

		const newNodes = new Map(graph.nodes);
		newNodes.set(finding.instance_id, updatedNode);
		return { ...graph, nodes: newNodes };
	}

	if (!existingNode && finding.is_active) {
		// New finding: recompute full layout with this finding included
		const allFindings = buildFindingsList(graph, finding);
		const newGraph = computeLayout(allFindings, targets);

		// Mark the new node
		const newNode = newGraph.nodes.get(finding.instance_id);
		if (newNode) {
			newNode.visual.isNew = true;
		}

		return newGraph;
	}

	if (existingNode && !finding.is_active) {
		// Deactivating: mark as disappearing
		const updatedNode = {
			...existingNode,
			isActive: false,
			visual: {
				...existingNode.visual,
				isDisappearing: true,
				isNew: false,
			},
		};

		const newNodes = new Map(graph.nodes);
		newNodes.set(finding.instance_id, updatedNode);

		// Update cluster node list
		const newClusters = graph.clusters.map((c) => {
			if (c.id === existingNode.targetId) {
				return { ...c };
			}
			return c;
		});

		return { ...graph, nodes: newNodes, clusters: newClusters };
	}

	// Finding doesn't exist and is not active — no-op
	return graph;
}

/**
 * Reconstruct a findings list from the current graph plus a new finding.
 */
function buildFindingsList(graph: GraphModel, newFinding: Finding): Finding[] {
	const findings: Finding[] = [];
	for (const [, node] of graph.nodes) {
		findings.push({
			instance_id: node.id,
			target_id: node.targetId,
			target_name: node.targetName,
			package_name: node.packageName,
			package_version: node.packageVersion,
			ecosystem: node.ecosystem,
			advisory_id: node.advisoryId,
			severity: node.severity,
			decree_score: node.decreeScore,
			epss_score: node.epssScore,
			cvss_score: node.cvssScore,
			is_active: node.isActive,
			last_observed_at: node.lastObservedAt ?? undefined,
		});
	}
	findings.push(newFinding);
	return findings;
}
