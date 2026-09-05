import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeLayout } from '$lib/graph/layout';
import type { Target } from '$lib/types/api';
import { appState } from './app.svelte';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_GATEWAY_URL: 'http://localhost:8400' },
}));

import { sseManager } from './sse-manager.svelte';

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

describe('sseManager', () => {
	beforeEach(() => {
		MockEventSource.reset();
		vi.stubGlobal('EventSource', MockEventSource);
		appState.reset();
		appState.targets = [target];
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
});
