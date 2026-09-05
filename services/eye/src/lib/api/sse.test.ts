import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SSEEvent } from './sse';
import { createSSEConnection, SSE_EVENT_TYPES } from './sse';

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

	/** Emit a named SSE event exactly the way the gateway writes it: `event: <type>`. */
	emit(type: string, data: string, id?: string) {
		const event = new MessageEvent(type, { data, lastEventId: id ?? '' });
		for (const handler of this.listeners.get(type) ?? []) {
			handler(event);
		}
	}

	simulateOpen() {
		this.onopen?.(new Event('open'));
	}

	simulateError() {
		this.onerror?.(new Event('error'));
	}

	static instances: MockEventSource[] = [];
	static reset() {
		MockEventSource.instances = [];
	}
}

describe('SSE', () => {
	beforeEach(() => {
		MockEventSource.reset();
		vi.stubGlobal('EventSource', MockEventSource);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('creates EventSource with given URL', () => {
		createSSEConnection({ url: 'http://localhost/events', onEvent: () => {} });
		expect(MockEventSource.instances).toHaveLength(1);
		expect(MockEventSource.instances[0]?.url).toBe('http://localhost/events');
	});

	it('appends lastEventId to URL', () => {
		createSSEConnection({
			url: 'http://localhost/events',
			lastEventId: 'evt-42',
			onEvent: () => {},
		});
		expect(MockEventSource.instances[0]?.url).toBe('http://localhost/events?lastEventId=evt-42');
	});

	it('appends lastEventId with & when URL has query params', () => {
		createSSEConnection({
			url: 'http://localhost/events?project=1',
			lastEventId: 'evt-5',
			onEvent: () => {},
		});
		expect(MockEventSource.instances[0]?.url).toBe(
			'http://localhost/events?project=1&lastEventId=evt-5',
		);
	});

	it('subscribes to every named event type the gateway emits', () => {
		createSSEConnection({ url: 'http://localhost/events', onEvent: () => {} });
		const source = MockEventSource.instances[0];
		for (const type of SSE_EVENT_TYPES) {
			expect(source?.listeners.get(type)).toHaveLength(1);
		}
	});

	it('delivers named finding_changed events with their real type', () => {
		const received: SSEEvent[] = [];
		createSSEConnection({
			url: 'http://localhost/events',
			onEvent: (e) => received.push(e),
		});
		MockEventSource.instances[0]?.emit('finding_changed', '{"foo":1}', 'id-1');
		expect(received).toEqual([{ id: 'id-1', type: 'finding_changed', data: '{"foo":1}' }]);
	});

	it('delivers named notification_sent events', () => {
		const received: SSEEvent[] = [];
		createSSEConnection({
			url: 'http://localhost/events',
			onEvent: (e) => received.push(e),
		});
		MockEventSource.instances[0]?.emit('notification_sent', '{"ok":true}', 'id-9');
		expect(received[0]?.type).toBe('notification_sent');
	});

	it('tracks lastEventId across events', () => {
		const received: SSEEvent[] = [];
		createSSEConnection({
			url: 'http://localhost/events',
			onEvent: (e) => received.push(e),
		});
		const source = MockEventSource.instances[0];
		source?.emit('finding_changed', 'a', 'id-1');
		source?.emit('finding_changed', 'b', 'id-2');
		expect(received[1]?.id).toBe('id-2');
	});

	it('calls onOpen only once the connection actually opens', () => {
		let opened = 0;
		createSSEConnection({
			url: 'http://localhost/events',
			onEvent: () => {},
			onOpen: () => {
				opened++;
			},
		});
		expect(opened).toBe(0);
		MockEventSource.instances[0]?.simulateOpen();
		expect(opened).toBe(1);
	});

	it('calls onError when error occurs', () => {
		const errors: Event[] = [];
		createSSEConnection({
			url: 'http://localhost/events',
			onEvent: () => {},
			onError: (e) => errors.push(e),
		});
		MockEventSource.instances[0]?.simulateError();
		expect(errors).toHaveLength(1);
	});

	it('close() closes the EventSource', () => {
		const conn = createSSEConnection({
			url: 'http://localhost/events',
			onEvent: () => {},
		});
		conn.close();
		expect(MockEventSource.instances[0]?.closed).toBe(true);
	});
});
