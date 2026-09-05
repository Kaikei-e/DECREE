import { describe, expect, it } from 'vitest';
import type { Finding, Target } from '$lib/types/api';
import {
	CLUSTER_SPACING,
	computeLayout,
	EDGE_TYPE_ADVISORY,
	EDGE_TYPE_PACKAGE,
	JITTER_RANGE,
	NODE_SIZE_MAX,
	NODE_SIZE_MIN,
	nodeSizeFromDegree,
	parseSeverity,
	resolveGridSlot,
	Y_SCALE,
} from './layout';
import { SEVERITY_COLORS, type Severity } from './model';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
	return {
		instance_id: 'inst-1',
		target_id: 'target-1',
		target_name: 'my-app',
		package_name: 'lodash',
		package_version: '4.17.20',
		ecosystem: 'npm',
		advisory_id: 'GHSA-1234',
		is_active: true,
		...overrides,
	};
}

function makeTarget(overrides: Partial<Target> = {}): Target {
	return {
		id: 'target-1',
		project_id: 'proj-1',
		name: 'my-app',
		target_type: 'image',
		created_at: '2025-01-01T00:00:00Z',
		...overrides,
	};
}

describe('computeLayout', () => {
	it('assigns findings for the same target to the same cluster', () => {
		const findings = [
			makeFinding({ instance_id: 'a', target_id: 't1' }),
			makeFinding({ instance_id: 'b', target_id: 't1' }),
		];
		const targets = [makeTarget({ id: 't1', name: 'app' })];
		const graph = computeLayout(findings, targets);

		expect(graph.clusters).toHaveLength(1);
		expect(graph.clusters[0]?.id).toBe('t1');
		expect(graph.clusters[0]?.nodes).toContain('a');
		expect(graph.clusters[0]?.nodes).toContain('b');
	});

	it('creates separate clusters for different targets', () => {
		const findings = [
			makeFinding({ instance_id: 'a', target_id: 't1' }),
			makeFinding({ instance_id: 'b', target_id: 't2' }),
		];
		const targets = [
			makeTarget({ id: 't1', name: 'app1' }),
			makeTarget({ id: 't2', name: 'app2' }),
		];
		const graph = computeLayout(findings, targets);

		expect(graph.clusters).toHaveLength(2);
		const clusterIds = graph.clusters.map((c) => c.id);
		expect(clusterIds).toContain('t1');
		expect(clusterIds).toContain('t2');
	});

	it('spaces clusters by CLUSTER_SPACING', () => {
		const findings = [
			makeFinding({ instance_id: 'a', target_id: 't1' }),
			makeFinding({ instance_id: 'b', target_id: 't2' }),
		];
		const targets = [
			makeTarget({ id: 't1', name: 'app1' }),
			makeTarget({ id: 't2', name: 'app2' }),
		];
		const graph = computeLayout(findings, targets);

		const centers = graph.clusters.map((c) => c.centerX).sort((a, b) => a - b);
		expect((centers[1] ?? 0) - (centers[0] ?? 0)).toBe(CLUSTER_SPACING);
	});

	it('sets Y coordinate proportional to decree_score', () => {
		const findings = [
			makeFinding({ instance_id: 'a', decree_score: 5.0 }),
			makeFinding({ instance_id: 'b', decree_score: 10.0 }),
		];
		const targets = [makeTarget()];
		const graph = computeLayout(findings, targets);

		const nodeA = graph.nodes.get('a');
		const nodeB = graph.nodes.get('b');
		expect(nodeA).toBeDefined();
		expect(nodeB).toBeDefined();
		expect(nodeA?.position.y).toBe(5.0 * Y_SCALE);
		expect(nodeB?.position.y).toBe(10.0 * Y_SCALE);
	});

	it('defaults decree_score to 0 when not provided', () => {
		const findings = [makeFinding({ instance_id: 'a' })];
		const targets = [makeTarget()];
		const graph = computeLayout(findings, targets);

		const node = graph.nodes.get('a');
		expect(node?.position.y).toBe(0);
	});

	it('sets Z coordinate based on dep_depth (default 0 for Finding)', () => {
		const findings = [makeFinding({ instance_id: 'a' })];
		const targets = [makeTarget()];
		const graph = computeLayout(findings, targets);

		const node = graph.nodes.get('a');
		// dep_depth is not on Finding (only FindingDetail), so z should be near 0 (plus jitter)
		expect(node).toBeDefined();
		expect(Math.abs(node?.position.z ?? 0)).toBeLessThan(2);
	});

	it('maps severity to correct color', () => {
		const severities: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
		for (const sev of severities) {
			const findings = [makeFinding({ instance_id: `n-${sev}`, severity: sev })];
			const targets = [makeTarget()];
			const graph = computeLayout(findings, targets);
			const node = graph.nodes.get(`n-${sev}`);
			expect(node?.visual.color).toBe(SEVERITY_COLORS[sev]);
		}
	});

	it('clamps opacity from EPSS score between 0.3 and 1.0', () => {
		const findings = [
			makeFinding({ instance_id: 'low', epss_score: 0.1 }),
			makeFinding({ instance_id: 'mid', epss_score: 0.6 }),
			makeFinding({ instance_id: 'high', epss_score: 1.5 }),
			makeFinding({ instance_id: 'none' }),
		];
		const targets = [makeTarget()];
		const graph = computeLayout(findings, targets);

		expect(graph.nodes.get('low')?.visual.opacity).toBe(0.3);
		expect(graph.nodes.get('mid')?.visual.opacity).toBe(0.6);
		expect(graph.nodes.get('high')?.visual.opacity).toBe(1.0);
		expect(graph.nodes.get('none')?.visual.opacity).toBe(0.5); // default
	});

	it('detects pulse for observations within 24h', () => {
		const now = new Date();
		const recent = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
		const old = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(); // 2 days ago

		const findings = [
			makeFinding({ instance_id: 'recent', last_observed_at: recent }),
			makeFinding({ instance_id: 'old', last_observed_at: old }),
			makeFinding({ instance_id: 'never' }),
		];
		const targets = [makeTarget()];
		const graph = computeLayout(findings, targets);

		expect(graph.nodes.get('recent')?.visual.pulse).toBe(true);
		expect(graph.nodes.get('old')?.visual.pulse).toBe(false);
		expect(graph.nodes.get('never')?.visual.pulse).toBe(false);
	});

	it('avoids exact overlap for nodes in the same cluster', () => {
		const findings = Array.from({ length: 20 }, (_, i) =>
			makeFinding({
				instance_id: `node-${i}`,
				decree_score: 5.0,
			}),
		);
		const targets = [makeTarget()];
		const graph = computeLayout(findings, targets);

		const positions = new Set<string>();
		for (const [, node] of graph.nodes) {
			const key = `${node.position.x},${node.position.y},${node.position.z}`;
			expect(positions.has(key)).toBe(false);
			positions.add(key);
		}
	});

	it('spreads nodes within a cluster across both x and z axes for skyline readability', () => {
		const findings = Array.from({ length: 12 }, (_, i) =>
			makeFinding({
				instance_id: `grid-${i}`,
				decree_score: 4.0 + i * 0.05,
			}),
		);
		const targets = [makeTarget()];
		const graph = computeLayout(findings, targets);

		const xValues = new Set<number>();
		const zValues = new Set<number>();
		for (const [, node] of graph.nodes) {
			xValues.add(Number(node.position.x.toFixed(2)));
			zValues.add(Number(node.position.z.toFixed(2)));
		}

		expect(xValues.size).toBeGreaterThan(2);
		expect(zValues.size).toBeGreaterThan(2);
	});
});

describe('parseSeverity', () => {
	it('normalizes lowercase to uppercase', () => {
		expect(parseSeverity('critical')).toBe('CRITICAL');
		expect(parseSeverity('high')).toBe('HIGH');
		expect(parseSeverity('medium')).toBe('MEDIUM');
		expect(parseSeverity('low')).toBe('LOW');
		expect(parseSeverity('info')).toBe('UNKNOWN');
	});

	it('normalizes mixed case', () => {
		expect(parseSeverity('Critical')).toBe('CRITICAL');
		expect(parseSeverity('hIgH')).toBe('HIGH');
	});

	it('reports missing or unrecognised severity as UNKNOWN, never as a safe level', () => {
		expect(parseSeverity('unknown')).toBe('UNKNOWN');
		expect(parseSeverity('')).toBe('UNKNOWN');
		expect(parseSeverity(undefined)).toBe('UNKNOWN');
	});
});

describe('nodeSizeFromDegree', () => {
	it('gives isolated nodes the minimum size', () => {
		expect(nodeSizeFromDegree(0)).toBe(NODE_SIZE_MIN);
	});

	it('grows with connection count', () => {
		expect(nodeSizeFromDegree(1)).toBeGreaterThan(nodeSizeFromDegree(0));
		expect(nodeSizeFromDegree(4)).toBeGreaterThan(nodeSizeFromDegree(1));
	});

	it('clamps at the maximum size', () => {
		expect(nodeSizeFromDegree(100)).toBe(NODE_SIZE_MAX);
	});
});

describe('resolveGridSlot', () => {
	it('keeps the node inside its assigned grid slot', () => {
		const used = new Set<string>();
		const first = resolveGridSlot(10, 4, 0, 'seed-a', used);
		expect(Math.abs(first.x - 10)).toBeLessThanOrEqual(JITTER_RANGE);
		expect(Math.abs(first.z - 4)).toBeLessThanOrEqual(JITTER_RANGE);
	});

	it('perturbs the assigned slot on collision instead of collapsing to the origin', () => {
		const used = new Set<string>();
		resolveGridSlot(10, 4, 0, 'seed-a', used);
		// Same seed and slot: the first candidate is already taken, so it must retry in place.
		const second = resolveGridSlot(10, 4, 0, 'seed-a', used);
		expect(Math.abs(second.x - 10)).toBeLessThanOrEqual(JITTER_RANGE);
		expect(Math.abs(second.z - 4)).toBeLessThanOrEqual(JITTER_RANGE);
	});

	it('never hands out the same position twice', () => {
		const used = new Set<string>();
		const a = resolveGridSlot(10, 4, 0, 'seed-a', used);
		const b = resolveGridSlot(10, 4, 0, 'seed-a', used);
		expect(`${a.x},${a.z}`).not.toBe(`${b.x},${b.z}`);
	});
});

describe('computeLayout edges', () => {
	it('connects findings that share a package across targets', () => {
		const findings = [
			makeFinding({ instance_id: 'a', target_id: 't1', decree_score: 9 }),
			makeFinding({ instance_id: 'b', target_id: 't2', decree_score: 5, advisory_id: 'GHSA-9' }),
			makeFinding({ instance_id: 'c', target_id: 't3', decree_score: 1, advisory_id: 'GHSA-8' }),
		];
		const targets = [makeTarget({ id: 't1' }), makeTarget({ id: 't2' }), makeTarget({ id: 't3' })];
		const graph = computeLayout(findings, targets);

		expect(graph.edges).toHaveLength(2);
		for (const edge of graph.edges) {
			expect(edge.depType).toBe(EDGE_TYPE_PACKAGE);
			// Highest score becomes the cohort hub
			expect(edge.source).toBe('a');
		}
	});

	it('connects findings that share an advisory when the package differs', () => {
		const findings = [
			makeFinding({ instance_id: 'a', target_id: 't1', package_name: 'left', decree_score: 9 }),
			makeFinding({ instance_id: 'b', target_id: 't2', package_name: 'right', decree_score: 2 }),
		];
		const targets = [makeTarget({ id: 't1' }), makeTarget({ id: 't2' })];
		const graph = computeLayout(findings, targets);

		expect(graph.edges).toHaveLength(1);
		expect(graph.edges[0]?.depType).toBe(EDGE_TYPE_ADVISORY);
	});

	it('does not duplicate an edge when a pair shares both package and advisory', () => {
		const findings = [
			makeFinding({ instance_id: 'a', target_id: 't1', decree_score: 9 }),
			makeFinding({ instance_id: 'b', target_id: 't2', decree_score: 2 }),
		];
		const targets = [makeTarget({ id: 't1' }), makeTarget({ id: 't2' })];
		const graph = computeLayout(findings, targets);

		expect(graph.edges).toHaveLength(1);
		expect(graph.edges[0]?.depType).toBe(EDGE_TYPE_PACKAGE);
	});

	it('emits no edges when nothing is shared', () => {
		const findings = [
			makeFinding({ instance_id: 'a', package_name: 'one', advisory_id: 'GHSA-1' }),
			makeFinding({ instance_id: 'b', package_name: 'two', advisory_id: 'GHSA-2' }),
		];
		const graph = computeLayout(findings, [makeTarget()]);
		expect(graph.edges).toHaveLength(0);
	});

	it('keeps the cohort star linear rather than a clique', () => {
		const findings = Array.from({ length: 10 }, (_, i) =>
			makeFinding({ instance_id: `n${i}`, advisory_id: `GHSA-${i}`, decree_score: 10 - i }),
		);
		const graph = computeLayout(findings, [makeTarget()]);
		expect(graph.edges).toHaveLength(9);
	});

	it('only references node ids that exist in the graph', () => {
		const findings = Array.from({ length: 6 }, (_, i) =>
			makeFinding({ instance_id: `n${i}`, decree_score: i }),
		);
		const graph = computeLayout(findings, [makeTarget()]);
		for (const edge of graph.edges) {
			expect(graph.nodes.has(edge.source)).toBe(true);
			expect(graph.nodes.has(edge.target)).toBe(true);
			expect(edge.source).not.toBe(edge.target);
		}
	});

	it('derives visual.size from the connection count', () => {
		const findings = [
			makeFinding({ instance_id: 'hub', decree_score: 9 }),
			makeFinding({ instance_id: 'spoke-1', decree_score: 5 }),
			makeFinding({ instance_id: 'spoke-2', decree_score: 4 }),
			makeFinding({
				instance_id: 'lonely',
				package_name: 'other',
				advisory_id: 'GHSA-lonely',
				decree_score: 3,
			}),
		];
		const graph = computeLayout(findings, [makeTarget()]);

		const hub = graph.nodes.get('hub');
		const spoke = graph.nodes.get('spoke-1');
		const lonely = graph.nodes.get('lonely');

		expect(lonely?.visual.size).toBe(NODE_SIZE_MIN);
		expect(spoke?.visual.size).toBeGreaterThan(lonely?.visual.size ?? 0);
		expect(hub?.visual.size).toBeGreaterThan(spoke?.visual.size ?? 0);
	});
});
