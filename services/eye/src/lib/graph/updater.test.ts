import { describe, expect, it } from 'vitest';
import type { AdvisoryGroup, Finding, FindingChangedEvent, Target } from '$lib/types/api';
import { computeLayout } from './layout';
import { createEmptyGraph } from './model';
import {
	ADVISORY_NAME_CAP,
	type AdvisoryFilterState,
	type AdvisoryIndex,
	absorbAdvisoryInstances,
	advisoryGroups,
	applyAdvisoryEvent,
	applyFindingUpdate,
	buildAdvisoryIndex,
	type FindingUpdate,
	matchesAdvisoryFilters,
	summariseAdvisory,
	toAdvisoryInstance,
} from './updater';

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

function makeGroup(overrides: Partial<AdvisoryGroup> = {}): AdvisoryGroup {
	return {
		advisory_id: 'GHSA-1234',
		severity: 'high',
		max_decree_score: 6,
		epss_score: 0.4,
		cvss_score: 7.8,
		instance_count: 2,
		target_count: 2,
		target_names: ['api', 'web'],
		package_names: ['lodash'],
		ecosystems: ['npm'],
		is_active: true,
		first_observed_at: '2025-01-01T00:00:00Z',
		last_observed_at: '2025-06-01T00:00:00Z',
		...overrides,
	};
}

function makeEvent(overrides: Partial<FindingChangedEvent> = {}): FindingChangedEvent {
	return {
		type: 'finding.score_change',
		project_id: 'proj-1',
		target_id: 'target-1',
		target_name: 'api',
		scan_id: 'scan-1',
		instance_id: 'inst-1',
		advisory_id: 'GHSA-1234',
		package_name: 'lodash',
		package_version: '4.17.20',
		ecosystem: 'npm',
		severity: 'high',
		decree_score: 6,
		epss_score: 0.4,
		is_active: true,
		has_exploit: false,
		...overrides,
	};
}

const ACTIVE_ONLY: AdvisoryFilterState = { activeOnly: true };

/** Two instances of one advisory, on two targets — the shape makeGroup() describes. */
function twoInstanceIndex(
	filters: AdvisoryFilterState = ACTIVE_ONLY,
	group: Partial<AdvisoryGroup> = {},
): AdvisoryIndex {
	return buildAdvisoryIndex(
		[makeGroup(group)],
		[
			makeFinding({
				instance_id: 'inst-1',
				target_id: 'target-1',
				target_name: 'api',
				decree_score: 6,
				epss_score: 0.4,
				cvss_score: 7.8,
				severity: 'high',
			}),
			makeFinding({
				instance_id: 'inst-2',
				target_id: 'target-2',
				target_name: 'web',
				decree_score: 4,
				epss_score: 0.2,
				cvss_score: 7.8,
				severity: 'medium',
			}),
		],
		filters,
	);
}

describe('buildAdvisoryIndex', () => {
	it('calls a group exact when the loaded instances account for its whole count', () => {
		const index = twoInstanceIndex();
		expect(index.entries.get('GHSA-1234')?.exact).toBe(true);
		expect(index.entries.get('GHSA-1234')?.instances.size).toBe(2);
	});

	it('calls a group inexact when the loader returned fewer instances than it counts', () => {
		const index = buildAdvisoryIndex(
			[makeGroup({ instance_count: 40 })],
			[makeFinding({ instance_id: 'inst-1' })],
			ACTIVE_ONLY,
		);
		expect(index.entries.get('GHSA-1234')?.exact).toBe(false);
	});

	it('keeps every group the server returned, in the order it returned them', () => {
		const index = buildAdvisoryIndex(
			[makeGroup({ advisory_id: 'B' }), makeGroup({ advisory_id: 'A' })],
			[],
			ACTIVE_ONLY,
		);
		expect(advisoryGroups(index).map((g) => g.advisory_id)).toEqual(['B', 'A']);
	});
});

describe('summariseAdvisory', () => {
	it('reproduces the aggregates the gateway computes over the same instances', () => {
		const instances = [
			toAdvisoryInstance(
				makeFinding({
					instance_id: 'a',
					target_id: 't1',
					target_name: 'web',
					package_name: 'lodash',
					decree_score: 4,
					epss_score: 0.2,
					cvss_score: 7.1,
					severity: 'medium',
				}),
			),
			toAdvisoryInstance(
				makeFinding({
					instance_id: 'b',
					target_id: 't2',
					target_name: 'api',
					package_name: 'underscore',
					decree_score: 8.5,
					epss_score: 0.9,
					cvss_score: 9.8,
					severity: 'critical',
					is_active: false,
				}),
			),
		];

		const group = summariseAdvisory('GHSA-1234', instances);

		expect(group.max_decree_score).toBe(8.5);
		expect(group.epss_score).toBe(0.9);
		expect(group.cvss_score).toBe(9.8);
		expect(group.instance_count).toBe(2);
		expect(group.target_count).toBe(2);
		expect(group.target_names).toEqual(['api', 'web']);
		expect(group.package_names).toEqual(['lodash', 'underscore']);
		expect(group.ecosystems).toEqual(['npm']);
		expect(group.severity).toBe('critical');
		expect(group.is_active).toBe(true);
	});

	it('caps the sample name lists the way the gateway does', () => {
		const instances = Array.from({ length: 8 }, (_, i) =>
			toAdvisoryInstance(
				makeFinding({
					instance_id: `i${i}`,
					target_id: `t${i}`,
					target_name: `target-${i}`,
					package_name: `pkg-${i}`,
				}),
			),
		);

		const group = summariseAdvisory('GHSA-1234', instances);

		expect(group.target_names).toHaveLength(ADVISORY_NAME_CAP);
		expect(group.package_names).toHaveLength(ADVISORY_NAME_CAP);
		expect(group.target_count).toBe(8);
	});

	it('keeps the CVSS the list endpoint supplied when no instance carries one', () => {
		const instances = [
			toAdvisoryInstance(makeFinding({ instance_id: 'a', cvss_score: undefined })),
		];
		const group = summariseAdvisory('GHSA-1234', instances, makeGroup());
		expect(group.cvss_score).toBe(7.8);
		expect(group.first_observed_at).toBe('2025-01-01T00:00:00Z');
	});

	it('leaves an aggregate absent when no instance has a value for it', () => {
		const instances = [
			toAdvisoryInstance(
				makeFinding({ instance_id: 'a', decree_score: undefined, severity: undefined }),
			),
		];
		const group = summariseAdvisory('GHSA-1234', instances);
		expect(group.max_decree_score).toBeUndefined();
		expect(group.severity).toBeUndefined();
	});
});

describe('matchesAdvisoryFilters', () => {
	const instance = toAdvisoryInstance(
		makeFinding({ severity: 'high', epss_score: 0.4, ecosystem: 'npm', target_name: 'api' }),
	);

	it('drops an inactive instance while active_only is on', () => {
		const inactive = { ...instance, is_active: false };
		expect(matchesAdvisoryFilters(inactive, { activeOnly: true })).toBe(false);
		expect(matchesAdvisoryFilters(inactive, { activeOnly: false })).toBe(true);
	});

	it('matches the severity filter exactly, and counts an absent label as unknown', () => {
		expect(matchesAdvisoryFilters(instance, { activeOnly: true, severity: 'high' })).toBe(true);
		expect(matchesAdvisoryFilters(instance, { activeOnly: true, severity: 'critical' })).toBe(
			false,
		);
		const unlabelled = { ...instance, severity: undefined };
		expect(matchesAdvisoryFilters(unlabelled, { activeOnly: true, severity: 'unknown' })).toBe(
			true,
		);
	});

	it('excludes an instance with no EPSS at all once a minimum is set', () => {
		const noEpss = { ...instance, epss_score: undefined };
		expect(matchesAdvisoryFilters(noEpss, { activeOnly: true, minEpss: 0.1 })).toBe(false);
		expect(matchesAdvisoryFilters(instance, { activeOnly: true, minEpss: 0.5 })).toBe(false);
		expect(matchesAdvisoryFilters(instance, { activeOnly: true, minEpss: 0.4 })).toBe(true);
	});

	it('excludes an instance below the minimum DECREE score, and one with no score at all', () => {
		const scored = { ...instance, decree_score: 6 };
		expect(matchesAdvisoryFilters(scored, { activeOnly: true, minScore: 7 })).toBe(false);
		expect(matchesAdvisoryFilters(scored, { activeOnly: true, minScore: 6 })).toBe(true);
		// The gateway only adds the condition above zero, so zero must not exclude anything.
		expect(matchesAdvisoryFilters(instance, { activeOnly: true, minScore: 0 })).toBe(true);
		expect(matchesAdvisoryFilters(instance, { activeOnly: true, minScore: 1 })).toBe(false);
	});

	it('matches the free-text term against package, advisory and target, case-insensitively', () => {
		expect(matchesAdvisoryFilters(instance, { activeOnly: true, q: 'LODASH' })).toBe(true);
		expect(matchesAdvisoryFilters(instance, { activeOnly: true, q: 'ghsa-12' })).toBe(true);
		expect(matchesAdvisoryFilters(instance, { activeOnly: true, q: 'api' })).toBe(true);
		expect(matchesAdvisoryFilters(instance, { activeOnly: true, q: 'nothing' })).toBe(false);
	});
});

describe('applyAdvisoryEvent', () => {
	it('raises the group score when an instance climbs above the current maximum', () => {
		const result = applyAdvisoryEvent(twoInstanceIndex(), makeEvent({ decree_score: 9.2 }));

		expect(result.outcome).toBe('applied');
		expect(result.index.entries.get('GHSA-1234')?.group.max_decree_score).toBe(9.2);
	});

	it('lowers the group score when the instance that held the maximum drops', () => {
		const result = applyAdvisoryEvent(twoInstanceIndex(), makeEvent({ decree_score: 1.5 }));

		expect(result.outcome).toBe('applied');
		// inst-2 still holds 4, so the group maximum is its score, not the new 1.5.
		expect(result.index.entries.get('GHSA-1234')?.group.max_decree_score).toBe(4);
	});

	it('refuses to lower an aggregate it cannot see all of, and flags the group instead', () => {
		const index = buildAdvisoryIndex(
			[makeGroup({ instance_count: 40, max_decree_score: 9 })],
			[makeFinding({ instance_id: 'inst-1', decree_score: 9 })],
			ACTIVE_ONLY,
		);

		const result = applyAdvisoryEvent(index, makeEvent({ decree_score: 1 }));

		expect(result.outcome).toBe('estimated');
		expect(result.index.entries.get('GHSA-1234')?.group.max_decree_score).toBe(9);
		expect(result.index.entries.get('GHSA-1234')?.group.instance_count).toBe(40);
	});

	it('still raises a maximum on an incomplete group, because a maximum can only climb', () => {
		const index = buildAdvisoryIndex(
			[makeGroup({ instance_count: 40, max_decree_score: 9 })],
			[makeFinding({ instance_id: 'inst-1', decree_score: 9 })],
			ACTIVE_ONLY,
		);

		const result = applyAdvisoryEvent(
			index,
			makeEvent({ decree_score: 9.9, severity: 'critical' }),
		);

		expect(result.outcome).toBe('estimated');
		const group = result.index.entries.get('GHSA-1234')?.group;
		expect(group?.max_decree_score).toBe(9.9);
		expect(group?.severity).toBe('critical');
	});

	it('drops a resolved instance out of the group while active_only is on', () => {
		const result = applyAdvisoryEvent(twoInstanceIndex(), makeEvent({ is_active: false }));

		const group = result.index.entries.get('GHSA-1234')?.group;
		expect(result.outcome).toBe('applied');
		expect(group?.instance_count).toBe(1);
		expect(group?.target_count).toBe(1);
		expect(group?.target_names).toEqual(['web']);
		expect(group?.max_decree_score).toBe(4);
	});

	it('removes the advisory entirely once its last active instance is resolved', () => {
		let index = twoInstanceIndex();
		index = applyAdvisoryEvent(index, makeEvent({ is_active: false })).index;
		const result = applyAdvisoryEvent(
			index,
			makeEvent({
				instance_id: 'inst-2',
				target_id: 'target-2',
				target_name: 'web',
				is_active: false,
			}),
		);

		expect(result.outcome).toBe('applied');
		expect(result.index.entries.has('GHSA-1234')).toBe(false);
		expect(advisoryGroups(result.index)).toHaveLength(0);
	});

	it('keeps a resolved instance in the group when the query asks for inactive ones too', () => {
		const index = twoInstanceIndex({ activeOnly: false });
		let result = applyAdvisoryEvent(index, makeEvent({ is_active: false }));
		result = applyAdvisoryEvent(
			result.index,
			makeEvent({
				instance_id: 'inst-2',
				target_id: 'target-2',
				target_name: 'web',
				is_active: false,
			}),
		);

		const group = result.index.entries.get('GHSA-1234')?.group;
		expect(group?.instance_count).toBe(2);
		expect(group?.is_active).toBe(false);
	});

	it('adds an instance the loader never saw to a group it already knows', () => {
		const result = applyAdvisoryEvent(
			twoInstanceIndex(),
			makeEvent({
				instance_id: 'inst-3',
				target_id: 'target-3',
				target_name: 'worker',
				decree_score: 5,
			}),
		);

		const group = result.index.entries.get('GHSA-1234')?.group;
		expect(group?.instance_count).toBe(3);
		expect(group?.target_count).toBe(3);
		expect(group?.target_names).toEqual(['api', 'web', 'worker']);
	});

	it('refuses to invent an advisory it has never loaded', () => {
		const index = twoInstanceIndex();
		const result = applyAdvisoryEvent(index, makeEvent({ advisory_id: 'CVE-2030-0001' }));

		expect(result.outcome).toBe('unknown-advisory');
		expect(result.index).toBe(index);
		expect(result.advisoryId).toBe('CVE-2030-0001');
	});

	it('ignores an event the current filters exclude and never loaded', () => {
		const index = buildAdvisoryIndex([], [], { activeOnly: true, ecosystem: 'Maven' });
		const result = applyAdvisoryEvent(index, makeEvent());

		expect(result.outcome).toBe('ignored');
		expect(result.index).toBe(index);
	});

	it('evicts an instance whose new severity no longer matches the filter', () => {
		const index = twoInstanceIndex({ activeOnly: true, severity: 'high' });
		const result = applyAdvisoryEvent(index, makeEvent({ severity: 'low' }));

		expect(result.outcome).toBe('applied');
		expect(result.index.entries.get('GHSA-1234')?.group.instance_count).toBe(1);
	});

	it('treats a null score on the wire as no score rather than zero', () => {
		const result = applyAdvisoryEvent(
			twoInstanceIndex(),
			makeEvent({ decree_score: null as unknown as number }),
		);

		expect(result.index.entries.get('GHSA-1234')?.group.max_decree_score).toBe(4);
	});

	it('leaves the index it was given untouched', () => {
		const index = twoInstanceIndex();
		const before = index.entries.get('GHSA-1234')?.group.max_decree_score;

		applyAdvisoryEvent(index, makeEvent({ decree_score: 9.9 }));

		expect(index.entries.get('GHSA-1234')?.group.max_decree_score).toBe(before);
	});
});

describe('absorbAdvisoryInstances', () => {
	it('replaces a group with one summarised from a complete instance set', () => {
		const index = buildAdvisoryIndex([makeGroup({ instance_count: 40 })], [], ACTIVE_ONLY);
		const absorbed = absorbAdvisoryInstances(index, 'GHSA-1234', [
			makeFinding({ instance_id: 'a', target_id: 't1', target_name: 'api', decree_score: 3 }),
			makeFinding({ instance_id: 'b', target_id: 't2', target_name: 'web', decree_score: 7 }),
		]);

		const entry = absorbed.entries.get('GHSA-1234');
		expect(entry?.exact).toBe(true);
		expect(entry?.group.instance_count).toBe(2);
		expect(entry?.group.max_decree_score).toBe(7);
	});

	it('appends an advisory the index had never seen', () => {
		const index = buildAdvisoryIndex([makeGroup({ advisory_id: 'A' })], [], ACTIVE_ONLY);
		const absorbed = absorbAdvisoryInstances(index, 'CVE-2030-0001', [
			makeFinding({ instance_id: 'a', advisory_id: 'CVE-2030-0001', decree_score: 7 }),
		]);

		expect(advisoryGroups(absorbed).map((g) => g.advisory_id)).toEqual(['A', 'CVE-2030-0001']);
	});

	it('removes an advisory whose instance set came back empty', () => {
		const index = twoInstanceIndex();
		const absorbed = absorbAdvisoryInstances(index, 'GHSA-1234', []);
		expect(absorbed.entries.has('GHSA-1234')).toBe(false);
	});
});
