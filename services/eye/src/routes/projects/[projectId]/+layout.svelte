<script lang="ts">
import { untrack } from 'svelte';
import { invalidateAll } from '$app/navigation';
import { computeLayout } from '$lib/graph/layout';
import { appState } from '$lib/state/app.svelte';
import { liveAdvisories, sseManager } from '$lib/state/sse-manager.svelte';

let { children, data } = $props();

// The URL is the source of truth for filters, so every load result — the first one and
// every one after a filter change — is applied the same way, and nothing here refetches.
$effect(() => {
	const { projectId, findings, targets, advisories, query } = data;

	untrack(() => {
		// Nothing here survives a project change, and the live stream is keyed off the id.
		if (appState.selectedProjectId !== projectId) {
			appState.reset();
			appState.selectedProjectId = projectId;
		}
		appState.targets = targets;
		appState.findings = findings;
		// Instance-grained: this is what the live stream patches and what the risk plot's
		// hover card reads. The advisory-grained listing is seeded separately below.
		appState.graphModel = computeLayout(findings, targets);
		appState.error = null;

		// The scene and the table read this rather than the loader's array, so a stream
		// event reaches them without the loader running again. The findings go in too:
		// they are the instance set the server's aggregates were computed over, which is
		// what lets a single event be applied without asking for the counts back.
		liveAdvisories.seed(advisories, findings, {
			severity: query.severity,
			ecosystem: query.ecosystem,
			minEpss: query.minEpss,
			minScore: query.minScore,
			activeOnly: query.activeOnly,
			q: query.q,
		});
	});
});

$effect(() => {
	const id = data.projectId;
	if (!id) return;

	untrack(() => sseManager.connect(id));
	return () => sseManager.disconnect();
});

// A reload is now the exception rather than the response to every event: the stream saw
// something the client cannot recompute and the targeted refetch could not settle it.
// The counter belongs to a module singleton, so it does not restart with the component.
const RELOAD_DEBOUNCE_MS = 1500;
let handledReloadId = sseManager.reloadRequestId;

$effect(() => {
	const requestId = sseManager.reloadRequestId;
	if (requestId === handledReloadId) return;
	handledReloadId = requestId;

	const timer = setTimeout(() => invalidateAll(), RELOAD_DEBOUNCE_MS);
	return () => clearTimeout(timer);
});

// Safety net. The in-memory model reproduces the gateway's aggregation, but it cannot see
// events the stream dropped, and a patched list is no longer in the order the server would
// have sorted it — so a view that has taken live edits is re-read at a low frequency.
const RECONCILE_INTERVAL_MS = 5 * 60_000;
$effect(() => {
	const timer = setInterval(() => {
		if (liveAdvisories.stale) invalidateAll();
	}, RECONCILE_INTERVAL_MS);
	return () => clearInterval(timer);
});
</script>

{@render children()}
