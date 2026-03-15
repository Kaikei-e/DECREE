import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineEvent } from '$lib/types/api';
import { timelineState } from './timeline.svelte';

function makeEvent(id: string, time: string): TimelineEvent {
	return {
		id,
		instance_id: `inst-${id}`,
		scan_id: `scan-${id}`,
		event_type: 'observed',
		occurred_at: time,
	};
}

describe('timelineState', () => {
	beforeEach(() => {
		timelineState.reset();
	});

	it('starts in live mode', () => {
		expect(timelineState.mode).toBe('live');
		expect(timelineState.currentTime).toBeNull();
	});

	it('transitions to replaying', () => {
		timelineState.startReplay('2024-01-15T00:00:00Z');
		expect(timelineState.mode).toBe('replaying');
		expect(timelineState.currentTime).toBe('2024-01-15T00:00:00Z');
	});

	it('pauses and resumes', () => {
		timelineState.startReplay('2024-01-15T00:00:00Z');
		timelineState.pause();
		expect(timelineState.mode).toBe('paused');
		timelineState.resume();
		expect(timelineState.mode).toBe('replaying');
	});

	it('buffers SSE events during replay', () => {
		timelineState.startReplay('2024-01-15T00:00:00Z');
		const ev = makeEvent('1', '2024-01-16T00:00:00Z');
		timelineState.bufferSSEEvent(ev);
		expect(timelineState.bufferedSSEEvents).toHaveLength(1);
		expect(timelineState.events).toHaveLength(0);
	});

	it('applies buffered events on goLive', () => {
		timelineState.startReplay('2024-01-15T00:00:00Z');
		timelineState.bufferSSEEvent(makeEvent('1', '2024-01-16T00:00:00Z'));
		timelineState.goLive();
		expect(timelineState.mode).toBe('live');
		expect(timelineState.events).toHaveLength(1);
		expect(timelineState.bufferedSSEEvents).toHaveLength(0);
	});

	it('adds SSE events directly in live mode', () => {
		const ev = makeEvent('1', '2024-01-15T00:00:00Z');
		timelineState.bufferSSEEvent(ev);
		expect(timelineState.events).toHaveLength(1);
	});

	it('steps forward through events', () => {
		timelineState.events = [
			makeEvent('1', '2024-01-01T00:00:00Z'),
			makeEvent('2', '2024-01-02T00:00:00Z'),
			makeEvent('3', '2024-01-03T00:00:00Z'),
		];
		timelineState.startReplay('2024-01-01T00:00:00Z');
		timelineState.stepForward();
		expect(timelineState.currentTime).toBe('2024-01-02T00:00:00Z');
	});

	it('steps backward through events', () => {
		timelineState.events = [
			makeEvent('1', '2024-01-01T00:00:00Z'),
			makeEvent('2', '2024-01-02T00:00:00Z'),
			makeEvent('3', '2024-01-03T00:00:00Z'),
		];
		timelineState.startReplay('2024-01-03T00:00:00Z');
		timelineState.stepBackward();
		expect(timelineState.currentTime).toBe('2024-01-02T00:00:00Z');
	});
});
