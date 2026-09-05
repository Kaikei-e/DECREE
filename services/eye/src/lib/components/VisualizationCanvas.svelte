<script lang="ts">
import { untrack } from 'svelte';
import type { GraphModel, GraphNode } from '$lib/graph/model';
import { createRenderer, type RendererChoice } from '$lib/renderer/factory';
import type { SceneRenderer } from '$lib/renderer/types';
import CameraToolbar from './CameraToolbar.svelte';

interface Props {
	graphModel: GraphModel;
	rendererType: RendererChoice;
	selectedNodeId?: string | null;
	onNodeClick: (nodeId: string) => void;
	onNodeHover: (nodeId: string | null, position?: { x: number; y: number }) => void;
	hasActiveFilters?: boolean;
	onClearFilters?: () => void;
}

const {
	graphModel,
	rendererType,
	selectedNodeId = null,
	onNodeClick,
	onNodeHover,
	hasActiveFilters = false,
	onClearFilters,
}: Props = $props();

const describedById = $props.id();

let containerEl: HTMLElement | undefined = $state();
let renderer: SceneRenderer | null = $state(null);
let cursorIndex = $state(-1);

const is3D = $derived(rendererType === '3d');
const sceneLabel = $derived(is3D ? '3D vulnerability scene' : '2D vulnerability graph');

// Reading order for keyboard traversal mirrors the Priority Queue: worst first.
const orderedNodes = $derived(
	[...graphModel.nodes.values()].sort((a, b) => b.decreeScore - a.decreeScore),
);
const cursorNode = $derived<GraphNode | null>(
	cursorIndex >= 0 ? (orderedNodes[cursorIndex] ?? null) : null,
);

const announcement = $derived(
	cursorNode
		? `${cursorNode.advisoryId}, ${cursorNode.packageName}@${cursorNode.packageVersion}, ${cursorNode.severity}, DECREE ${cursorNode.decreeScore.toFixed(1)}. ${cursorIndex + 1} of ${orderedNodes.length}.`
		: '',
);

const findingKeys =
	'Press N and P to step to the next and previous finding, Home and End for the first and last, and Enter to open the focused finding.';

const sceneDescription = $derived(
	is3D
		? `${orderedNodes.length} findings across ${graphModel.clusters.length} targets, ordered by DECREE Score. Drag to orbit, shift-drag or right-drag to pan, and scroll to zoom. The arrow keys fly the camera: left and right strafe, up and down move forward and back, and shift with up or down changes altitude. ${findingKeys} Press equals and minus to zoom, zero to fit the whole scene, T for the top view and F for the front view.`
		: `${orderedNodes.length} findings across ${graphModel.clusters.length} targets, ordered by DECREE Score. Drag to pan and scroll to zoom, or let the arrow keys pan the graph. ${findingKeys} Press equals and minus to zoom and zero to fit the whole scene.`,
);

$effect(() => {
	const type = rendererType;
	const container = containerEl;
	if (!container) return;

	let cancelled = false;

	(async () => {
		let r: SceneRenderer;
		try {
			r = await createRenderer(type);
			if (cancelled || !containerEl) return;
			r.mount(container);
		} catch (err) {
			console.warn('3D renderer failed, falling back to 2D:', err);
			r = await createRenderer('2d');
			if (cancelled || !containerEl) return;
			r.mount(container);
		}
		r.onNodeClick(onNodeClick);
		r.onNodeHover(onNodeHover);
		r.setGraphModel(graphModel);
		renderer = r;
	})();

	return () => {
		cancelled = true;
		renderer?.dispose();
		renderer = null;
	};
});

$effect(() => {
	if (renderer) {
		renderer.setGraphModel(graphModel);
	}
});

// ResizeObserver via $effect cleanup (replaces onMount)
$effect(() => {
	if (!containerEl) return;
	const observer = new ResizeObserver(() => renderer?.resize());
	observer.observe(containerEl);
	return () => observer.disconnect();
});

let lastSelectedNodeId: string | null = null;

$effect(() => {
	const id = selectedNodeId;
	if (id !== lastSelectedNodeId) {
		lastSelectedNodeId = id;
		// A selection made outside the scene takes the highlight back from the keyboard cursor.
		if (untrack(() => cursorNode?.id) !== id) cursorIndex = -1;
	}
	renderer?.setSelectedNode(cursorNode?.id ?? id ?? null);
});

const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const heldKeys = new Set<string>();
let shiftHeld = false;

function pushVelocity() {
	const right = (heldKeys.has('ArrowRight') ? 1 : 0) - (heldKeys.has('ArrowLeft') ? 1 : 0);
	const vertical = (heldKeys.has('ArrowUp') ? 1 : 0) - (heldKeys.has('ArrowDown') ? 1 : 0);
	renderer?.setCameraVelocity({
		right,
		forward: shiftHeld ? 0 : vertical,
		up: shiftHeld ? vertical : 0,
	});
}

function stopMoving() {
	heldKeys.clear();
	shiftHeld = false;
	pushVelocity();
}

function moveCursor(delta: number) {
	if (orderedNodes.length === 0) return;
	const next = cursorIndex < 0 ? (delta > 0 ? 0 : orderedNodes.length - 1) : cursorIndex + delta;
	cursorIndex = Math.min(Math.max(next, 0), orderedNodes.length - 1);
}

function handleKeydown(e: KeyboardEvent) {
	if (e.ctrlKey || e.metaKey || e.altKey) return;

	const target = e.target as HTMLElement | null;
	const tag = target?.tagName;
	if (target?.isContentEditable) return;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

	if (MOVE_KEYS.has(e.key)) {
		shiftHeld = e.shiftKey;
		heldKeys.add(e.key);
		pushVelocity();
		e.preventDefault();
		return;
	}

	if (e.key === 'Shift') {
		shiftHeld = true;
		pushVelocity();
		return;
	}

	switch (e.key) {
		case 'n':
		case 'N':
			moveCursor(1);
			break;
		case 'p':
		case 'P':
			moveCursor(-1);
			break;
		case 'Home':
			if (orderedNodes.length > 0) cursorIndex = 0;
			break;
		case 'End':
			if (orderedNodes.length > 0) cursorIndex = orderedNodes.length - 1;
			break;
		case 'Enter':
		case ' ':
			if (!cursorNode) return;
			onNodeClick(cursorNode.id);
			break;
		case '=':
		case '+':
			renderer?.zoomIn();
			break;
		case '-':
			renderer?.zoomOut();
			break;
		case '0':
			renderer?.resetView();
			break;
		case 't':
		case 'T':
			if (!is3D) return;
			renderer?.setViewPreset('top');
			break;
		case 'f':
		case 'F':
			if (!is3D) return;
			renderer?.setViewPreset('front');
			break;
		default:
			return;
	}

	e.preventDefault();
}

function handleKeyup(e: KeyboardEvent) {
	if (e.key === 'Shift') {
		shiftHeld = false;
		pushVelocity();
		return;
	}
	if (!MOVE_KEYS.has(e.key)) return;
	heldKeys.delete(e.key);
	shiftHeld = e.shiftKey;
	pushVelocity();
}
</script>

<div class="relative h-full w-full">
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -- the canvas has no focusable DOM children, so the host element carries focus and the keyboard contract -->
	<div
		bind:this={containerEl}
		role="application"
		tabindex="0"
		aria-label={sceneLabel}
		aria-describedby={describedById}
		onkeydown={handleKeydown}
		onkeyup={handleKeyup}
		onblur={stopMoving}
		class="h-full w-full overflow-hidden"
	></div>

	<p id={describedById} class="sr-only">{sceneDescription}</p>
	<p role="status" class="sr-only">{announcement}</p>

	{#if renderer}
		<div class="absolute right-3 top-3 z-10">
			<CameraToolbar
				onZoomIn={() => renderer?.zoomIn()}
				onZoomOut={() => renderer?.zoomOut()}
				onResetView={() => renderer?.resetView()}
				onSetViewPreset={(p) => renderer?.setViewPreset(p)}
				{is3D}
			/>
		</div>
	{/if}

	{#if graphModel.nodes.size === 0}
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
			<div class="pointer-events-auto rounded-sm border border-hud-border bg-hud-base/92 px-4 py-3 text-center backdrop-blur">
				{#if hasActiveFilters}
					<p class="font-mono text-sm text-hud-text-secondary">No findings match the current filters.</p>
					<button
						class="mt-2 rounded-sm border border-hud-border-control bg-hud-surface px-3 py-1.5 font-mono text-xs uppercase tracking-[0.14em] text-hud-text-secondary transition-colors hover:text-hud-text"
						onclick={() => onClearFilters?.()}
					>
						Clear filters
					</button>
				{:else}
					<p class="font-mono text-sm text-hud-text-secondary">No vulnerabilities recorded for this project.</p>
				{/if}
			</div>
		</div>
	{/if}
</div>
