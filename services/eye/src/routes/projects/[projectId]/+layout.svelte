<script lang="ts">
import { untrack } from 'svelte';
import { page } from '$app/state';
import { getFindings } from '$lib/api/client';
import { computeLayout } from '$lib/graph/layout';
import { appState } from '$lib/state/app.svelte';
import { sseManager } from '$lib/state/sse-manager.svelte';

let { children, data } = $props();

const projectId = $derived(page.params.projectId);

// Initialize state from load data and connect SSE
$effect(() => {
	const id = projectId;
	if (!id) return;

	untrack(() => {
		appState.selectedProjectId = id;
		appState.targets = data.targets;
		appState.findings = data.findings;
		appState.graphModel = computeLayout(data.findings, data.targets);
		sseManager.connect(id);
	});

	return () => {
		sseManager.disconnect();
	};
});

// Re-fetch findings when filters change
$effect(() => {
	const _severity = appState.filters.severity;
	const _ecosystem = appState.filters.ecosystem;
	const _minEpss = appState.filters.minEpss;
	const _activeOnly = appState.filters.activeOnly;
	const id = appState.selectedProjectId;
	if (id) untrack(() => loadFindings(id));
});

async function loadFindings(id: string) {
	try {
		const findingsRes = await getFindings(id, {
			severity: appState.filters.severity,
			ecosystem: appState.filters.ecosystem,
			min_epss: appState.filters.minEpss,
			active_only: appState.filters.activeOnly,
		});
		appState.findings = findingsRes.data;
		appState.graphModel = computeLayout(findingsRes.data, appState.targets);
	} catch (e) {
		appState.error = e instanceof Error ? e.message : 'Failed to load findings';
	}
}
</script>

{@render children()}
