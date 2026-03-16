<script lang="ts">
import { parseSeverity } from '$lib/graph/layout';
import type { Finding } from '$lib/types/api';
import SeverityBadge from './SeverityBadge.svelte';

interface Props {
	risks: Finding[];
	onSelect: (instanceId: string) => void;
}

const { risks, onSelect }: Props = $props();
</script>

<div class="hud-panel bg-hud-base/90 backdrop-blur">
	<div class="border-b border-hud-border px-4 py-3">
		<div class="flex items-start justify-between gap-3">
			<div>
				<h3 class="hud-header">Priority Queue</h3>
				<p class="mt-1 text-xs text-hud-text-secondary">
					Top visible findings ranked by DECREE Score. Select one to inspect the package and
					path details.
				</p>
			</div>
			<span class="rounded-sm border border-hud-border bg-hud-surface px-2 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-hud-text-secondary">{risks.length} shown</span>
		</div>
	</div>

	{#if risks.length === 0}
		<div class="px-4 py-6 text-sm text-hud-text-secondary">No findings match the current filter set.</div>
	{:else}
		<ul class="max-h-[24rem] overflow-y-auto">
			{#each risks as risk, index}
				<li class="border-b border-hud-border/60 last:border-b-0">
					<button
						class="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hud-accent/5"
						onclick={() => onSelect(risk.instance_id)}
					>
						<span class="mt-0.5 font-mono text-[11px] text-hud-text-muted">#{index + 1}</span>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<SeverityBadge severity={parseSeverity(risk.severity)} />
								<span class="truncate font-mono text-xs text-hud-accent">{risk.advisory_id}</span>
							</div>
							<div class="mt-1 truncate text-sm text-hud-text">{risk.package_name}@{risk.package_version}</div>
							<div class="mt-1 truncate text-xs text-hud-text-secondary">{risk.target_name} / {risk.ecosystem}</div>
						</div>
						<div class="text-right">
							<div class="font-mono text-lg text-hud-accent">{risk.decree_score?.toFixed(1) ?? 'n/a'}</div>
							<div class="text-[11px] uppercase tracking-[0.14em] text-hud-text-muted">DECREE</div>
						</div>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>