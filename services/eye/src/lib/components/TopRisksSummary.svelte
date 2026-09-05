<script lang="ts" module>
/** The queue ranks whatever the current view is made of, so the page maps its rows into this. */
export interface QueueItem {
	id: string;
	advisoryId: string;
	severity?: string;
	primary: string;
	secondary: string;
	score?: number;
}
</script>

<script lang="ts">
import { parseSeverity } from '$lib/graph/layout';
import SeverityBadge from './SeverityBadge.svelte';

interface Props {
	items: QueueItem[];
	unitLabel: string;
	selectedId: string | null;
	onSelect: (id: string) => void;
}

const { items, unitLabel, selectedId, onSelect }: Props = $props();
</script>

<div class="flex h-full min-h-0 flex-col hud-panel bg-hud-base/90 backdrop-blur">
	<div class="border-b border-hud-border px-4 py-3">
		<div class="flex items-start justify-between gap-3">
			<div>
				<h2 class="hud-header">Priority Queue</h2>
				<p class="mt-1 text-xs text-hud-text-secondary">
					Top {unitLabel} ranked by DECREE Score. Select one to inspect it.
				</p>
			</div>
			<span class="shrink-0 rounded-sm border border-hud-border bg-hud-surface px-2 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-hud-text-secondary">
				{items.length} shown
			</span>
		</div>
	</div>

	{#if items.length === 0}
		<div class="px-4 py-6 text-sm text-hud-text-secondary">
			No {unitLabel} match the current filter set.
		</div>
	{:else}
		<ul class="min-h-0 flex-1 overflow-y-auto">
			{#each items as item, index (item.id)}
				{@const selected = item.id === selectedId}
				<li class="border-b border-hud-border/60 last:border-b-0">
					<button
						class="flex w-full items-start gap-3 border-l-2 px-4 py-3 text-left transition-colors hover:bg-hud-accent/5 {selected
							? 'border-l-hud-accent bg-hud-accent/10'
							: 'border-l-transparent'}"
						aria-current={selected ? 'true' : undefined}
						onclick={() => onSelect(item.id)}
					>
						<span class="mt-0.5 font-mono text-[11px] text-hud-text-muted">#{index + 1}</span>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
								<SeverityBadge severity={parseSeverity(item.severity)} />
								<span class="font-mono text-xs text-hud-accent">{item.advisoryId}</span>
							</div>
							<div class="mt-1 truncate text-sm text-hud-text">{item.primary}</div>
							<div class="mt-1 truncate text-xs text-hud-text-secondary">{item.secondary}</div>
						</div>
						<div class="shrink-0 text-right">
							<div class="font-mono text-lg text-hud-accent">{item.score?.toFixed(1) ?? 'n/a'}</div>
							<div class="text-[11px] uppercase tracking-[0.14em] text-hud-text-muted">DECREE</div>
						</div>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
