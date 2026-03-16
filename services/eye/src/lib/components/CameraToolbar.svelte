<script lang="ts">
import { ArrowDown, ArrowRight, Maximize, ZoomIn, ZoomOut } from 'lucide-svelte';

interface Props {
	onZoomIn: () => void;
	onZoomOut: () => void;
	onResetView: () => void;
	onSetViewPreset: (preset: 'top' | 'front') => void;
	is3D: boolean;
}

const { onZoomIn, onZoomOut, onResetView, onSetViewPreset, is3D }: Props = $props();
</script>

<div class="hud-panel bg-hud-base/90 backdrop-blur p-1 flex flex-col gap-0.5">
	<button
		class="p-1.5 transition-colors text-hud-text-muted hover:text-hud-accent hover:bg-hud-accent/10 rounded-sm"
		title="Zoom In (=)"
		onclick={onZoomIn}
	>
		<ZoomIn size={16} />
	</button>
	<button
		class="p-1.5 transition-colors text-hud-text-muted hover:text-hud-accent hover:bg-hud-accent/10 rounded-sm"
		title="Zoom Out (-)"
		onclick={onZoomOut}
	>
		<ZoomOut size={16} />
	</button>

	<div class="border-t border-hud-border my-0.5"></div>

	<button
		class="p-1.5 transition-colors text-hud-text-muted hover:text-hud-accent hover:bg-hud-accent/10 rounded-sm"
		title="Fit All (0)"
		onclick={onResetView}
	>
		<Maximize size={16} />
	</button>

	{#if is3D}
		<button
			class="p-1.5 transition-colors text-hud-text-muted hover:text-hud-accent hover:bg-hud-accent/10 rounded-sm"
			title="Top View (T)"
			onclick={() => onSetViewPreset('top')}
		>
			<ArrowDown size={16} />
		</button>
		<button
			class="p-1.5 transition-colors text-hud-text-muted hover:text-hud-accent hover:bg-hud-accent/10 rounded-sm"
			title="Front View (F)"
			onclick={() => onSetViewPreset('front')}
		>
			<ArrowRight size={16} />
		</button>
	{/if}
</div>
