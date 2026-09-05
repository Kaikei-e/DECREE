<script lang="ts">
import { untrack } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import type { FindingSort } from '$lib/api/client';
import { getFindingDetail, getFindings } from '$lib/api/client';
import BeeswarmView from '$lib/components/BeeswarmView.svelte';
import DetailPanel from '$lib/components/DetailPanel.svelte';
import FilterBar from '$lib/components/FilterBar.svelte';
import FindingsTable from '$lib/components/FindingsTable.svelte';
import NodeTooltip from '$lib/components/NodeTooltip.svelte';
import SceneGuide from '$lib/components/SceneGuide.svelte';
import TimelineSlider from '$lib/components/TimelineSlider.svelte';
import TopRisksSummary, { type QueueItem } from '$lib/components/TopRisksSummary.svelte';
import VisualizationCanvas from '$lib/components/VisualizationCanvas.svelte';
import { computeAdvisoryLayout } from '$lib/graph/advisory-layout';
import {
	buildAdvisoryInsights,
	buildInstanceInsights,
	getTopAdvisories,
	getTopVisibleRisks,
} from '$lib/graph/insights';
import { detectCapability } from '$lib/renderer/capability';
import { appState } from '$lib/state/app.svelte';
import {
	DEFAULT_FINDINGS_QUERY,
	type FindingsQuery,
	parseViewQuery,
	toSearchParams,
	type ViewQuery,
} from '$lib/state/query-params';
import type { Finding, FindingDetail } from '$lib/types/api';

let { data } = $props();

/** Below this the panel would leave the scene unusable, so it becomes an overlay instead. */
const OVERLAY_BELOW = '(max-width: 1279.98px)';
const TABLE_PAGE_SIZE = 50;

const view = $derived(parseViewQuery(page.url.searchParams));
// Primitives, so a change to an unrelated param does not restart the detail fetches.
const viewMode = $derived(view.view);
const advisoryId = $derived(view.advisory ?? null);
const findingId = $derived(view.finding ?? null);

const hasActiveFilters = $derived(
	data.query.severity != null ||
		data.query.ecosystem != null ||
		(data.query.minEpss ?? 0) > 0 ||
		data.query.q != null ||
		data.query.activeOnly === false,
);

const advisoryGraph = $derived(computeAdvisoryLayout(data.advisories));
const selectedAdvisory = $derived(
	data.advisories.find((group) => group.advisory_id === advisoryId) ?? null,
);

const sceneSummary = $derived(
	viewMode === '2d'
		? buildInstanceInsights(data.findings, appState.graphModel, data.truncated)
		: buildAdvisoryInsights(data.advisories, advisoryGraph, data.truncated),
);
// The queue ranks whatever the current view is made of, so it never shows the same
// advisory several times next to a table that has already grouped it.
const queueUnitLabel = $derived(viewMode === '2d' ? 'findings' : 'advisories');
const queueItems = $derived<QueueItem[]>(
	viewMode === '2d'
		? getTopVisibleRisks(data.findings).map((f) => ({
				id: f.instance_id,
				advisoryId: f.advisory_id,
				severity: f.severity,
				primary: `${f.package_name}@${f.package_version}`,
				secondary: `${f.target_name} / ${f.ecosystem}`,
				score: f.decree_score,
			}))
		: getTopAdvisories(data.advisories).map((a) => ({
				id: a.advisory_id,
				advisoryId: a.advisory_id,
				severity: a.severity,
				primary: a.package_names[0] ?? '(unknown package)',
				secondary: `${a.instance_count} instances across ${a.target_count} targets`,
				score: a.max_decree_score,
			})),
);
const queueSelectedId = $derived(viewMode === '2d' ? findingId : advisoryId);

let hoveredNode = $state<{ id: string; x: number; y: number } | null>(null);
const hoverGraph = $derived(viewMode === '3d' ? advisoryGraph : appState.graphModel);
const graphNode = $derived(hoveredNode ? (hoverGraph.nodes.get(hoveredNode.id) ?? null) : null);

let capability = $state<'webgl2' | 'canvas2d' | null>(null);
$effect(() => {
	detectCapability().then((detected) => {
		capability = detected;
	});
});
const fallbackRenderer = $derived(capability === 'canvas2d');

let isNarrow = $state(false);
$effect(() => {
	// jsdom has no matchMedia, and the push layout is the honest default without one.
	const mq = window.matchMedia?.(OVERLAY_BELOW);
	if (!mq) return;

	const sync = () => {
		isNarrow = mq.matches;
	};
	sync();
	mq.addEventListener('change', sync);
	return () => mq.removeEventListener('change', sync);
});

const panelOpen = $derived(!!findingId || !!advisoryId);
const pushPanel = $derived(panelOpen && !isNarrow);

let findingDetail = $state<FindingDetail | null>(null);
let advisoryInstances = $state<Finding[]>([]);
let panelLoading = $state(false);
let panelError = $state<string | null>(null);

// A fast second click races the first response, so every fetch carries a generation and a
// stale winner is dropped rather than allowed to overwrite the newer selection.
let detailGeneration = 0;
$effect(() => {
	const id = findingId;
	const generation = ++detailGeneration;

	if (!id) {
		findingDetail = null;
		return;
	}

	panelLoading = true;
	getFindingDetail(id)
		.then((detail) => {
			if (generation !== detailGeneration) return;
			findingDetail = detail;
			panelError = null;
		})
		.catch((err: unknown) => {
			if (generation !== detailGeneration) return;
			findingDetail = null;
			panelError = describeError(err, 'Could not load this finding.');
		})
		.finally(() => {
			if (generation === detailGeneration) panelLoading = false;
		});
});

let instancesGeneration = 0;
$effect(() => {
	const id = advisoryId;
	const activeOnly = data.query.activeOnly;
	const generation = ++instancesGeneration;

	if (!id) {
		advisoryInstances = [];
		return;
	}

	panelLoading = true;
	getFindings(data.projectId, {
		advisory: id,
		active_only: activeOnly,
		sort: 'decree_score',
		order: 'desc',
	})
		.then((paged) => {
			if (generation !== instancesGeneration) return;
			advisoryInstances = paged.data;
			panelError = null;
		})
		.catch((err: unknown) => {
			if (generation !== instancesGeneration) return;
			advisoryInstances = [];
			panelError = describeError(err, 'Could not load the instances for this advisory.');
		})
		.finally(() => {
			if (generation === instancesGeneration) panelLoading = false;
		});
});

function describeError(err: unknown, fallback: string): string {
	if (typeof err === 'object' && err !== null && 'error' in err) {
		const body = (err as { error?: { message?: string } }).error;
		if (body?.message) return body.message;
	}
	return err instanceof Error ? err.message : fallback;
}

function navigate(nextQuery: FindingsQuery, nextView: ViewQuery) {
	const search = toSearchParams(nextQuery, nextView).toString();
	goto(search ? `${page.url.pathname}?${search}` : page.url.pathname, {
		replaceState: true,
		keepFocus: true,
		noScroll: true,
	});
}

function selectAdvisory(id: string) {
	navigate(data.query, { view: viewMode, advisory: id });
}

function selectFinding(instanceId: string) {
	const owner =
		advisoryId ??
		data.findings.find((f) => f.instance_id === instanceId)?.advisory_id ??
		advisoryInstances.find((f) => f.instance_id === instanceId)?.advisory_id;
	navigate(data.query, { view: viewMode, advisory: owner, finding: instanceId });
}

function closePanel() {
	navigate(data.query, { view: viewMode });
}

function backToAdvisory() {
	navigate(data.query, { view: viewMode, advisory: advisoryId ?? undefined });
}

function onSort(key: FindingSort) {
	const order = data.query.sort === key && data.query.order === 'desc' ? 'asc' : 'desc';
	navigate({ ...data.query, sort: key, order }, view);
}

function clearFilters() {
	navigate({ ...DEFAULT_FINDINGS_QUERY }, { view: viewMode });
}

function onNodeHover(nodeId: string | null, position?: { x: number; y: number }) {
	hoveredNode = nodeId && position ? { id: nodeId, x: position.x, y: position.y } : null;
}

let visibleCount = $state(TABLE_PAGE_SIZE);
$effect(() => {
	// Every advisory is already loaded, so paging is a window over that set — and a new
	// result set (a filter or sort change) has to restart it at the first page.
	if (data.advisories)
		untrack(() => {
			visibleCount = TABLE_PAGE_SIZE;
		});
});
const visibleGroups = $derived(data.advisories.slice(0, visibleCount));
const hasMoreGroups = $derived(visibleCount < data.advisories.length);

const minDate = $derived(
	data.findings.length > 0
		? data.findings.reduce(
				(min: string, f: Finding) =>
					f.last_observed_at && f.last_observed_at < min ? f.last_observed_at : min,
				data.findings[0]?.last_observed_at ?? new Date().toISOString(),
			)
		: new Date(Date.now() - 30 * 86400000).toISOString(),
);

// The right edge of the timeline is "now", so it needs a ticking clock rather than
// a single read taken when the findings last changed.
let now = $state(Date.now());
$effect(() => {
	const id = setInterval(() => {
		now = Date.now();
	}, 60_000);
	return () => clearInterval(id);
});
const maxDate = $derived(new Date(now).toISOString());

// The nav sits above this page and its height is not ours to hardcode, so it is measured.
let shellEl: HTMLElement | undefined = $state();
let shellTop = $state(0);
$effect(() => {
	const el = shellEl;
	if (!el) return;

	const measure = () => {
		shellTop = el.getBoundingClientRect().top + window.scrollY;
	};
	measure();

	const observer = new ResizeObserver(measure);
	observer.observe(document.documentElement);
	return () => observer.disconnect();
});
</script>

<div
	bind:this={shellEl}
	class="flex flex-col overflow-y-auto"
	style="height: calc(100dvh - {shellTop}px)"
>
	<div class="z-10 shrink-0 px-2 pt-2 pb-2">
		<h1 class="hud-header mb-2">
			Project <span class="font-mono normal-case text-hud-text">{data.project.name}</span>
		</h1>
		<FilterBar
			query={data.query}
			{view}
			ecosystems={data.facets.ecosystems}
			severityCounts={data.facets.severity_counts}
		/>
	</div>

	{#if appState.error}
		<div class="flex flex-1 items-center justify-center">
			<p class="font-mono text-hud-danger">{appState.error}</p>
		</div>
	{:else}
		<div
			data-page-grid
			class="grid flex-1 gap-3 px-2 pb-2 xl:min-h-0 {pushPanel
				? 'xl:grid-cols-[minmax(0,1fr)_20rem_24rem]'
				: 'xl:grid-cols-[minmax(0,1fr)_20rem]'}"
		>
			<div class="flex min-h-[34rem] flex-col gap-3 xl:min-h-0">
				<SceneGuide summary={sceneSummary} view={viewMode} {fallbackRenderer} />

				{#if viewMode === 'table'}
					<div class="min-h-[24rem] flex-1 xl:min-h-0">
						<FindingsTable
							groups={visibleGroups}
							sort={data.query.sort}
							order={data.query.order}
							selectedAdvisoryId={advisoryId}
							loading={false}
							hasMore={hasMoreGroups}
							{hasActiveFilters}
							{onSort}
							onSelect={selectAdvisory}
							onLoadMore={() => (visibleCount += TABLE_PAGE_SIZE)}
							onClearFilters={clearFilters}
						/>
					</div>
				{:else if viewMode === '2d'}
					<div class="min-h-[24rem] flex-1 xl:min-h-0">
						<BeeswarmView
							findings={data.findings}
							selectedId={findingId}
							onSelect={selectFinding}
							onHover={onNodeHover}
						/>
					</div>
				{:else}
					<div class="relative min-h-[24rem] flex-1 overflow-hidden hud-panel hud-scanlines bg-hud-void/96 xl:min-h-0">
						<div class="absolute left-4 top-4 z-10 max-w-xs rounded-sm border border-hud-border bg-hud-base/92 px-3 py-2 backdrop-blur">
							<h2 class="hud-header">{fallbackRenderer ? 'Threat Map' : 'Threat Skyline'}</h2>
							<p class="mt-1 text-xs leading-5 text-hud-text-secondary">
								{#if fallbackRenderer}
									WebGL2 is unavailable here, so the skyline is drawn flat. Drag to pan, scroll to
									zoom, and open a column to see the instances behind it.
								{:else}
									Drag to orbit, read the tallest columns first, and use the camera tools to compare
									ecosystem districts before opening an advisory.
								{/if}
							</p>
						</div>

						{#if !fallbackRenderer}
							<div class="absolute bottom-20 left-4 top-36 z-10 hidden w-10 items-center justify-center md:flex">
								<div class="flex h-full flex-col items-center justify-between rounded-full border border-hud-border bg-hud-base/92 px-2 py-3 backdrop-blur">
									<span class="font-mono text-[10px] uppercase tracking-[0.16em] text-hud-text-secondary [writing-mode:vertical-rl] [text-orientation:mixed]">
										High DECREE
									</span>
									<span class="h-full w-px bg-linear-to-b from-hud-accent via-hud-border-bright to-hud-border"></span>
									<span class="font-mono text-[10px] uppercase tracking-[0.16em] text-hud-text-muted [writing-mode:vertical-rl] [text-orientation:mixed]">
										Low
									</span>
								</div>
							</div>
						{/if}

						<!-- One wrapping bar rather than two anchored boxes: at a narrow column width they collided. -->
						<div class="absolute bottom-4 left-4 right-4 z-10 flex flex-wrap items-center justify-end gap-2 text-[11px] uppercase tracking-[0.14em] text-hud-text-secondary">
							<span class="mr-auto rounded-sm border border-hud-border bg-hud-base/92 px-2 py-1 backdrop-blur">District = ecosystem</span>
							<span class="rounded-sm border border-hud-border bg-hud-base/92 px-2 py-1 backdrop-blur">Column = advisory</span>
							<span class="rounded-sm border border-hud-border bg-hud-base/92 px-2 py-1 backdrop-blur">Colour + notches = severity</span>
							<span class="rounded-sm border border-hud-border bg-hud-base/92 px-2 py-1 backdrop-blur">{fallbackRenderer ? 'Brightness = DECREE score' : 'Height = DECREE score'}</span>
							<span class="rounded-sm border border-hud-border bg-hud-base/92 px-2 py-1 backdrop-blur">Width = instances</span>
						</div>

						<VisualizationCanvas
							graphModel={advisoryGraph}
							rendererType="3d"
							selectedNodeId={advisoryId}
							{hasActiveFilters}
							onClearFilters={clearFilters}
							onNodeClick={selectAdvisory}
							{onNodeHover}
						/>

						<NodeTooltip
							node={graphNode}
							x={hoveredNode?.x ?? 0}
							y={hoveredNode?.y ?? 0}
							onDismiss={() => (hoveredNode = null)}
						/>
					</div>
				{/if}
			</div>

			<div class="min-h-0">
				<TopRisksSummary
					items={queueItems}
					unitLabel={queueUnitLabel}
					selectedId={queueSelectedId}
					onSelect={viewMode === '2d' ? selectFinding : selectAdvisory}
				/>
			</div>

			<DetailPanel
				finding={findingDetail}
				advisory={selectedAdvisory}
				instances={advisoryInstances}
				loading={panelLoading}
				error={panelError}
				overlay={isNarrow}
				onSelectInstance={selectFinding}
				onBack={backToAdvisory}
				onClose={closePanel}
			/>
		</div>

		<div class="z-10 shrink-0 overflow-x-auto px-2 pb-2">
			<TimelineSlider {minDate} {maxDate} />
		</div>
	{/if}
</div>
