<script lang="ts">
import type { GraphModel } from '$lib/graph/model';
import { createRenderer, type RendererChoice } from '$lib/renderer/factory';
import type { SceneRenderer } from '$lib/renderer/types';
import CameraToolbar from './CameraToolbar.svelte';

interface Props {
	graphModel: GraphModel;
	rendererType: RendererChoice;
	onNodeClick: (nodeId: string) => void;
	onNodeHover: (nodeId: string | null, position?: { x: number; y: number }) => void;
}

const { graphModel, rendererType, onNodeClick, onNodeHover }: Props = $props();

let containerEl: HTMLElement | undefined = $state();
let renderer: SceneRenderer | null = $state(null);

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

function handleKeydown(e: KeyboardEvent) {
	const tag = (e.target as HTMLElement)?.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
	if (!renderer) return;

	switch (e.key) {
		case '=':
		case '+':
			renderer.zoomIn();
			break;
		case '-':
			renderer.zoomOut();
			break;
		case '0':
			renderer.resetView();
			break;
		case 't':
		case 'T':
			if (rendererType === '3d') renderer.setViewPreset('top');
			break;
		case 'f':
		case 'F':
			if (rendererType === '3d') renderer.setViewPreset('front');
			break;
		default:
			return;
	}
}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="relative h-full w-full">
	<div bind:this={containerEl} class="h-full w-full overflow-hidden"></div>

	{#if renderer}
		<div class="absolute right-3 top-3 z-10">
			<CameraToolbar
				onZoomIn={() => renderer?.zoomIn()}
				onZoomOut={() => renderer?.zoomOut()}
				onResetView={() => renderer?.resetView()}
				onSetViewPreset={(p) => renderer?.setViewPreset(p)}
				is3D={rendererType === '3d'}
			/>
		</div>
	{/if}

	{#if graphModel.nodes.size === 0}
		<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
			<p class="text-[#7a9ab5] text-sm font-mono">No vulnerability data available</p>
		</div>
	{/if}
</div>
