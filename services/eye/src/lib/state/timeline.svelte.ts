import type { TimelineEvent } from '$lib/types/api';

export type TimelineMode = 'live' | 'replaying' | 'paused';

function createTimelineState() {
	let mode = $state<TimelineMode>('live');
	let currentTime = $state<string | null>(null);
	let events = $state<TimelineEvent[]>([]);
	let bufferedSSEEvents = $state<TimelineEvent[]>([]);
	let playbackSpeed = $state(1);

	return {
		get mode() {
			return mode;
		},
		get currentTime() {
			return currentTime;
		},
		set currentTime(v: string | null) {
			currentTime = v;
		},
		get events() {
			return events;
		},
		set events(v: TimelineEvent[]) {
			events = v;
		},
		get bufferedSSEEvents() {
			return bufferedSSEEvents;
		},
		get playbackSpeed() {
			return playbackSpeed;
		},
		set playbackSpeed(v: number) {
			playbackSpeed = v;
		},

		goLive() {
			mode = 'live';
			currentTime = null;
			// Apply buffered SSE events
			if (bufferedSSEEvents.length > 0) {
				events = [...events, ...bufferedSSEEvents];
				bufferedSSEEvents = [];
			}
		},

		startReplay(time: string) {
			mode = 'replaying';
			currentTime = time;
		},

		pause() {
			if (mode === 'replaying') {
				mode = 'paused';
			}
		},

		resume() {
			if (mode === 'paused') {
				mode = 'replaying';
			}
		},

		bufferSSEEvent(event: TimelineEvent) {
			if (mode !== 'live') {
				bufferedSSEEvents = [...bufferedSSEEvents, event];
			} else {
				events = [...events, event];
			}
		},

		stepForward() {
			const cur = currentTime;
			if (!cur || events.length === 0) return;
			const idx = events.findIndex((e) => e.occurred_at > cur);
			if (idx >= 0) {
				const evt = events[idx];
				if (evt) currentTime = evt.occurred_at;
			}
		},

		stepBackward() {
			const cur = currentTime;
			if (!cur || events.length === 0) return;
			const before = events.filter((e) => e.occurred_at < cur);
			if (before.length > 0) {
				const last = before[before.length - 1];
				if (last) currentTime = last.occurred_at;
			}
		},

		reset() {
			mode = 'live';
			currentTime = null;
			events = [];
			bufferedSSEEvents = [];
			playbackSpeed = 1;
		},
	};
}

export const timelineState = createTimelineState();
