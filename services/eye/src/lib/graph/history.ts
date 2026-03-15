import type { Target, TimelineEvent } from '$lib/types/api';
import { CLUSTER_SPACING, parseSeverity, Y_SCALE } from './layout';
import type { GraphModel } from './model';
import { createEmptyGraph, type GraphNode, type NodeVisualState, SEVERITY_COLORS } from './model';

/**
 * Reconstruct a GraphModel at a specific point in time from timeline events.
 * Only events up to `timestamp` are considered.
 */
export function reconstructAtTime(
	events: TimelineEvent[],
	timestamp: string,
	targets: Target[],
): GraphModel {
	const graph = createEmptyGraph();

	// Track active findings: instance_id → latest event
	const activeFindings = new Map<string, TimelineEvent>();

	for (const event of events) {
		if (event.occurred_at > timestamp) break;

		if (event.event_type === 'observed') {
			activeFindings.set(event.instance_id, event);
		} else if (event.event_type === 'disappeared') {
			activeFindings.delete(event.instance_id);
		}
	}

	// Build target index
	const targetIndex = new Map<string, number>();
	const targetNames = new Map<string, string>();
	for (const t of targets) {
		if (!targetIndex.has(t.id)) {
			targetIndex.set(t.id, targetIndex.size);
			targetNames.set(t.id, t.name);
		}
	}

	// Build clusters
	const clusterNodes = new Map<string, string[]>();

	let nodeIndex = 0;
	for (const [instanceId, event] of activeFindings) {
		const severity = parseSeverity(event.severity);
		const score = event.decree_score ?? 0;
		// We don't have full finding data in timeline events, so derive what we can
		const clusterIdx = 0; // Without target_id in timeline events, group together
		const x = clusterIdx * CLUSTER_SPACING + (nodeIndex % 5) * 1.5;
		const y = score * Y_SCALE;

		const visual: NodeVisualState = {
			color: SEVERITY_COLORS[severity],
			opacity: 0.7,
			size: 1,
			pulse: false,
			isNew: false,
			isDisappearing: false,
		};

		const node: GraphNode = {
			id: instanceId,
			targetId: '',
			targetName: '',
			packageName: event.package_name ?? '',
			packageVersion: '',
			ecosystem: '',
			advisoryId: event.advisory_id ?? instanceId.slice(0, 8),
			severity,
			decreeScore: score,
			epssScore: 0,
			cvssScore: 0,
			depDepth: 0,
			isActive: true,
			lastObservedAt: event.occurred_at,
			position: { x, y, z: 0 },
			visual,
		};

		graph.nodes.set(instanceId, node);

		const clusterId = 'default';
		const existing = clusterNodes.get(clusterId) ?? [];
		existing.push(instanceId);
		clusterNodes.set(clusterId, existing);

		nodeIndex++;
	}

	// Create clusters
	for (const [clusterId, nodes] of clusterNodes) {
		graph.clusters.push({
			id: clusterId,
			name: clusterId,
			nodes,
			centerX: 0,
		});
	}

	return graph;
}
