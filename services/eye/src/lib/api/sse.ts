/** Event names the gateway writes into the `event:` field (see internal/sse/consumer.go). */
export const SSE_EVENT_TYPES = ['finding_changed', 'notification_sent'] as const;

export type SSEEventType = (typeof SSE_EVENT_TYPES)[number];

export interface SSEEvent {
	id: string;
	type: SSEEventType;
	data: string;
}

export interface SSEOptions {
	url: string;
	lastEventId?: string;
	onEvent: (event: SSEEvent) => void;
	onOpen?: () => void;
	onError?: (error: Event) => void;
}

export interface SSEConnection {
	close: () => void;
}

export function createSSEConnection(options: SSEOptions): SSEConnection {
	let lastEventId = options.lastEventId;

	let url = options.url;
	if (lastEventId) {
		const separator = url.includes('?') ? '&' : '?';
		url = `${url}${separator}lastEventId=${encodeURIComponent(lastEventId)}`;
	}

	const source = new EventSource(url);

	// The gateway always names its events, and EventSource.onmessage only fires for
	// unnamed ones — so every event has to be subscribed to explicitly.
	for (const type of SSE_EVENT_TYPES) {
		source.addEventListener(type, (e: MessageEvent) => {
			if (e.lastEventId) {
				lastEventId = e.lastEventId;
			}
			options.onEvent({ id: e.lastEventId ?? '', type, data: e.data });
		});
	}

	source.onopen = () => {
		options.onOpen?.();
	};

	source.onerror = (e: Event) => {
		options.onError?.(e);
	};

	return {
		close: () => source.close(),
	};
}
