import { env } from '$env/dynamic/public';
import { createSSEConnection, type SSEConnection } from '$lib/api/sse';
import { applyFindingUpdate } from '$lib/graph/updater';
import type { FindingChangedEvent } from '$lib/types/api';
import { appState } from './app.svelte';

const GATEWAY_URL = env.PUBLIC_GATEWAY_URL ?? 'http://localhost:8400';

function createSSEManager() {
	let connection = $state<SSEConnection | null>(null);
	let lastEventId = $state<string | null>(null);
	let connected = $state(false);

	function connect(projectId: string) {
		disconnect();
		const url = `${GATEWAY_URL}/api/events?project_id=${encodeURIComponent(projectId)}`;
		connection = createSSEConnection({
			url,
			lastEventId: lastEventId ?? undefined,
			onEvent(event) {
				lastEventId = event.id;
				if (event.type !== 'finding_changed') return;

				const finding = parseFindingChanged(event.data);
				if (!finding) return;

				appState.graphModel = applyFindingUpdate(appState.graphModel, finding, appState.targets);
			},
			onOpen() {
				connected = true;
			},
			onError() {
				connected = false;
			},
		});
	}

	function disconnect() {
		if (connection) {
			connection.close();
			connection = null;
			connected = false;
		}
	}

	return {
		get connected() {
			return connected;
		},
		get lastEventId() {
			return lastEventId;
		},
		connect,
		disconnect,
	};
}

/** The stream is an external boundary: one bad frame must not kill the connection. */
function parseFindingChanged(data: string): FindingChangedEvent | null {
	try {
		return JSON.parse(data) as FindingChangedEvent;
	} catch {
		console.warn('discarded malformed finding_changed payload');
		return null;
	}
}

export const sseManager = createSSEManager();
