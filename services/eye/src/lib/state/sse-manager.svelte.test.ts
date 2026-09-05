import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeLayout } from '$lib/graph/layout';
import type { AdvisoryFilterState } from '$lib/graph/updater';
import type { AdvisoryGroup, Finding, Target } from '$lib/types/api';
import { appState } from './app.svelte';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_GATEWAY_URL: 'http://localhost:8400' },
}));

const api = vi.hoisted(() => ({ getFindings: vi.fn() }));
vi.mock('$lib/api/client', () => ({
	getFindings: api.getFindings,
	FINDINGS_PAGE_LIMIT: 200,
}));

import { liveAdvisories, sseManager } from './sse-manager.svelte';

class MockEventSource {
	url: string;
	onopen: ((e: Event) => void) | null = null;
	onerror: ((e: Event) => void) | null = null;
	closed = false;
	listeners = new Map<string, ((e: MessageEvent) => void)[]>();

	constructor(url: string) {
		this.url = url;
		MockEventSource.instances.push(this);
	}

	addEventListener(type: string, handler: (e: MessageEvent) => void) {
		const existing = this.listeners.get(type) ?? [];
		existing.push(handler);
		this.listeners.set(type, existing);
	}

	close() {
		this.closed = true;
	}

	emit(type: string, data: string, id = 'evt-1') {
		const event = new MessageEvent(type, { data, lastEventId: id });
		for (const handler of this.listeners.get(type) ?? []) {
			handler(event);
		}
	}

	open() {
		this.onopen?.(new Event('open'));
	}

	fail() {
		this.onerror?.(new Event('error'));
	}

	static instances: MockEventSource[] = [];
	static latest() {
		return MockEventSource.instances[MockEventSource.instances.length - 1];
	}
	static reset() {
		MockEventSource.instances = [];
	}
}

const target: Target = {
	id: 'target-1',
	project_id: 'proj-1',
	name: 'my-app',
	target_type: 'image',
	created_at: '2025-01-01T00:00:00Z',
};

function findingChangedPayload(overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		type: 'finding.new_cve',
		project_id: 'proj-1',
		target_id: 'target-1',
		target_name: 'my-app',
		scan_id: 'scan-1',
		instance_id: 'inst-1',
		advisory_id: 'GHSA-1234',
		package_name: 'lodash',
		package_version: '4.17.20',
		ecosystem: 'npm',
		severity: 'CRITICAL',
		decree_score: 9.4,
		epss_score: 0.71,
		is_active: true,
		has_exploit: true,
		...overrides,
	});
}

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
		...overrides,
	};
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
	return {
		instance_id: 'inst-1',
		target_id: 'target-1',
		target_name: 'api',
		package_name: 'lodash',
		package_version: '4.17.20',
		ecosystem: 'npm',
		advisory_id: 'GHSA-1234',
		severity: 'high',
		decree_score: 6,
		epss_score: 0.4,
		cvss_score: 7.8,
		is_active: true,
		...overrides,
	};
}

/** The advisory GHSA-1234 as the loader would deliver it: two instances, two targets. */
function seedLoadedProject(filters: AdvisoryFilterState = { activeOnly: true }) {
	liveAdvisories.seed(
		[makeGroup()],
		[
			makeFinding(),
			makeFinding({
				instance_id: 'inst-2',
				target_id: 'target-2',
				target_name: 'web',
				decree_score: 4,
			}),
		],
		filters,
	);
}

/** A payload that lines up with the seeded fixture, unlike findingChangedPayload(). */
function advisoryPayload(overrides: Record<string, unknown> = {}) {
	return findingChangedPayload({
		target_name: 'api',
		severity: 'high',
		decree_score: 6,
		epss_score: 0.4,
		...overrides,
	});
}

function groupOf(advisoryId = 'GHSA-1234'): AdvisoryGroup | undefined {
	return liveAdvisories.groups.find((g) => g.advisory_id === advisoryId);
}

describe('sseManager', () => {
	beforeEach(() => {
		MockEventSource.reset();
		vi.stubGlobal('EventSource', MockEventSource);
		appState.reset();
		appState.targets = [target];
		liveAdvisories.reset();
		api.getFindings.mockReset();
	});

	afterEach(() => {
		sseManager.disconnect();
		vi.restoreAllMocks();
	});

	it('does not report connected until the stream actually opens', () => {
		sseManager.connect('proj-1');
		expect(sseManager.connected).toBe(false);

		MockEventSource.latest()?.open();
		expect(sseManager.connected).toBe(true);
	});

	it('reports disconnected after an error and reconnects on the next open', () => {
		sseManager.connect('proj-1');
		MockEventSource.latest()?.open();
		MockEventSource.latest()?.fail();
		expect(sseManager.connected).toBe(false);

		MockEventSource.latest()?.open();
		expect(sseManager.connected).toBe(true);
	});

	it('applies a named finding_changed event to the graph', () => {
		sseManager.connect('proj-1');
		MockEventSource.latest()?.emit('finding_changed', findingChangedPayload());

		expect(appState.graphModel.nodes.has('inst-1')).toBe(true);
		expect(appState.graphModel.nodes.get('inst-1')?.decreeScore).toBe(9.4);
	});

	it('keeps the CVSS score the list endpoint supplied when the event omits it', () => {
		appState.graphModel = computeLayout(
			[
				{
					instance_id: 'inst-1',
					target_id: 'target-1',
					target_name: 'my-app',
					package_name: 'lodash',
					package_version: '4.17.20',
					ecosystem: 'npm',
					advisory_id: 'GHSA-1234',
					is_active: true,
					cvss_score: 8.2,
					decree_score: 4.0,
				},
			],
			[target],
		);

		sseManager.connect('proj-1');
		MockEventSource.latest()?.emit('finding_changed', findingChangedPayload());

		expect(appState.graphModel.nodes.get('inst-1')?.cvssScore).toBe(8.2);
		expect(appState.graphModel.nodes.get('inst-1')?.decreeScore).toBe(9.4);
	});

	it('survives a malformed payload without tearing down the stream', () => {
		sseManager.connect('proj-1');
		const source = MockEventSource.latest();

		expect(() => source?.emit('finding_changed', 'not json')).not.toThrow();

		source?.emit('finding_changed', findingChangedPayload());
		expect(appState.graphModel.nodes.has('inst-1')).toBe(true);
	});

	it('tracks the last event id so a reconnect can resume', () => {
		sseManager.connect('proj-1');
		MockEventSource.latest()?.emit('finding_changed', findingChangedPayload(), 'evt-77');
		expect(sseManager.lastEventId).toBe('evt-77');
	});

	it('discards a payload that parses but is missing the fields the graph needs', () => {
		sseManager.connect('proj-1');
		const source = MockEventSource.latest();

		source?.emit('finding_changed', '{"type":"finding.new_cve","is_active":true}');

		expect(appState.graphModel.nodes.size).toBe(0);
		expect(liveAdvisories.stale).toBe(false);
	});
});

describe('sseManager advisory updates', () => {
	beforeEach(() => {
		MockEventSource.reset();
		vi.stubGlobal('EventSource', MockEventSource);
		appState.reset();
		appState.targets = [target];
		liveAdvisories.reset();
		api.getFindings.mockReset();
		seedLoadedProject();
		sseManager.connect('proj-1');
	});

	afterEach(() => {
		sseManager.disconnect();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('exposes the groups the loader handed it', () => {
		expect(liveAdvisories.groups.map((g) => g.advisory_id)).toEqual(['GHSA-1234']);
		expect(liveAdvisories.stale).toBe(false);
	});

	it('raises the group score when an instance climbs past the maximum', () => {
		MockEventSource.latest()?.emit('finding_changed', advisoryPayload({ decree_score: 9.2 }));

		expect(groupOf()?.max_decree_score).toBe(9.2);
		expect(liveAdvisories.estimated.size).toBe(0);
		expect(liveAdvisories.stale).toBe(true);
	});

	it('lowers the group score to the next worst instance when the leader drops', () => {
		MockEventSource.latest()?.emit('finding_changed', advisoryPayload({ decree_score: 1.2 }));

		expect(groupOf()?.max_decree_score).toBe(4);
	});

	it('keeps the CVSS the list endpoint supplied, which the stream never carries', () => {
		MockEventSource.latest()?.emit('finding_changed', advisoryPayload({ decree_score: 9.2 }));

		expect(groupOf()?.cvss_score).toBe(7.8);
	});

	it('drops a resolved instance out of the group and shrinks its counts', () => {
		MockEventSource.latest()?.emit('finding_changed', advisoryPayload({ is_active: false }));

		const group = groupOf();
		expect(group?.instance_count).toBe(1);
		expect(group?.target_count).toBe(1);
		expect(group?.target_names).toEqual(['web']);
	});

	it('removes the advisory once its last active instance is resolved', () => {
		const source = MockEventSource.latest();
		source?.emit('finding_changed', advisoryPayload({ is_active: false }));
		source?.emit(
			'finding_changed',
			advisoryPayload({
				instance_id: 'inst-2',
				target_id: 'target-2',
				target_name: 'web',
				is_active: false,
			}),
		);

		expect(liveAdvisories.groups).toHaveLength(0);
	});

	it('fetches just the instances of an advisory it has never seen', async () => {
		vi.useFakeTimers();
		const reloads = sseManager.reloadRequestId;
		api.getFindings.mockResolvedValue({
			data: [
				makeFinding({
					instance_id: 'inst-9',
					advisory_id: 'CVE-2030-0001',
					package_name: 'openssl',
					decree_score: 8.1,
				}),
			],
			has_more: false,
		});

		MockEventSource.latest()?.emit(
			'finding_changed',
			advisoryPayload({ advisory_id: 'CVE-2030-0001', instance_id: 'inst-9' }),
		);
		await vi.advanceTimersByTimeAsync(2000);

		expect(api.getFindings).toHaveBeenCalledTimes(1);
		expect(api.getFindings.mock.calls[0]?.[1]).toMatchObject({
			advisory: 'CVE-2030-0001',
			active_only: true,
		});
		const group = groupOf('CVE-2030-0001');
		expect(group?.instance_count).toBe(1);
		expect(group?.package_names).toEqual(['openssl']);
		expect(sseManager.reloadRequestId).toBe(reloads);
	});

	it('refetches under the same filter the listing was fetched with', async () => {
		vi.useFakeTimers();
		api.getFindings.mockResolvedValue({ data: [], has_more: false });
		seedLoadedProject({
			activeOnly: true,
			severity: 'high',
			ecosystem: 'npm',
			minEpss: 0.2,
			minScore: 6,
			q: 'lodash',
		});

		MockEventSource.latest()?.emit(
			'finding_changed',
			advisoryPayload({ advisory_id: 'CVE-2030-0001', instance_id: 'inst-9' }),
		);
		await vi.advanceTimersByTimeAsync(2000);

		expect(api.getFindings.mock.calls[0]?.[1]).toMatchObject({
			advisory: 'CVE-2030-0001',
			severity: 'high',
			ecosystem: 'npm',
			min_epss: 0.2,
			min_score: 6,
			active_only: true,
			q: 'lodash',
		});
	});

	it('coalesces a burst into one request per advisory', async () => {
		vi.useFakeTimers();
		api.getFindings.mockResolvedValue({ data: [], has_more: false });
		const source = MockEventSource.latest();

		source?.emit('finding_changed', advisoryPayload({ advisory_id: 'CVE-A', instance_id: 'i1' }));
		source?.emit('finding_changed', advisoryPayload({ advisory_id: 'CVE-A', instance_id: 'i2' }));
		source?.emit('finding_changed', advisoryPayload({ advisory_id: 'CVE-B', instance_id: 'i3' }));
		await vi.advanceTimersByTimeAsync(2000);

		expect(api.getFindings).toHaveBeenCalledTimes(2);
	});

	it('falls back to a full reload rather than a burst of targeted requests', async () => {
		vi.useFakeTimers();
		const reloads = sseManager.reloadRequestId;
		api.getFindings.mockResolvedValue({ data: [], has_more: false });
		const source = MockEventSource.latest();

		for (let i = 0; i < 12; i++) {
			source?.emit(
				'finding_changed',
				advisoryPayload({ advisory_id: `CVE-${i}`, instance_id: `i${i}` }),
			);
		}
		await vi.advanceTimersByTimeAsync(2000);

		expect(api.getFindings).not.toHaveBeenCalled();
		expect(sseManager.reloadRequestId).toBe(reloads + 1);
	});

	it('asks for a reload when the targeted fetch fails', async () => {
		vi.useFakeTimers();
		const reloads = sseManager.reloadRequestId;
		api.getFindings.mockRejectedValue(new Error('offline'));

		MockEventSource.latest()?.emit(
			'finding_changed',
			advisoryPayload({ advisory_id: 'CVE-2030-0001', instance_id: 'inst-9' }),
		);
		await vi.advanceTimersByTimeAsync(2000);

		expect(sseManager.reloadRequestId).toBe(reloads + 1);
	});

	it('flags a group it could not recompute instead of publishing a wrong count', async () => {
		vi.useFakeTimers();
		api.getFindings.mockResolvedValue({ data: [], has_more: false });
		// The loader truncated: the group counts 40 instances but only one was loaded.
		liveAdvisories.seed([makeGroup({ instance_count: 40 })], [makeFinding()], { activeOnly: true });

		MockEventSource.latest()?.emit('finding_changed', advisoryPayload({ decree_score: 1.2 }));

		expect(liveAdvisories.estimated.has('GHSA-1234')).toBe(true);
		expect(groupOf()?.instance_count).toBe(40);
		expect(groupOf()?.max_decree_score).toBe(6);
	});

	it('discards a targeted fetch that lands after the query changed', async () => {
		vi.useFakeTimers();
		let deliver: (page: unknown) => void = () => {};
		api.getFindings.mockImplementation(
			() =>
				new Promise((resolve) => {
					deliver = resolve;
				}),
		);

		MockEventSource.latest()?.emit(
			'finding_changed',
			advisoryPayload({ advisory_id: 'CVE-2030-0001', instance_id: 'inst-9' }),
		);
		await vi.advanceTimersByTimeAsync(2000);

		// The user changed a filter while the request was still open.
		seedLoadedProject();
		deliver({
			data: [makeFinding({ instance_id: 'inst-9', advisory_id: 'CVE-2030-0001' })],
			has_more: false,
		});
		await vi.advanceTimersByTimeAsync(0);

		expect(groupOf('CVE-2030-0001')).toBeUndefined();
	});

	it('clears the approximation flags when a fresh load arrives', () => {
		liveAdvisories.seed([makeGroup({ instance_count: 40 })], [makeFinding()], { activeOnly: true });
		MockEventSource.latest()?.emit('finding_changed', advisoryPayload({ decree_score: 1.2 }));
		expect(liveAdvisories.estimated.size).toBe(1);

		seedLoadedProject();

		expect(liveAdvisories.estimated.size).toBe(0);
		expect(liveAdvisories.stale).toBe(false);
	});

	it('ignores an event the current filters exclude', () => {
		seedLoadedProject({ activeOnly: true, ecosystem: 'Maven' });
		MockEventSource.latest()?.emit(
			'finding_changed',
			advisoryPayload({ advisory_id: 'CVE-2030-0001', instance_id: 'inst-9' }),
		);

		expect(liveAdvisories.stale).toBe(false);
		expect(groupOf('CVE-2030-0001')).toBeUndefined();
	});

	it('survives a malformed payload without touching the advisory list', () => {
		const source = MockEventSource.latest();

		expect(() => source?.emit('finding_changed', '{oops')).not.toThrow();

		expect(groupOf()?.max_decree_score).toBe(6);
		expect(liveAdvisories.stale).toBe(false);
	});
});
