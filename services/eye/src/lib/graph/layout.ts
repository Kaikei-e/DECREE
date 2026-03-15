import type { Finding, Target } from '$lib/types/api';
import {
	type GraphCluster,
	type GraphEdge,
	type GraphModel,
	type GraphNode,
	type NodeVisualState,
	SEVERITY_COLORS,
	type Severity,
} from './model';

export const CLUSTER_SPACING = 8;
export const Y_SCALE = 5;
export const Z_SCALE = 3;
export const JITTER_RANGE = 2;

const VALID_SEVERITIES = new Set<Severity>(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);

export function parseSeverity(s: string | undefined): Severity {
	if (!s) return 'INFO';
	const upper = s.toUpperCase() as Severity;
	return VALID_SEVERITIES.has(upper) ? upper : 'INFO';
}

/**
 * Deterministic jitter from a string seed so layout is reproducible.
 */
function seededJitter(seed: string, range: number): number {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 31 + seed.charCodeAt(i)) | 0;
	}
	// Map hash to [-range/2, range/2]
	const norm = ((hash & 0x7fffffff) % 10000) / 10000;
	return (norm - 0.5) * range;
}

function isWithin24h(dateStr: string | undefined | null, now: Date): boolean {
	if (!dateStr) return false;
	const diff = now.getTime() - new Date(dateStr).getTime();
	return diff >= 0 && diff < 24 * 60 * 60 * 1000;
}

function computeVisualState(finding: Finding, severity: Severity, now: Date): NodeVisualState {
	const color = SEVERITY_COLORS[severity];

	let opacity = 0.5;
	if (finding.epss_score != null) {
		opacity = Math.max(0.3, Math.min(1.0, finding.epss_score));
	}

	return {
		color,
		opacity,
		size: 1.0,
		pulse: isWithin24h(finding.last_observed_at, now),
		isNew: false,
		isDisappearing: false,
	};
}

export function computeLayout(findings: Finding[], targets: Target[]): GraphModel {
	const now = new Date();
	const nodes = new Map<string, GraphNode>();
	const edges: GraphEdge[] = [];

	// Group findings by target_id
	const findingsByTarget = new Map<string, Finding[]>();
	for (const f of findings) {
		let list = findingsByTarget.get(f.target_id);
		if (!list) {
			list = [];
			findingsByTarget.set(f.target_id, list);
		}
		list.push(f);
	}

	// Build target name lookup
	const targetNameMap = new Map<string, string>();
	for (const t of targets) {
		targetNameMap.set(t.id, t.name);
	}

	// Create clusters from targets that have findings
	const targetIds = [...findingsByTarget.keys()].sort();
	const clusters: GraphCluster[] = targetIds.map((tid, idx) => ({
		id: tid,
		name: targetNameMap.get(tid) ?? tid,
		nodes: [],
		centerX: idx * CLUSTER_SPACING,
	}));

	const clusterMap = new Map<string, GraphCluster>();
	for (const c of clusters) {
		clusterMap.set(c.id, c);
	}

	// Track positions to avoid exact overlaps
	const usedPositions = new Set<string>();

	for (const finding of findings) {
		const cluster = clusterMap.get(finding.target_id);
		if (!cluster) continue;

		const severity = parseSeverity(finding.severity);
		const decreeScore = finding.decree_score ?? 0;
		const depDepth = 0; // dep_depth only available in FindingDetail

		let jitterX = seededJitter(finding.instance_id, JITTER_RANGE);
		let jitterZ = seededJitter(`${finding.instance_id}-z`, JITTER_RANGE * 0.5);
		let x = cluster.centerX + jitterX;
		const y = decreeScore * Y_SCALE;
		let z = depDepth * Z_SCALE + jitterZ;

		// Avoid exact overlaps by nudging
		let posKey = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
		let attempts = 0;
		while (usedPositions.has(posKey) && attempts < 20) {
			attempts++;
			jitterX = seededJitter(`${finding.instance_id}-${attempts}`, JITTER_RANGE);
			jitterZ = seededJitter(`${finding.instance_id}-z-${attempts}`, JITTER_RANGE * 0.5);
			x = cluster.centerX + jitterX;
			z = depDepth * Z_SCALE + jitterZ;
			posKey = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
		}
		usedPositions.add(posKey);

		const visual = computeVisualState(finding, severity, now);

		const node: GraphNode = {
			id: finding.instance_id,
			targetId: finding.target_id,
			targetName: finding.target_name,
			packageName: finding.package_name,
			packageVersion: finding.package_version,
			ecosystem: finding.ecosystem,
			advisoryId: finding.advisory_id,
			severity,
			decreeScore,
			epssScore: finding.epss_score ?? 0,
			cvssScore: finding.cvss_score ?? 0,
			depDepth,
			isActive: finding.is_active,
			lastObservedAt: finding.last_observed_at ?? null,
			position: { x, y, z },
			visual,
		};

		nodes.set(node.id, node);
		cluster.nodes.push(node.id);
	}

	return { nodes, edges, clusters };
}
