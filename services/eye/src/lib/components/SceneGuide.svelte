<script lang="ts">
import { TriangleAlert } from 'lucide-svelte';
import type { VisualizationInsights } from '$lib/graph/insights';
import type { ViewMode } from '$lib/state/query-params';

interface Props {
	summary: VisualizationInsights;
	view: ViewMode;
	/** The 3D scene asked for WebGL2 and did not get it, so the canvas is flat. */
	fallbackRenderer: boolean;
}

const { summary, view, fallbackRenderer }: Props = $props();

const guideId = $props.id();

let showGuide = $state(false);

const modeLabel = $derived.by(() => {
	if (view === 'table') return 'Table mode';
	if (view === '2d') return 'Risk plot mode';
	return fallbackRenderer ? '2D fallback · WebGL2 unavailable' : '3D spatial mode';
});

const guideButtonLabel = $derived(showGuide ? 'Hide scene guide' : 'Show scene guide');

const markLabel = $derived(summary.scope === 'advisory' ? 'Column = advisory' : 'Mark = instance');

const quickStats = $derived([
	{
		label: summary.unitLabel,
		value: summary.unitCount,
		note: `${summary.activeCount} active`,
	},
	{
		label: summary.clusterLabel,
		value: summary.clusterCount,
		note: summary.largestCluster ? `Densest: ${summary.largestCluster.name}` : 'No clusters',
	},
	{
		label: 'Critical',
		value: summary.criticalCount,
		note: `Peak score ${summary.highestScore.toFixed(1)}`,
	},
	{
		label: 'Fresh',
		value: summary.freshCount,
		note: 'Seen in 24h',
	},
]);
</script>

<section class="hud-panel bg-hud-base/84 px-3 py-3 backdrop-blur">
	<div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
		<div class="flex flex-wrap items-center gap-2">
			<h2 class="hud-header">Scene At A Glance</h2>
			<span class="rounded-full border border-hud-accent/30 bg-hud-accent/10 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-hud-accent">
				{modeLabel}
			</span>
		</div>

		<div class="flex items-center gap-2">
			<button
				type="button"
				class="rounded-sm border border-hud-border-control bg-hud-surface px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-hud-text-secondary transition-colors hover:border-hud-border-bright hover:text-hud-text"
				aria-expanded={showGuide}
				aria-controls={showGuide ? guideId : undefined}
				onclick={() => (showGuide = !showGuide)}
			>
				{guideButtonLabel}
			</button>
		</div>
	</div>

	{#if summary.truncated}
		<p class="mt-3 flex items-start gap-2 rounded-sm border border-hud-warning/40 bg-hud-warning/10 px-3 py-2 text-xs leading-5 text-hud-text">
			<TriangleAlert size={14} aria-hidden="true" class="mt-0.5 shrink-0 text-hud-warning" />
			<span>
				Row cap reached: these numbers cover the first {summary.unitCount} rows the gateway returned,
				not the whole project. Narrow the filters to see a complete set.
			</span>
		</p>
	{/if}

	<div class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
			{#each quickStats as item (item.label)}
				<div class="rounded-sm border border-hud-border bg-hud-surface/70 px-3 py-2.5">
					<p class="hud-header">{item.label}</p>
					<p class="mt-1 font-mono text-xl text-hud-text">{item.value}</p>
					<p class="mt-1 text-xs text-hud-text-secondary">{item.note}</p>
				</div>
			{/each}
	</div>

	{#if showGuide}
		<div id={guideId} class="mt-3 grid gap-3 border-t border-hud-border pt-3 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
			<div class="space-y-3">
				<div>
					<h3 class="hud-header">Visual Encoding</h3>
					<p class="mt-2 text-sm leading-6 text-hud-text-secondary">
						{#if summary.scope === 'advisory'}
							One column is one advisory, grouped into ecosystem districts. Compare heights first,
							then open a column to see which instances carry it.
						{:else}
							One mark is one vulnerable instance, placed by exploit probability and DECREE Score.
							The top-right corner is where triage starts.
						{/if}
					</p>
				</div>

				<div class="grid gap-3 md:grid-cols-3">
					<div class="rounded-sm border border-hud-border bg-hud-surface/60 px-3 py-3 text-sm text-hud-text-secondary">
						<p class="font-mono text-xs uppercase tracking-[0.16em] text-hud-text">
							{summary.scope === 'advisory' ? 'Ecosystem districts' : 'Severity lanes'}
						</p>
						<p class="mt-2">
							{summary.scope === 'advisory'
								? 'Each ecosystem occupies its own floor plate, so one upgrade path stays together.'
								: 'Marks are packed inside their severity lane, so the shape shows where the mass sits.'}
						</p>
					</div>

					<div class="rounded-sm border border-hud-border bg-hud-surface/60 px-3 py-3 text-sm text-hud-text-secondary">
						<p class="font-mono text-xs uppercase tracking-[0.16em] text-hud-text">
							{summary.scope === 'advisory' ? 'Column height' : 'Vertical position'}
						</p>
						<p class="mt-2">Higher means higher DECREE urgency, so scan upward first.</p>
					</div>

					<div class="rounded-sm border border-hud-border bg-hud-surface/60 px-3 py-3 text-sm text-hud-text-secondary">
						<p class="font-mono text-xs uppercase tracking-[0.16em] text-hud-text">Colour and notches</p>
						<p class="mt-2">Colour identifies severity, and the notch count repeats it for colour-vision deficiency.</p>
					</div>
				</div>
			</div>

			<div class="rounded-sm border border-hud-border bg-hud-surface/55 px-3 py-3">
				<h3 class="hud-header">Reading keys</h3>
				<div class="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
					<div class="rounded-sm border border-hud-border/70 bg-hud-base/45 px-3 py-2">
						<p class="font-mono text-[11px] uppercase tracking-[0.14em] text-hud-text">{markLabel}</p>
						<p class="mt-1 text-xs text-hud-text-secondary">
							{summary.scope === 'advisory'
								? 'One monolith per advisory; its width grows with the instances it covers.'
								: 'One dot per vulnerable package instance in a target.'}
						</p>
					</div>
					<div class="rounded-sm border border-hud-border/70 bg-hud-base/45 px-3 py-2">
						<p class="font-mono text-[11px] uppercase tracking-[0.14em] text-hud-text">Height = DECREE</p>
						<p class="mt-1 text-xs text-hud-text-secondary">Scan upward for higher urgency.</p>
					</div>
					<div class="rounded-sm border border-hud-border/70 bg-hud-base/45 px-3 py-2">
						<p class="font-mono text-[11px] uppercase tracking-[0.14em] text-hud-text">Glow = EPSS</p>
						<p class="mt-1 text-xs text-hud-text-secondary">Brighter marks are more likely to be exploited.</p>
					</div>
				</div>

				<h3 class="mt-4 hud-header">Severity mix</h3>
				<div class="mt-3 space-y-2">
					{#each summary.severityBreakdown as item (item.severity)}
						<div class="grid grid-cols-[5.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs text-hud-text-secondary">
							<span class="font-mono text-hud-text">{item.severity}</span>
							<div class="h-2 overflow-hidden rounded-full border border-hud-border bg-hud-base/80">
								<div
									class="h-full rounded-full"
									style={`width: ${summary.unitCount > 0 ? (item.count / summary.unitCount) * 100 : 0}%; background: ${item.color}; box-shadow: 0 0 10px ${item.color};`}
								></div>
							</div>
							<span class="text-right font-mono text-hud-text">{item.count}</span>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</section>
