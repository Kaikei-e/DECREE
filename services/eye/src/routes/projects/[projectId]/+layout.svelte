<script lang="ts">
import { untrack } from 'svelte';
import { invalidateAll } from '$app/navigation';
import { computeLayout } from '$lib/graph/layout';
import { appState } from '$lib/state/app.svelte';
import { sseManager } from '$lib/state/sse-manager.svelte';

let { children, data } = $props();

// The URL is the source of truth for filters, so every load result — the first one and
// every one after a filter change — is applied the same way, and nothing here refetches.
$effect(() => {
	const { projectId, findings, targets } = data;

	untrack(() => {
		// Nothing here survives a project change, and the live stream is keyed off the id.
		if (appState.selectedProjectId !== projectId) {
			appState.reset();
			appState.selectedProjectId = projectId;
		}
		appState.targets = targets;
		appState.findings = findings;
		// Instance-grained: this is what the live stream patches and what the risk plot's
		// hover card reads. The 3D scene builds its own advisory-grained model.
		appState.graphModel = computeLayout(findings, targets);
		appState.error = null;
	});
});

$effect(() => {
	const id = data.projectId;
	if (!id) return;

	untrack(() => sseManager.connect(id));
	return () => sseManager.disconnect();
});

// The stream patches the instance graph directly, but the advisory-grained scene and the
// table are built from the loader's data, so a burst of events has to pull that again.
// Coalesced, because a single scan emits one event per changed finding.
const RELOAD_DEBOUNCE_MS = 5000;
$effect(() => {
	const eventId = sseManager.lastEventId;
	if (!eventId) return;

	const timer = setTimeout(() => invalidateAll(), RELOAD_DEBOUNCE_MS);
	return () => clearTimeout(timer);
});
</script>

{@render children()}
