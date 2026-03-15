export interface SSEEvent {
	id: string;
	type: string;
	data: string;
}

export interface SSEOptions {
	url: string;
	lastEventId?: string;
	onEvent: (event: SSEEvent) => void;
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

	source.onmessage = (e: MessageEvent) => {
		if (e.lastEventId) {
			lastEventId = e.lastEventId;
		}
		options.onEvent({
			id: e.lastEventId ?? '',
			type: e.type,
			data: e.data,
		});
	};

	source.onerror = (e: Event) => {
		options.onError?.(e);
	};

	return {
		close: () => source.close(),
	};
}
