<script lang="ts">
import { onMount } from 'svelte';
import type { GraphModel } from '$lib/graph/model';
import { createRenderer, type RendererChoice } from '$lib/renderer/factory';
import type { SceneRenderer } from '$lib/renderer/types';

interface Props {
	graphModel: GraphModel;
	rendererType: RendererChoice;
	onNodeClick: (nodeId: string) => void;
	onNodeHover: (nodeId: string | null, position?: { x: number; y: number }) => void;
}

const { graphModel, rendererType, onNodeClick, onNodeHover }: Props = $props();

let containerEl: HTMLElement | undefined = $state();
let renderer: SceneRenderer | null = $state(null);

async function initRenderer() {
	if (renderer) {
		renderer.dispose();
		renderer = null;
	}
	if (!containerEl) return;

	const r = await createRenderer(rendererType);
	r.mount(containerEl);
	r.onNodeClick(onNodeClick);
	r.onNodeHover(onNodeHover);
	r.setGraphModel(graphModel);
	renderer = r;
}

$effect(() => {
	// Re-init when rendererType changes
	const _ = rendererType;
	initRenderer();
});

$effect(() => {
	// Update graph model when it changes
	if (renderer) {
		renderer.setGraphModel(graphModel);
	}
});

onMount(() => {
	const observer = new ResizeObserver(() => renderer?.resize());
	if (containerEl) observer.observe(containerEl);
	return () => {
		observer.disconnect();
		renderer?.dispose();
	};
});
</script>

<div bind:this={containerEl} class="h-full w-full"></div>
