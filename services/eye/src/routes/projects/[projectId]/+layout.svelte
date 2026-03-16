<script lang="ts">
import { onDestroy } from 'svelte';
import { page } from '$app/state';
import { api } from '$lib/api/client';
import { computeLayout } from '$lib/graph/layout';
import { appState } from '$lib/state/app.svelte';
import { sseManager } from '$lib/state/sse-manager.svelte';

let { children } = $props();

const projectId = $derived(page.params.projectId);

// Load project metadata (targets, topRisks) + connect SSE on project change
$effect(() => {
	const id = projectId;
	if (id) loadProject(id);
});

// Re-fetch findings when filters change
$effect(() => {
	// Read each filter property to establish Svelte 5 fine-grained tracking
	const _severity = appState.filters.severity;
	const _ecosystem = appState.filters.ecosystem;
	const _minEpss = appState.filters.minEpss;
	const _activeOnly = appState.filters.activeOnly;
	const id = appState.selectedProjectId;
	if (id) loadFindings(id);
});

async function loadProject(id: string) {
	appState.loading = true;
	appState.error = null;

	try {
		appState.selectedProjectId = id;

		const [targets, topRisks] = await Promise.all([
			api.getTargets(id),
			api.getTopRisks(id),
		]);

		appState.targets = targets;
		await loadFindings(id);
		sseManager.connect(id);
	} catch (e) {
		appState.error = e instanceof Error ? e.message : 'Failed to load project';
	} finally {
		appState.loading = false;
	}
}

async function loadFindings(id: string) {
	try {
		const findingsRes = await api.getFindings(id, {
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

onDestroy(() => {
	sseManager.disconnect();
});
</script>

{@render children()}
