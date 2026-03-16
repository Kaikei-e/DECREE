<script lang="ts">
import type { VisualizationInsights } from '$lib/graph/insights';
import type { RendererType } from '$lib/state/app.svelte';

interface Props {
	summary: VisualizationInsights;
	rendererType: RendererType;
}

const { summary, rendererType }: Props = $props();

let showGuide = $state(false);

const liveLabel = $derived(rendererType === '3d' ? '3D spatial mode' : '2D comparison mode');
const guideButtonLabel = $derived(showGuide ? 'Hide scene guide' : 'Show scene guide');

const quickStats = $derived([
	{
		label: 'Visible',
		value: summary.totalFindings,
		note: `${summary.activeFindings} active`,
	},
	{
		label: 'Targets',
		value: summary.targetCount,
		note: summary.largestCluster ? `Densest: ${summary.largestCluster.name}` : 'No target clusters',
	},
	{
		label: 'Critical',
		value: summary.criticalCount,
		note: `Peak score ${summary.highestScore.toFixed(1)}`,
	},
	{
		label: 'Fresh',
		value: summary.pulsingCount,
		note: 'Seen in 24h',
	},
]);
</script>

<section class="hud-panel bg-hud-base/84 px-3 py-3 backdrop-blur">
	<div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
		<div class="flex flex-wrap items-center gap-2">
			<p class="hud-header">Scene At A Glance</p>
			<span class="rounded-full border border-hud-accent/30 bg-hud-accent/10 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-hud-accent">
				{liveLabel}
			</span>
		</div>

		<div class="flex items-center gap-2">
			<button
				type="button"
				class="rounded-sm border border-hud-border bg-hud-surface px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-hud-text-secondary transition-colors hover:border-hud-border-bright hover:text-hud-text"
				aria-expanded={showGuide}
				onclick={() => (showGuide = !showGuide)}
			>
				{guideButtonLabel}
			</button>
		</div>
	</div>

	<div class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
			{#each quickStats as item}
				<div class="rounded-sm border border-hud-border bg-hud-surface/70 px-3 py-2.5">
					<p class="hud-header">{item.label}</p>
					<p class="mt-1 font-mono text-xl text-hud-text">{item.value}</p>
					<p class="mt-1 text-xs text-hud-text-secondary">{item.note}</p>
				</div>
			{/each}
	</div>

	{#if showGuide}
		<div class="mt-3 grid gap-3 border-t border-hud-border pt-3 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
			<div class="space-y-3">
				<div>
					<p class="hud-header">Visual Encoding</p>
					<p class="mt-2 text-sm leading-6 text-hud-text-secondary">
						Use left-to-right grouping to compare targets, elevation for urgency, and color before glow
						when you need to triage quickly.
					</p>
				</div>

				<div class="grid gap-3 md:grid-cols-3">
					<div class="rounded-sm border border-hud-border bg-hud-surface/60 px-3 py-3 text-sm text-hud-text-secondary">
						<p class="font-mono text-xs uppercase tracking-[0.16em] text-hud-text">District layout</p>
						<p class="mt-2">Each target occupies its own floor plate, so risky neighborhoods separate cleanly.</p>
					</div>

					<div class="rounded-sm border border-hud-border bg-hud-surface/60 px-3 py-3 text-sm text-hud-text-secondary">
						<p class="font-mono text-xs uppercase tracking-[0.16em] text-hud-text">Column height</p>
						<p class="mt-2">Taller monoliths carry higher DECREE urgency, turning the scene into an actionable skyline.</p>
					</div>

					<div class="rounded-sm border border-hud-border bg-hud-surface/60 px-3 py-3 text-sm text-hud-text-secondary">
						<p class="font-mono text-xs uppercase tracking-[0.16em] text-hud-text">Color and glow</p>
						<p class="mt-2">Color identifies severity first, then glow intensity separates exploit likelihood inside the same band.</p>
					</div>
				</div>
			</div>

			<div class="rounded-sm border border-hud-border bg-hud-surface/55 px-3 py-3">
				<p class="hud-header">Reading keys</p>
				<div class="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
					<div class="rounded-sm border border-hud-border/70 bg-hud-base/45 px-3 py-2">
						<p class="font-mono text-[11px] uppercase tracking-[0.14em] text-hud-text">Column = instance</p>
						<p class="mt-1 text-xs text-hud-text-secondary">Each monolith maps to one vulnerable package instance.</p>
					</div>
					<div class="rounded-sm border border-hud-border/70 bg-hud-base/45 px-3 py-2">
						<p class="font-mono text-[11px] uppercase tracking-[0.14em] text-hud-text">Height = DECREE</p>
						<p class="mt-1 text-xs text-hud-text-secondary">Scan upward for higher urgency.</p>
					</div>
					<div class="rounded-sm border border-hud-border/70 bg-hud-base/45 px-3 py-2">
						<p class="font-mono text-[11px] uppercase tracking-[0.14em] text-hud-text">Glow = EPSS</p>
						<p class="mt-1 text-xs text-hud-text-secondary">Brighter columns are more likely to be exploited.</p>
					</div>
				</div>

				<p class="mt-4 hud-header">Severity mix</p>
				<div class="mt-3 space-y-2">
					{#each summary.severityBreakdown as item}
						<div class="grid grid-cols-[5.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs text-hud-text-secondary">
							<span class="font-mono text-hud-text">{item.severity}</span>
							<div class="h-2 overflow-hidden rounded-full border border-hud-border bg-hud-base/80">
								<div
									class="h-full rounded-full"
									style={`width: ${summary.totalFindings > 0 ? (item.count / summary.totalFindings) * 100 : 0}%; background: ${item.color}; box-shadow: 0 0 10px ${item.color};`}
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
