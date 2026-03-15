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
		class="pointer-events-none fixed z-50 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 shadow-xl"
		style="left: {x + 12}px; top: {y - 10}px;"
	>
		<div class="flex items-center gap-2">
			<SeverityBadge severity={node.severity} />
			<span class="text-xs font-mono text-gray-300">{node.advisoryId}</span>
		</div>
		<div class="mt-1 text-xs text-gray-400">
			{node.packageName}@{node.packageVersion}
		</div>
		<div class="mt-1 flex gap-3 text-xs">
			<span class="text-gray-400">Score: <span class="text-gray-100">{node.decreeScore.toFixed(1)}</span></span>
			<span class="text-gray-400">EPSS: <span class="text-gray-100">{(node.epssScore * 100).toFixed(1)}%</span></span>
		</div>
	</div>
{/if}
