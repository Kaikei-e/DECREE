<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { page } from '$app/state';
import { api } from '$lib/api/client';
import { computeLayout } from '$lib/graph/layout';
import { appState } from '$lib/state/app.svelte';
import { sseManager } from '$lib/state/sse-manager.svelte';

let { children } = $props();

const projectId = $derived(page.params.projectId);

onMount(() => loadProject());

$effect(() => {
	const id = projectId;
	if (id) loadProject();
});

async function loadProject() {
	if (!projectId) return;
	appState.loading = true;
	appState.error = null;

	try {
		appState.selectedProjectId = projectId;

		const [targets, findingsRes, topRisks] = await Promise.all([
			api.getTargets(projectId),
			api.getFindings(projectId, { active_only: appState.filters.activeOnly }),
			api.getTopRisks(projectId),
		]);

		appState.targets = targets;
		appState.findings = findingsRes.data;
		appState.graphModel = computeLayout(findingsRes.data, targets);

		sseManager.connect(projectId);
	} catch (e) {
		appState.error = e instanceof Error ? e.message : 'Failed to load project';
	} finally {
		appState.loading = false;
	}
}

onDestroy(() => {
	sseManager.disconnect();
});
</script>

{@render children()}
