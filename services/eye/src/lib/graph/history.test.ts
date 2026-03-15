import { describe, expect, it } from 'vitest';
import type { Target, TimelineEvent } from '$lib/types/api';
import { reconstructAtTime } from './history';

function makeEvent(
	instanceId: string,
	type: 'observed' | 'disappeared',
	time: string,
	score?: number,
): TimelineEvent {
	return {
		id: `evt-${instanceId}-${time}`,
		instance_id: instanceId,
		scan_id: 'scan-1',
		event_type: type,
		occurred_at: time,
		advisory_id: `CVE-${instanceId}`,
		severity: 'HIGH',
		decree_score: score ?? 5.0,
	};
}

const targets: Target[] = [
	{
		id: 't1',
		project_id: 'p1',
		name: 'target-1',
		target_type: 'image',
		created_at: '2024-01-01T00:00:00Z',
	},
];

describe('reconstructAtTime', () => {
	it('returns empty graph for no events', () => {
		const graph = reconstructAtTime([], '2024-01-15T00:00:00Z', targets);
		expect(graph.nodes.size).toBe(0);
	});

	it('includes observed findings up to timestamp', () => {
		const events = [
			makeEvent('v1', 'observed', '2024-01-01T00:00:00Z'),
			makeEvent('v2', 'observed', '2024-01-02T00:00:00Z'),
			makeEvent('v3', 'observed', '2024-01-10T00:00:00Z'),
		];
		const graph = reconstructAtTime(events, '2024-01-05T00:00:00Z', targets);
		expect(graph.nodes.size).toBe(2);
		expect(graph.nodes.has('v1')).toBe(true);
		expect(graph.nodes.has('v2')).toBe(true);
		expect(graph.nodes.has('v3')).toBe(false);
	});

	it('removes disappeared findings', () => {
		const events = [
			makeEvent('v1', 'observed', '2024-01-01T00:00:00Z'),
			makeEvent('v1', 'disappeared', '2024-01-03T00:00:00Z'),
		];
		const graph = reconstructAtTime(events, '2024-01-05T00:00:00Z', targets);
		expect(graph.nodes.size).toBe(0);
	});

	it('handles observe-disappear-reobserve', () => {
		const events = [
			makeEvent('v1', 'observed', '2024-01-01T00:00:00Z', 5.0),
			makeEvent('v1', 'disappeared', '2024-01-03T00:00:00Z'),
			makeEvent('v1', 'observed', '2024-01-05T00:00:00Z', 7.0),
		];
		const graph = reconstructAtTime(events, '2024-01-06T00:00:00Z', targets);
		expect(graph.nodes.size).toBe(1);
		expect(graph.nodes.get('v1')?.decreeScore).toBe(7.0);
	});

	it('preserves severity and score from events', () => {
		const events = [makeEvent('v1', 'observed', '2024-01-01T00:00:00Z', 8.5)];
		const graph = reconstructAtTime(events, '2024-01-02T00:00:00Z', targets);
		const node = graph.nodes.get('v1');
		expect(node?.decreeScore).toBe(8.5);
		expect(node?.severity).toBe('HIGH');
	});
});
