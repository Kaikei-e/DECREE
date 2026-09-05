<script lang="ts" module>
const POINTER_OFFSET = 12;
const EDGE_MARGIN = 8;

export interface TooltipPlacement {
	left: number;
	top: number;
}

export function computeTooltipPosition(input: {
	x: number;
	y: number;
	width: number;
	height: number;
	viewportWidth: number;
	viewportHeight: number;
}): TooltipPlacement {
	const { x, y, width, height, viewportWidth, viewportHeight } = input;

	const right = x + POINTER_OFFSET;
	const overflowsRight = right + width > viewportWidth - EDGE_MARGIN;
	const left = overflowsRight ? x - POINTER_OFFSET - width : right;

	const preferredTop = y - 10;
	const maxTop = viewportHeight - EDGE_MARGIN - height;

	return {
		left: Math.max(EDGE_MARGIN, Math.min(left, viewportWidth - EDGE_MARGIN - width)),
		top: Math.max(EDGE_MARGIN, Math.min(preferredTop, maxTop)),
	};
}
</script>

<script lang="ts">
import type { GraphNode } from '$lib/graph/model';
import SeverityBadge from './SeverityBadge.svelte';

interface Props {
	node: GraphNode | null;
	x: number;
	y: number;
	onDismiss?: () => void;
}

const { node, x, y, onDismiss }: Props = $props();

let tipEl: HTMLElement | undefined = $state();
let width = $state(0);
let height = $state(0);
let viewportWidth = $state(0);
let viewportHeight = $state(0);

$effect(() => {
	// Re-measure whenever the content or the anchor moves.
	void node;
	void x;
	void y;
	if (!tipEl) return;
	width = tipEl.offsetWidth;
	height = tipEl.offsetHeight;
});

const placement = $derived(
	computeTooltipPosition({ x, y, width, height, viewportWidth, viewportHeight }),
);

function onWindowKeydown(e: KeyboardEvent) {
	if (node && e.key === 'Escape') onDismiss?.();
}
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight} onkeydown={onWindowKeydown} />

{#if node}
	<div
		bind:this={tipEl}
		role="tooltip"
		class="pointer-events-none fixed z-50 hud-panel hud-border-glow bg-hud-base/95 px-3 py-2 backdrop-blur"
		style="left: {placement.left}px; top: {placement.top}px;"
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
