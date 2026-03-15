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
	<div class="border-b border-hud-border px-3 py-2">
		<h3 class="hud-header">Top Risks</h3>
	</div>
	<ul class="max-h-64 overflow-y-auto">
		{#each risks as risk}
			<li>
				<button
					class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-hud-accent/5 transition-colors"
					onclick={() => onSelect(risk.instance_id)}
				>
					<SeverityBadge severity={parseSeverity(risk.severity)} />
					<span class="flex-1 truncate font-mono text-hud-text-secondary">{risk.advisory_id}</span>
					<span class="font-mono text-hud-accent">{risk.decree_score?.toFixed(1) ?? '—'}</span>
				</button>
			</li>
		{/each}
	</ul>
</div>
