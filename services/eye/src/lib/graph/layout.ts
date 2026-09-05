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
export const JITTER_RANGE = 0.35;
const CLUSTER_GRID_X_SPACING = 0.9;
const CLUSTER_GRID_Z_SPACING = 0.9;

export const NODE_SIZE_MIN = 1;
export const NODE_SIZE_MAX = 3;

/**
 * The list endpoint carries no dependency path, so edges come from the two relations it does
 * expose: findings sitting in the same package, and findings sharing one advisory.
 */
export const EDGE_TYPE_PACKAGE = 'shared-package';
export const EDGE_TYPE_ADVISORY = 'shared-advisory';

const VALID_SEVERITIES = new Set<Severity>(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);

export function parseSeverity(s: string | undefined): Severity {
	if (!s) return 'UNKNOWN';
	const upper = s.toUpperCase() as Severity;
	return VALID_SEVERITIES.has(upper) ? upper : 'UNKNOWN';
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

function positionKey(x: number, y: number, z: number): string {
	return `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
}

/**
 * Place a node inside the grid slot it was assigned, retrying with a different jitter — never a
 * different slot — so a collision perturbs the skyline instead of collapsing it to the centre.
 */
export function resolveGridSlot(
	baseX: number,
	baseZ: number,
	y: number,
	seed: string,
	used: Set<string>,
): { x: number; z: number } {
	let x = baseX + seededJitter(seed, JITTER_RANGE);
	let z = baseZ + seededJitter(`${seed}-z`, JITTER_RANGE);
	let key = positionKey(x, y, z);

	let attempts = 0;
	while (used.has(key) && attempts < 20) {
		attempts++;
		x = baseX + seededJitter(`${seed}-${attempts}`, JITTER_RANGE);
		z = baseZ + seededJitter(`${seed}-z-${attempts}`, JITTER_RANGE);
		key = positionKey(x, y, z);
	}

	used.add(key);
	return { x, z };
}

export function nodeSizeFromDegree(degree: number): number {
	return Math.min(NODE_SIZE_MAX, NODE_SIZE_MIN + Math.sqrt(degree));
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
		size: NODE_SIZE_MIN,
		pulse: isWithin24h(finding.last_observed_at, now),
		isNew: false,
		isDisappearing: false,
	};
}

function groupFindings(findings: Finding[], key: (f: Finding) => string): Map<string, Finding[]> {
	const groups = new Map<string, Finding[]>();
	for (const finding of findings) {
		const k = key(finding);
		let list = groups.get(k);
		if (!list) {
			list = [];
			groups.set(k, list);
		}
		list.push(finding);
	}
	return groups;
}

function byScoreThenId(a: Finding, b: Finding): number {
	const scoreDiff = (b.decree_score ?? 0) - (a.decree_score ?? 0);
	if (scoreDiff !== 0) return scoreDiff;
	return a.instance_id.localeCompare(b.instance_id);
}

/**
 * Each cohort becomes a star around its highest-scoring member, which keeps the edge count linear
 * in the number of findings instead of quadratic while still showing the shared blast radius.
 */
function addCohortEdges(
	cohorts: Map<string, Finding[]>,
	depType: string,
	edges: GraphEdge[],
	seenPairs: Set<string>,
) {
	for (const key of [...cohorts.keys()].sort()) {
		const members = (cohorts.get(key) ?? []).slice().sort(byScoreThenId);
		const hub = members[0];
		if (!hub || members.length < 2) continue;

		for (let i = 1; i < members.length; i++) {
			const member = members[i];
			if (!member || member.instance_id === hub.instance_id) continue;
			const pairKey =
				hub.instance_id < member.instance_id
					? `${hub.instance_id}|${member.instance_id}`
					: `${member.instance_id}|${hub.instance_id}`;
			if (seenPairs.has(pairKey)) continue;
			seenPairs.add(pairKey);
			edges.push({
				id: `${depType}:${pairKey}`,
				source: hub.instance_id,
				target: member.instance_id,
				depType,
			});
		}
	}
}

function buildEdges(findings: Finding[]): GraphEdge[] {
	const edges: GraphEdge[] = [];
	const seenPairs = new Set<string>();
	addCohortEdges(
		groupFindings(findings, (f) => `${f.ecosystem}\u0000${f.package_name}`),
		EDGE_TYPE_PACKAGE,
		edges,
		seenPairs,
	);
	addCohortEdges(
		groupFindings(findings, (f) => f.advisory_id),
		EDGE_TYPE_ADVISORY,
		edges,
		seenPairs,
	);
	return edges;
}

export function computeLayout(findings: Finding[], targets: Target[]): GraphModel {
	const now = new Date();
	const nodes = new Map<string, GraphNode>();

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

	const layoutIndexByInstance = new Map<string, { col: number; row: number }>();
	for (const [, clusterFindings] of findingsByTarget) {
		clusterFindings.sort(byScoreThenId);

		const columnCount = Math.max(2, Math.ceil(Math.sqrt(clusterFindings.length)));
		for (const [index, finding] of clusterFindings.entries()) {
			layoutIndexByInstance.set(finding.instance_id, {
				col: index % columnCount,
				row: Math.floor(index / columnCount),
			});
		}
	}

	for (const finding of findings) {
		const cluster = clusterMap.get(finding.target_id);
		if (!cluster) continue;

		const severity = parseSeverity(finding.severity);
		const decreeScore = finding.decree_score ?? 0;
		const depDepth = 0; // dep_depth only available in FindingDetail

		const clusterFindings = findingsByTarget.get(finding.target_id) ?? [finding];
		const columnCount = Math.max(2, Math.ceil(Math.sqrt(clusterFindings.length)));
		const rowCount = Math.max(1, Math.ceil(clusterFindings.length / columnCount));
		const layoutIndex = layoutIndexByInstance.get(finding.instance_id) ?? { col: 0, row: 0 };

		const baseX =
			cluster.centerX + (layoutIndex.col - (columnCount - 1) / 2) * CLUSTER_GRID_X_SPACING;
		const y = decreeScore * Y_SCALE;
		const baseZ =
			(layoutIndex.row - (rowCount - 1) / 2) * CLUSTER_GRID_Z_SPACING + depDepth * Z_SCALE;

		const { x, z } = resolveGridSlot(baseX, baseZ, y, finding.instance_id, usedPositions);

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

	const edges = buildEdges(findings).filter(
		(edge) => edge.source !== edge.target && nodes.has(edge.source) && nodes.has(edge.target),
	);

	const degrees = new Map<string, number>();
	for (const edge of edges) {
		degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
		degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
	}
	for (const [id, node] of nodes) {
		node.visual.size = nodeSizeFromDegree(degrees.get(id) ?? 0);
	}

	return { nodes, edges, clusters };
}
