import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SSEEvent } from './sse';
import { createSSEConnection } from './sse';

class MockEventSource {
	url: string;
	onmessage: ((e: MessageEvent) => void) | null = null;
	onerror: ((e: Event) => void) | null = null;
	closed = false;

	constructor(url: string) {
		this.url = url;
		MockEventSource.instances.push(this);
	}

	close() {
		this.closed = true;
	}

	// biome-ignore lint/suspicious/noExplicitAny: test helper
	simulateMessage(data: string, id?: string, type?: string): any {
		const event = new MessageEvent(type ?? 'message', {
			data,
			lastEventId: id ?? '',
		});
		this.onmessage?.(event);
	}

	simulateError() {
		const event = new Event('error');
		this.onerror?.(event);
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

	it('parses incoming message events', () => {
		const received: SSEEvent[] = [];
		createSSEConnection({
			url: 'http://localhost/events',
			onEvent: (e) => received.push(e),
		});
		const source = MockEventSource.instances[0];
		expect(source).toBeDefined();
		source?.simulateMessage('{"foo":1}', 'id-1');
		expect(received).toEqual([{ id: 'id-1', type: 'message', data: '{"foo":1}' }]);
	});

	it('tracks lastEventId across events', () => {
		const received: SSEEvent[] = [];
		createSSEConnection({
			url: 'http://localhost/events',
			onEvent: (e) => received.push(e),
		});
		const source = MockEventSource.instances[0];
		expect(source).toBeDefined();
		source?.simulateMessage('a', 'id-1');
		source?.simulateMessage('b', 'id-2');
		expect(received[1]?.id).toBe('id-2');
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
