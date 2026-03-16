<script lang="ts">
import { getFindingDetail } from '$lib/api/client';
import DetailPanel from '$lib/components/DetailPanel.svelte';
import FilterBar from '$lib/components/FilterBar.svelte';
import NodeTooltip from '$lib/components/NodeTooltip.svelte';
import SceneGuide from '$lib/components/SceneGuide.svelte';
import TimelineSlider from '$lib/components/TimelineSlider.svelte';
import TopRisksSummary from '$lib/components/TopRisksSummary.svelte';
import VisualizationCanvas from '$lib/components/VisualizationCanvas.svelte';
import { buildVisualizationInsights, getTopVisibleRisks } from '$lib/graph/insights';
import type { FindingFilters, RendererType } from '$lib/state/app.svelte';
import { appState } from '$lib/state/app.svelte';

let hoveredNode = $state<{ id: string; x: number; y: number } | null>(null);

const ecosystems = $derived([...new Set(appState.findings.map((f) => f.ecosystem))].sort());

const graphNode = $derived(
	hoveredNode ? (appState.graphModel.nodes.get(hoveredNode.id) ?? null) : null,
);

const sceneSummary = $derived(buildVisualizationInsights(appState.findings, appState.graphModel));
const topVisibleRisks = $derived(getTopVisibleRisks(appState.findings));

function onNodeClick(nodeId: string) {
	appState.selectedNodeId = nodeId;
	getFindingDetail(nodeId).then((detail) => {
		appState.selectedFindingDetail = detail;
	});
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

<div class="flex h-[calc(100vh-3rem)] flex-col">
	<div class="z-10 px-2 pb-2 pt-2">
		<FilterBar
			filters={appState.filters}
			rendererType={appState.rendererType}
			{ecosystems}
			{onFiltersChange}
			{onRendererChange}
		/>
	</div>

	{#if appState.error}
		<div class="flex flex-1 items-center justify-center">
			<p class="font-mono text-hud-danger">{appState.error}</p>
		</div>
	{:else}
		<div class="min-h-0 flex-1 px-2 pb-2">
			<div class="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
				<div class="flex min-h-0 flex-col gap-3">
					<SceneGuide summary={sceneSummary} rendererType={appState.rendererType} />

					<div class="relative min-h-[30rem] flex-1 overflow-hidden hud-panel hud-scanlines bg-hud-void/96">
						<div class="absolute left-4 top-4 z-10 max-w-xs rounded-sm border border-hud-border bg-hud-base/76 px-3 py-2 backdrop-blur">
							<p class="hud-header">Spatial Inspection</p>
							<p class="mt-1 text-xs leading-5 text-hud-text-secondary">
								Drag to orbit, use the camera tools for fast resets, and read the scene from cluster
								shape before drilling into a node.
							</p>
						</div>

						<div class="absolute bottom-4 left-4 z-10 rounded-sm border border-hud-border bg-hud-base/72 px-3 py-2 backdrop-blur">
							<p class="hud-header">Read Order</p>
							<p class="mt-1 text-[11px] uppercase tracking-[0.14em] text-hud-text-secondary">
								Left to right = target lanes
							</p>
							<p class="mt-1 text-[11px] uppercase tracking-[0.14em] text-hud-text-secondary">
								Low to high = DECREE urgency
							</p>
						</div>

						<div class="absolute inset-y-20 left-4 z-10 hidden w-10 items-center justify-center md:flex">
							<div class="flex h-full flex-col items-center justify-between rounded-full border border-hud-border bg-hud-base/58 px-2 py-3 backdrop-blur">
								<span class="font-mono text-[10px] uppercase tracking-[0.16em] text-hud-text-secondary [writing-mode:vertical-rl] [text-orientation:mixed]">
									High DECREE
								</span>
								<span class="h-full w-px bg-linear-to-b from-hud-accent via-hud-border-bright to-hud-border"></span>
								<span class="font-mono text-[10px] uppercase tracking-[0.16em] text-hud-text-muted [writing-mode:vertical-rl] [text-orientation:mixed]">
									Low
								</span>
							</div>
						</div>

						<div class="absolute bottom-4 right-4 z-10 flex flex-wrap justify-end gap-2 text-[11px] uppercase tracking-[0.14em] text-hud-text-secondary">
							<span class="rounded-sm border border-hud-border bg-hud-base/72 px-2 py-1 backdrop-blur">Orb = instance</span>
							<span class="rounded-sm border border-hud-border bg-hud-base/72 px-2 py-1 backdrop-blur">Color = severity</span>
							<span class="rounded-sm border border-hud-border bg-hud-base/72 px-2 py-1 backdrop-blur">Glow = EPSS</span>
						</div>

						<VisualizationCanvas
							graphModel={appState.graphModel}
							rendererType={appState.rendererType}
							{onNodeClick}
							{onNodeHover}
						/>

						<NodeTooltip node={graphNode} x={hoveredNode?.x ?? 0} y={hoveredNode?.y ?? 0} />
					</div>
				</div>

				<div class="min-h-0">
					<TopRisksSummary risks={topVisibleRisks} onSelect={onNodeClick} />
				</div>
			</div>
		</div>

		<div class="z-10 px-2 pb-2">
			<TimelineSlider {minDate} {maxDate} />
		</div>
	{/if}
</div>

<DetailPanel
	finding={appState.selectedFindingDetail}
	onClose={() => {
		appState.selectedNodeId = null;
		appState.selectedFindingDetail = null;
	}}
/>
