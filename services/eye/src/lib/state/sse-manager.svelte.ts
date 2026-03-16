import { env } from '$env/dynamic/public';
import { createSSEConnection, type SSEConnection } from '$lib/api/sse';
import { applyFindingUpdate } from '$lib/graph/updater';
import type { Finding } from '$lib/types/api';
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
				if (event.type === 'finding_changed') {
					const finding: Finding = JSON.parse(event.data);
					appState.graphModel = applyFindingUpdate(appState.graphModel, finding, appState.targets);
				}
			},
			onError() {
				connected = false;
			},
		});
		connected = true;
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

export const sseManager = createSSEManager();
