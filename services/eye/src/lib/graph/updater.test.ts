import { describe, expect, it } from 'vitest';
import type { Finding, Target } from '$lib/types/api';
import { computeLayout } from './layout';
import { createEmptyGraph } from './model';
import { applyFindingUpdate, type FindingUpdate } from './updater';

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

describe('applyFindingUpdate', () => {
	it('adds a new finding as a node with isNew=true', () => {
		const graph = createEmptyGraph();
		const targets = [makeTarget()];
		const finding = makeFinding({ instance_id: 'new-1', decree_score: 7.5 });

		const updated = applyFindingUpdate(graph, finding, targets);

		expect(updated.nodes.has('new-1')).toBe(true);
		const node = updated.nodes.get('new-1');
		expect(node?.visual.isNew).toBe(true);
		expect(node?.decreeScore).toBe(7.5);
	});

	it('updates an existing finding with new score and visuals', () => {
		const initial = computeLayout(
			[makeFinding({ instance_id: 'x', decree_score: 3.0, severity: 'LOW' })],
			[makeTarget()],
		);
		const targets = [makeTarget()];

		const updatedFinding = makeFinding({
			instance_id: 'x',
			decree_score: 8.0,
			severity: 'CRITICAL',
			epss_score: 0.9,
		});

		const updated = applyFindingUpdate(initial, updatedFinding, targets);

		const node = updated.nodes.get('x');
		expect(node?.decreeScore).toBe(8.0);
		expect(node?.severity).toBe('CRITICAL');
		expect(node?.visual.color).toBe('#FF1744');
		expect(node?.visual.opacity).toBe(0.9);
		expect(node?.visual.isNew).toBe(false);
		expect(node?.visual.isDisappearing).toBe(false);
	});

	it('marks a deactivated finding as isDisappearing=true', () => {
		const initial = computeLayout(
			[makeFinding({ instance_id: 'y', is_active: true })],
			[makeTarget()],
		);
		const targets = [makeTarget()];

		const deactivated = makeFinding({
			instance_id: 'y',
			is_active: false,
		});

		const updated = applyFindingUpdate(initial, deactivated, targets);

		const node = updated.nodes.get('y');
		expect(node?.isActive).toBe(false);
		expect(node?.visual.isDisappearing).toBe(true);
		expect(node?.visual.isNew).toBe(false);
	});

	it('recalculates clusters when a new node is added', () => {
		const initial = computeLayout(
			[makeFinding({ instance_id: 'a', target_id: 't1' })],
			[makeTarget({ id: 't1' }), makeTarget({ id: 't2', name: 'app2' })],
		);
		const targets = [makeTarget({ id: 't1' }), makeTarget({ id: 't2', name: 'app2' })];

		const newFinding = makeFinding({
			instance_id: 'b',
			target_id: 't2',
			target_name: 'app2',
		});

		const updated = applyFindingUpdate(initial, newFinding, targets);

		// Should now have clusters for both targets
		const clusterIds = updated.clusters.map((c) => c.id);
		expect(clusterIds).toContain('t1');
		expect(clusterIds).toContain('t2');
		expect(updated.nodes.has('a')).toBe(true);
		expect(updated.nodes.has('b')).toBe(true);
	});

	it('returns the same graph for inactive finding that does not exist', () => {
		const graph = createEmptyGraph();
		const targets = [makeTarget()];
		const finding = makeFinding({ instance_id: 'ghost', is_active: false });

		const updated = applyFindingUpdate(graph, finding, targets);

		expect(updated).toBe(graph);
		expect(updated.nodes.size).toBe(0);
	});

	it('performs immutable updates (does not mutate original graph)', () => {
		const initial = computeLayout(
			[makeFinding({ instance_id: 'x', decree_score: 3.0 })],
			[makeTarget()],
		);
		const originalScore = initial.nodes.get('x')?.decreeScore;

		const targets = [makeTarget()];
		const updatedFinding = makeFinding({
			instance_id: 'x',
			decree_score: 9.0,
		});

		const updated = applyFindingUpdate(initial, updatedFinding, targets);

		// Original should be unchanged
		expect(initial.nodes.get('x')?.decreeScore).toBe(originalScore);
		expect(updated.nodes.get('x')?.decreeScore).toBe(9.0);
		expect(updated.nodes).not.toBe(initial.nodes);
	});
});

describe('applyFindingUpdate with an SSE payload', () => {
	// The oracle diff engine publishes neither cvss_score nor last_observed_at,
	// so applying one must not blank the values the list endpoint already provided.
	function makeSSEPayload(overrides: Partial<FindingUpdate> = {}): FindingUpdate {
		return {
			instance_id: 'x',
			target_id: 'target-1',
			target_name: 'my-app',
			package_name: 'lodash',
			package_version: '4.17.20',
			ecosystem: 'npm',
			advisory_id: 'GHSA-1234',
			severity: 'HIGH',
			decree_score: 9.1,
			epss_score: 0.42,
			is_active: true,
			...overrides,
		};
	}

	it('preserves the existing CVSS score when the payload omits it', () => {
		const initial = computeLayout(
			[makeFinding({ instance_id: 'x', decree_score: 3.0, cvss_score: 7.8 })],
			[makeTarget()],
		);

		const updated = applyFindingUpdate(initial, makeSSEPayload(), [makeTarget()]);

		expect(updated.nodes.get('x')?.cvssScore).toBe(7.8);
		expect(updated.nodes.get('x')?.decreeScore).toBe(9.1);
	});

	it('treats a payload without last_observed_at as observed now', () => {
		const initial = computeLayout(
			[makeFinding({ instance_id: 'x', last_observed_at: '2020-01-01T00:00:00Z' })],
			[makeTarget()],
		);

		const updated = applyFindingUpdate(initial, makeSSEPayload(), [makeTarget()]);

		const node = updated.nodes.get('x');
		expect(node?.visual.pulse).toBe(true);
		expect(node?.lastObservedAt).not.toBe('2020-01-01T00:00:00Z');
	});

	it('still honours an explicit last_observed_at when one is present', () => {
		const initial = computeLayout([makeFinding({ instance_id: 'x' })], [makeTarget()]);

		const updated = applyFindingUpdate(
			initial,
			makeSSEPayload({ last_observed_at: '2020-01-01T00:00:00Z' }),
			[makeTarget()],
		);

		expect(updated.nodes.get('x')?.lastObservedAt).toBe('2020-01-01T00:00:00Z');
		expect(updated.nodes.get('x')?.visual.pulse).toBe(false);
	});
});
