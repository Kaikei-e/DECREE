import { describe, expect, it } from 'vitest';
import type { Finding, Target } from '$lib/types/api';
import { CLUSTER_SPACING, computeLayout, parseSeverity, Y_SCALE } from './layout';
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
		const severities: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
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
});

describe('parseSeverity', () => {
	it('normalizes lowercase to uppercase', () => {
		expect(parseSeverity('critical')).toBe('CRITICAL');
		expect(parseSeverity('high')).toBe('HIGH');
		expect(parseSeverity('medium')).toBe('MEDIUM');
		expect(parseSeverity('low')).toBe('LOW');
		expect(parseSeverity('info')).toBe('INFO');
	});

	it('normalizes mixed case', () => {
		expect(parseSeverity('Critical')).toBe('CRITICAL');
		expect(parseSeverity('hIgH')).toBe('HIGH');
	});

	it('defaults to INFO for unknown values', () => {
		expect(parseSeverity('unknown')).toBe('INFO');
		expect(parseSeverity('')).toBe('INFO');
		expect(parseSeverity(undefined)).toBe('INFO');
	});
});
