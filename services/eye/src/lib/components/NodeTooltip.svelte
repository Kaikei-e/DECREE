<script lang="ts">
import type { GraphNode } from '$lib/graph/model';
import SeverityBadge from './SeverityBadge.svelte';

interface Props {
	node: GraphNode | null;
	x: number;
	y: number;
}

const { node, x, y }: Props = $props();
</script>

{#if node}
	<div
		class="pointer-events-none fixed z-50 hud-panel hud-border-glow bg-hud-base/95 px-3 py-2 backdrop-blur"
		style="left: {x + 12}px; top: {y - 10}px;"
	>
		<div class="flex items-center gap-2">
			<SeverityBadge severity={node.severity} />
			<span class="font-mono text-xs text-hud-accent">{node.advisoryId}</span>
		</div>
		<div class="mt-1 font-mono text-xs text-hud-text-secondary">
			{node.packageName}@{node.packageVersion}
		</div>
		<div class="mt-1 flex gap-3 font-mono text-xs">
			<span class="text-hud-text-muted">Score: <span class="text-hud-text">{node.decreeScore.toFixed(1)}</span></span>
			<span class="text-hud-text-muted">EPSS: <span class="text-hud-text">{(node.epssScore * 100).toFixed(1)}%</span></span>
		</div>
	</div>
{/if}
