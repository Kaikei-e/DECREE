<script lang="ts">
import { api } from '$lib/api/client';
import DetailPanel from '$lib/components/DetailPanel.svelte';
import FilterBar from '$lib/components/FilterBar.svelte';
import NodeTooltip from '$lib/components/NodeTooltip.svelte';
import TimelineSlider from '$lib/components/TimelineSlider.svelte';
import TopRisksSummary from '$lib/components/TopRisksSummary.svelte';
import VisualizationCanvas from '$lib/components/VisualizationCanvas.svelte';
import type { FindingFilters, RendererType } from '$lib/state/app.svelte';
import { appState } from '$lib/state/app.svelte';
import { timelineState } from '$lib/state/timeline.svelte';

let hoveredNode = $state<{ id: string; x: number; y: number } | null>(null);
let topRisks = $state<import('$lib/types/api').Finding[]>([]);

const ecosystems = $derived([...new Set(appState.findings.map((f) => f.ecosystem))].sort());

const graphNode = $derived(
	hoveredNode ? (appState.graphModel.nodes.get(hoveredNode.id) ?? null) : null,
);

// Load top risks
$effect(() => {
	if (appState.selectedProjectId) {
		api.getTopRisks(appState.selectedProjectId).then((r) => {
			topRisks = r;
		});
	}
});

function onNodeClick(nodeId: string) {
	appState.selectedNodeId = nodeId;
	if (appState.selectedProjectId) {
		api.getFindingDetail(nodeId).then((detail) => {
			appState.selectedFindingDetail = detail;
		});
	}
}

function onNodeHover(nodeId: string | null, position?: { x: number; y: number }) {
	if (nodeId && position) {
		hoveredNode = { id: nodeId, x: position.x, y: position.y };
	} else {
		hoveredNode = null;
	}
}

function onFiltersChange(filters: FindingFilters) {
	appState.filters = filters;
}

function onRendererChange(type: RendererType) {
	appState.rendererType = type;
}

// Timeline date range
const minDate = $derived(
	appState.findings.length > 0
		? appState.findings.reduce(
				(min, f) => (f.last_observed_at && f.last_observed_at < min ? f.last_observed_at : min),
				appState.findings[0]?.last_observed_at ?? new Date().toISOString(),
			)
		: new Date(Date.now() - 30 * 86400000).toISOString(),
);
const maxDate = $derived(new Date().toISOString());
</script>

<div class="relative flex h-[calc(100vh-3rem)] flex-col">
	<!-- Filter Bar -->
	<div class="z-10 p-2">
		<FilterBar
			filters={appState.filters}
			rendererType={appState.rendererType}
			{ecosystems}
			{onFiltersChange}
			{onRendererChange}
		/>
	</div>

	{#if appState.loading}
		<div class="flex flex-1 items-center justify-center">
			<p class="font-mono text-hud-text-muted hud-live-pulse">Loading visualization...</p>
		</div>
	{:else if appState.error}
		<div class="flex flex-1 items-center justify-center">
			<p class="font-mono text-hud-danger">{appState.error}</p>
		</div>
	{:else}
		<!-- Main visualization area -->
		<div class="relative flex-1">
			<VisualizationCanvas
				graphModel={appState.graphModel}
				rendererType={appState.rendererType}
				{onNodeClick}
				{onNodeHover}
			/>

			<!-- Top Risks Overlay -->
			<div class="absolute left-3 top-3 w-56">
				<TopRisksSummary risks={topRisks} onSelect={onNodeClick} />
			</div>

			<!-- Node Tooltip -->
			<NodeTooltip node={graphNode} x={hoveredNode?.x ?? 0} y={hoveredNode?.y ?? 0} />
		</div>

		<!-- Timeline Slider -->
		<div class="z-10 p-2">
			<TimelineSlider {minDate} {maxDate} />
		</div>
	{/if}
</div>

<!-- Detail Panel -->
<DetailPanel
	finding={appState.selectedFindingDetail}
	onClose={() => {
		appState.selectedNodeId = null;
		appState.selectedFindingDetail = null;
	}}
/>
