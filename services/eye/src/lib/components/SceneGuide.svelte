<script lang="ts">
import type { VisualizationInsights } from '$lib/graph/insights';
import type { RendererType } from '$lib/state/app.svelte';

interface Props {
	summary: VisualizationInsights;
	rendererType: RendererType;
}

const { summary, rendererType }: Props = $props();

const liveLabel = $derived(rendererType === '3d' ? '3D spatial mode' : '2D comparison mode');
</script>

<div class="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
	<section class="hud-panel bg-hud-base/88 px-4 py-4 backdrop-blur">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="space-y-2">
				<p class="hud-header">Scene Map</p>
				<h2 class="max-w-3xl text-balance text-lg font-semibold text-hud-text">
					Each orb is one vulnerable package instance in the selected project.
				</h2>
				<p class="max-w-3xl text-sm leading-6 text-hud-text-secondary">
					Targets form clusters from left to right, height tracks DECREE Score, severity sets color,
					and brighter orbs carry higher EPSS.
				</p>
			</div>

			<div class="rounded-sm border border-hud-accent/35 bg-hud-accent/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-hud-accent">
				{liveLabel}
			</div>
		</div>

		<div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
			<div class="rounded-sm border border-hud-border bg-hud-surface/75 px-3 py-3">
				<p class="hud-header">Visible Findings</p>
				<p class="mt-2 font-mono text-2xl text-hud-text">{summary.totalFindings}</p>
				<p class="mt-1 text-xs text-hud-text-secondary">{summary.activeFindings} active in the current filter</p>
			</div>

			<div class="rounded-sm border border-hud-border bg-hud-surface/75 px-3 py-3">
				<p class="hud-header">Targets</p>
				<p class="mt-2 font-mono text-2xl text-hud-text">{summary.targetCount}</p>
				<p class="mt-1 text-xs text-hud-text-secondary">
					{summary.largestCluster
						? `${summary.largestCluster.name} is the densest cluster`
						: 'No target clusters in view'}
				</p>
			</div>

			<div class="rounded-sm border border-hud-border bg-hud-surface/75 px-3 py-3">
				<p class="hud-header">Critical Focus</p>
				<p class="mt-2 font-mono text-2xl text-hud-text">{summary.criticalCount}</p>
				<p class="mt-1 text-xs text-hud-text-secondary">Highest DECREE Score {summary.highestScore.toFixed(1)}</p>
			</div>

			<div class="rounded-sm border border-hud-border bg-hud-surface/75 px-3 py-3">
				<p class="hud-header">Fresh Activity</p>
				<p class="mt-2 font-mono text-2xl text-hud-text">{summary.pulsingCount}</p>
				<p class="mt-1 text-xs text-hud-text-secondary">Observed in the last 24 hours</p>
			</div>
		</div>
	</section>

	<section class="hud-panel bg-hud-base/88 px-4 py-4 backdrop-blur">
		<p class="hud-header">Visual Encoding</p>
		<div class="mt-3 space-y-3 text-sm text-hud-text-secondary">
			<div class="flex items-start gap-3 rounded-sm border border-hud-border bg-hud-surface/60 px-3 py-2.5">
				<span class="mt-1 h-2.5 w-2.5 rounded-full bg-hud-accent shadow-[0_0_10px_rgba(0,229,255,0.5)]"></span>
				<div>
					<p class="font-mono text-xs uppercase tracking-[0.16em] text-hud-text">Orb</p>
					<p>One vulnerability instance for a package version on a target.</p>
				</div>
			</div>

			<div class="flex items-start gap-3 rounded-sm border border-hud-border bg-hud-surface/60 px-3 py-2.5">
				<span class="mt-1 h-6 w-px bg-hud-accent"></span>
				<div>
					<p class="font-mono text-xs uppercase tracking-[0.16em] text-hud-text">Height</p>
					<p>Higher means more urgent according to DECREE Score.</p>
				</div>
			</div>

			<div class="flex items-start gap-3 rounded-sm border border-hud-border bg-hud-surface/60 px-3 py-2.5">
				<span class="mt-1 inline-flex gap-1">
					<span class="h-2.5 w-2.5 rounded-full bg-[#ff1744]"></span>
					<span class="h-2.5 w-2.5 rounded-full bg-[#ff9100]"></span>
					<span class="h-2.5 w-2.5 rounded-full bg-[#ffd600]"></span>
				</span>
				<div>
					<p class="font-mono text-xs uppercase tracking-[0.16em] text-hud-text">Color + Brightness</p>
					<p>Color shows severity. Brighter nodes indicate higher EPSS likelihood.</p>
				</div>
			</div>
		</div>

		<div class="mt-4 space-y-2">
			<p class="hud-header">Severity Mix</p>
			{#each summary.severityBreakdown as item}
				<div class="grid grid-cols-[5.75rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs text-hud-text-secondary">
					<span class="font-mono text-hud-text">{item.severity}</span>
					<div class="h-2 overflow-hidden rounded-full border border-hud-border bg-hud-surface">
						<div
							class="h-full rounded-full"
							style={`width: ${summary.totalFindings > 0 ? (item.count / summary.totalFindings) * 100 : 0}%; background: ${item.color}; box-shadow: 0 0 10px ${item.color};`}
						></div>
					</div>
					<span class="text-right font-mono text-hud-text">{item.count}</span>
				</div>
			{/each}
		</div>
	</section>
</div>